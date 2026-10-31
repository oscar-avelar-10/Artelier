/** Distributed controls. Every admission is a conditional SQLite write, never an in-memory counter. */
export const POLICY = { perClientPerMinute: 30, upstreamSpacingMs: 500, upstreamPerDay: 2000, searchTtlMs: 6 * 3600000, detailTtlMs: 24 * 3600000, staleMs: 24 * 3600000 } as const;

export interface Statement {
  bind(...values: (string | number)[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface PolicyDatabase { prepare(sql: string): Statement }
export class PolicyError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter: number) { super(message); }
}

export const COUNTER_SQL = `INSERT INTO museum_quotas (key, count, expires_at) VALUES (?, 1, ?)
 ON CONFLICT(key) DO UPDATE SET
 count = CASE WHEN museum_quotas.expires_at <= ? THEN 1 ELSE museum_quotas.count + 1 END,
 expires_at = CASE WHEN museum_quotas.expires_at <= ? THEN excluded.expires_at ELSE museum_quotas.expires_at END
 WHERE museum_quotas.expires_at <= ? OR museum_quotas.count < ? RETURNING count`;

async function counter(db: PolicyDatabase, key: string, limit: number, now: number, expiry: number) {
  return db.prepare(COUNTER_SQL).bind(key, expiry, now, now, now, limit).first<{ count: number }>();
}

export async function clientKey(headers: Headers, now: number) {
  // Cloudflare overwrites this header at ingress. Never trust visitor-controlled X-Forwarded-For.
  // Missing/invalid trusted metadata shares one bucket; it does not disable protection.
  const raw = headers.get('cf-connecting-ip') || '';
  const ip = raw.length <= 45 && /^[0-9a-fA-F:.]+$/.test(raw) ? raw : 'shared-unknown-client';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${Math.floor(now / 86400000)}:${ip}`));
  return 'client:' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

export async function admitClient(db: PolicyDatabase, key: string, now = Date.now()) {
  const expiry = (Math.floor(now / 60000) + 1) * 60000;
  if (!await counter(db, key, POLICY.perClientPerMinute, now, expiry)) {
    throw new PolicyError('Too many requests. Please wait a moment before trying again.', 429, Math.max(1, Math.ceil((expiry - now) / 1000)));
  }
}

export async function reserveMuseumRequest(db: PolicyDatabase, now = Date.now()) {
  const cooldown = await db.prepare('SELECT expires_at FROM museum_quotas WHERE key = ?').bind('museum:cooldown').first<{ expires_at: number }>();
  if (cooldown && cooldown.expires_at > now) throw new PolicyError('The museum asked us to pause. Please try again later.', 503, Math.ceil((cooldown.expires_at - now) / 1000));

  // One global lease, shared by every Worker instance and every visitor. No bursts at second boundaries.
  const lease = await db.prepare(`INSERT INTO museum_quotas (key, count, expires_at) VALUES ('museum:spacing', 1, ?)
    ON CONFLICT(key) DO UPDATE SET expires_at = excluded.expires_at
    WHERE museum_quotas.expires_at <= ? RETURNING count`).bind(now + POLICY.upstreamSpacingMs, now).first<{ count: number }>();
  if (!lease) throw new PolicyError('The gallery is busy. Please try again in a moment.', 429, 1);

  const dayEnds = (Math.floor(now / 86400000) + 1) * 86400000;
  if (!await counter(db, 'museum:daily', POLICY.upstreamPerDay, now, dayEnds)) {
    throw new PolicyError('The gallery has reached today’s museum request budget. Please try again tomorrow.', 503, Math.max(1, Math.ceil((dayEnds - now) / 1000)));
  }
}

export function museumRetrySeconds(value: string | null, now = Date.now()) {
  const seconds = value && /^\d+$/.test(value) ? Number(value) : value ? Math.ceil((Date.parse(value) - now) / 1000) : 60;
  // Never retry sooner than the museum requested; keep a minimum pause even if it gives no useful value.
  return Math.max(60, Number.isFinite(seconds) ? seconds : 60);
}

export async function pauseMuseum(db: PolicyDatabase, retryAfter: string | null, now = Date.now()) {
  const seconds = museumRetrySeconds(retryAfter, now);
  await db.prepare(`INSERT INTO museum_quotas (key, count, expires_at) VALUES ('museum:cooldown', 1, ?)
    ON CONFLICT(key) DO UPDATE SET expires_at = MAX(museum_quotas.expires_at, excluded.expires_at)`).bind(now + seconds * 1000).run();
  return seconds;
}

export type CacheEntry = { body: string; expires_at: number; stale_until: number };
export async function readMuseumCache(db: PolicyDatabase, key: string) {
  return db.prepare('SELECT body, expires_at, stale_until FROM museum_cache WHERE key = ?').bind(key).first<CacheEntry>();
}
export async function writeMuseumCache(db: PolicyDatabase, key: string, body: string, ttl: number, now = Date.now()) {
  if (new TextEncoder().encode(body).length > 500000) return;
  await db.prepare(`INSERT INTO museum_cache (key, body, expires_at, stale_until) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at, stale_until = excluded.stale_until`)
    .bind(key, body, now + ttl, now + ttl + POLICY.staleMs).run();
  // Bounded, indexed cleanup; no persistent raw IPs or unbounded per-window keys.
  await db.prepare('DELETE FROM museum_cache WHERE key IN (SELECT key FROM museum_cache WHERE stale_until < ? LIMIT 100)').bind(now).run();
  await db.prepare('DELETE FROM museum_quotas WHERE key IN (SELECT key FROM museum_quotas WHERE expires_at < ? LIMIT 100)').bind(now - 86400000).run();
}
