import test from 'node:test';
import { MemoryPolicyDatabase, RedisPolicyDatabase, getProtectionStore } from '../lib/vercel-store.ts';
import { serveMuseumJSON } from '../lib/museum-service-core.ts';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { admitClient, reserveMuseumRequest, clientKey, pauseMuseum, museumRetrySeconds, readMuseumCache, writeMuseumCache, POLICY, PolicyError, type PolicyDatabase } from '../lib/museum-policy.ts';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_smart_king_cobra.sql', import.meta.url), 'utf8'));
  const db: PolicyDatabase = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let values: (string | number)[] = [];
      return {
        bind(...input) { values = input; return this; },
        async first<T>() { return (statement.get(...values) || null) as T | null; },
        async run() { return statement.run(...values); },
      };
    },
  };
  return { db, sqlite };
}
const now = 1700000000000;

test('31st request is rejected; client buckets stay separate and reset next minute', async () => {
  const { db } = fixture();
  for (let i = 0; i < 30; i++) await admitClient(db, 'client:one', now);
  await assert.rejects(() => admitClient(db, 'client:one', now), (error: unknown) => error instanceof PolicyError && error.status === 429 && error.retryAfter > 0);
  await admitClient(db, 'client:two', now);
  await admitClient(db, 'client:one', (Math.floor(now / 60000) + 1) * 60000);
});

test('parallel requests share a single global admission slot', async () => {
  const { db } = fixture();
  const outcomes = await Promise.allSettled(Array.from({ length: 25 }, () => reserveMuseumRequest(db, now)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 24);
});

test('500ms spacing survives wall-clock second boundaries', async () => {
  const { db } = fixture();
  await reserveMuseumRequest(db, now + 900);
  await assert.rejects(() => reserveMuseumRequest(db, now + 1001), { status: 429 });
  await reserveMuseumRequest(db, now + 1400);
  await assert.rejects(() => reserveMuseumRequest(db, now + 1899), { status: 429 });
});

test('daily budget cannot exceed 2000, and resets only on the next UTC day', async () => {
  const { db, sqlite } = fixture();
  const tomorrow = (Math.floor(now / 86400000) + 1) * 86400000;
  sqlite.prepare('INSERT INTO museum_quotas VALUES (?, ?, ?)').run('museum:daily', POLICY.upstreamPerDay - 1, tomorrow);
  await reserveMuseumRequest(db, now);
  await assert.rejects(() => reserveMuseumRequest(db, now + 500), { status: 503 });
  await reserveMuseumRequest(db, tomorrow);
  assert.equal((sqlite.prepare("SELECT count FROM museum_quotas WHERE key='museum:daily'").get() as {count:number}).count, 1);
});

test('museum cooldown honors long Retry-After values and cannot be shortened', async () => {
  const { db } = fixture();
  assert.equal(await pauseMuseum(db, '3600', now), 3600);
  await pauseMuseum(db, '1', now);
  await assert.rejects(() => reserveMuseumRequest(db, now + 1000), { status: 503 });
  await reserveMuseumRequest(db, now + 3600000);
  assert.equal(museumRetrySeconds('garbage', now), 60);
  assert.equal(museumRetrySeconds(new Date(now + 120000).toUTCString(), now), 120);
});

test('cache survives separate adapters and does not consume museum quota', async () => {
  const { db, sqlite } = fixture();
  await writeMuseumCache(db, 'a', '{"data":[]}', POLICY.searchTtlMs, now);
  const cached = await readMuseumCache(db, 'a');
  assert.equal(cached?.body, '{"data":[]}');
  assert.equal(cached?.expires_at, now + POLICY.searchTtlMs);
  assert.equal(cached?.stale_until, now + POLICY.searchTtlMs + POLICY.staleMs);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM museum_quotas').get()?.n, 0);
});

test('forwarded header spoofing does not create a new client bucket; no raw IP is stored', async () => {
  const a = await clientKey(new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }), now);
  const b = await clientKey(new Headers({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '2.2.2.2' }), now);
  assert.equal(a, b);
  assert.ok(!a.includes('203.0.113.7'));
  assert.notEqual(a, await clientKey(new Headers({ 'cf-connecting-ip': '203.0.113.8' }), now));
  assert.equal(await clientKey(new Headers({ 'x-forwarded-for': '1.1.1.1' }), now), await clientKey(new Headers({ 'x-forwarded-for': '2.2.2.2' }), now));
  assert.notEqual(a, await clientKey(new Headers({ 'cf-connecting-ip': '203.0.113.7' }), now + 86400000));
});


test('cache hits produce no outgoing request and rate limits return Retry-After without fetching', async () => {
  const { db } = fixture();
  const url = 'https://openaccess-api.clevelandart.org/api/artworks/123';
  await writeMuseumCache(db, url, '{"cached":true}', POLICY.searchTtlMs);
  let outgoing = 0;
  const fetcher = (async () => { outgoing++; return Response.json({ data: [] }); }) as typeof fetch;
  const request = new Request('https://artelier.test/api/artworks/123', { headers: { 'cf-connecting-ip': '203.0.113.20' } });
  for (let i = 0; i < 30; i++) {
    const response = await serveMuseumJSON(request, url, POLICY.searchTtlMs, x => x, db, fetcher);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-artelier-cache'), 'HIT');
  }
  const denied = await serveMuseumJSON(request, url, POLICY.searchTtlMs, x => x, db, fetcher);
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers.get('retry-after')) > 0);
  assert.equal(denied.headers.get('cache-control'), 'no-store');
  assert.equal(outgoing, 0);
});

test('storage failure and invalid upstream origins fail closed with zero external calls', async () => {
  let outgoing = 0;
  const fetcher = (async () => { outgoing++; return Response.json({}); }) as typeof fetch;
  const request = new Request('https://artelier.test/api/artworks');
  assert.equal((await serveMuseumJSON(request, 'https://openaccess-api.clevelandart.org/api/artworks/', 1000, x => x, undefined, fetcher)).status, 503);
  assert.equal((await serveMuseumJSON(request, 'https://untrusted.example/api/artworks/', 1000, x => x, undefined, fetcher)).status, 400);
  assert.equal(outgoing, 0);
});

test('an upstream 429 opens a shared circuit and later clients do not hit the museum', async () => {
  const { db } = fixture();
  let outgoing = 0;
  const fetcher = (async () => { outgoing++; return new Response('busy', { status: 429, headers: { 'Retry-After': '120' } }); }) as typeof fetch;
  const request = new Request('https://artelier.test/api/artworks', { headers: { 'cf-connecting-ip': '203.0.113.21' } });
  const url = 'https://openaccess-api.clevelandart.org/api/artworks/';
  const first = await serveMuseumJSON(request, url, 1000, x => x, db, fetcher);
  assert.equal(first.status, 503);
  assert.equal(first.headers.get('retry-after'), '120');
  const second = await serveMuseumJSON(request, url, 1000, x => x, db, fetcher);
  assert.equal(second.status, 503);
  assert.equal(outgoing, 1);
});

test('stale cache stays available during a museum outage without bypassing quotas', async () => {
  const { db } = fixture();
  const url = 'https://openaccess-api.clevelandart.org/api/artworks/456';
  await writeMuseumCache(db, url, '{"cached":true}', 1000, Date.now() - 2000);
  await pauseMuseum(db, '60');
  let outgoing = 0;
  const fetcher = (async () => { outgoing++; return Response.json({}); }) as typeof fetch;
  const request = new Request('https://artelier.test/api/artworks/456', { headers: { 'cf-connecting-ip': '203.0.113.22' } });
  const response = await serveMuseumJSON(request, url, 1000, x => x, db, fetcher);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-artelier-cache'), 'STALE');
  assert.equal(outgoing, 0);
});


test('edge-compatible manual redirects never follow an upstream redirect', async () => {
  const { db } = fixture();
  let calls = 0;
  const fetcher = (async (_url: unknown, options?: RequestInit) => {
    calls++;
    assert.equal(options?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
  }) as typeof fetch;
  const request = new Request('https://artelier.test/api/artworks', { headers: { 'cf-connecting-ip': '203.0.113.23' } });
  const response = await serveMuseumJSON(request, 'https://openaccess-api.clevelandart.org/api/artworks/', 1000, x => x, db, fetcher);
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
});


test('Vercel memory fallback enforces local quotas and stores cache without Cloudflare', async () => {
  const db = new MemoryPolicyDatabase();
  for (let i = 0; i < 30; i++) await admitClient(db, 'client:vercel', now);
  await assert.rejects(() => admitClient(db, 'client:vercel', now), { status: 429 });
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveMuseumRequest(db, now)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  await writeMuseumCache(db, 'vercel-cache', '{"ok":true}', 1000, now);
  assert.equal((await readMuseumCache(db, 'vercel-cache'))?.body, '{"ok":true}');
});

test('missing Redis uses explicitly scoped local protection; partial config fails closed', () => {
  const oldUrl = process.env.UPSTASH_REDIS_REST_URL, oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.equal(getProtectionStore().scope, 'instance');
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example';
    assert.throws(() => getProtectionStore(), /Incomplete/);
  } finally {
    if (oldUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
    if (oldToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
  }
});

test('Redis quota updates use a single atomic Lua operation and do not leak tokens into URLs', async () => {
  const original = globalThis.fetch;
  const commands: unknown[][] = [];
  globalThis.fetch = (async (url: unknown, options?: RequestInit) => {
    assert.equal(url, 'https://redis.example');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-only-token');
    const command = JSON.parse(String(options?.body)); commands.push(command);
    return Response.json({ result: JSON.stringify({ count: 1 }) });
  }) as typeof fetch;
  try {
    await admitClient(new RedisPolicyDatabase('https://redis.example', 'test-only-token'), 'client:test', now);
    assert.equal(commands.length, 1);
    assert.equal(commands[0][0], 'EVAL');
    assert.ok(String(commands[0][1]).includes('HSET'));
    assert.ok(String(commands[0][1]).includes('PEXPIREAT'));
  } finally { globalThis.fetch = original; }
});
