import { admitClient, clientKey, readMuseumCache, writeMuseumCache, reserveMuseumRequest, pauseMuseum, PolicyError, type CacheEntry } from './museum-policy.ts';
import type { PolicyDatabase } from './museum-policy.ts';

const MUSEUM_ORIGIN = 'https://openaccess-api.clevelandart.org';
const blockedClients = new Map<string, number>();
const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function json(body: string, cache: string) { return new Response(body, { headers: { ...noStore, 'Content-Type': 'application/json; charset=utf-8', 'X-Artelier-Cache': cache } }); }
function failure(error: PolicyError) { return Response.json({ error: error.message }, { status: error.status, headers: { ...noStore, 'Retry-After': String(error.retryAfter) } }); }

/** A cache miss is the only code path allowed to contact the museum. DB errors fail closed. */
export async function serveMuseumJSON<T>(request: Request, upstreamUrl: string, ttl: number, transform: (raw: T) => unknown, database: PolicyDatabase | undefined, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...noStore, Allow: 'GET' } });
  const url = new URL(upstreamUrl);
  if (url.origin !== MUSEUM_ORIGIN || !/^\/api\/artworks\/(\d+)?$/.test(url.pathname)) {
    return failure(new PolicyError('Invalid museum request.', 400, 1));
  }
  let stale: CacheEntry | null = null;
  const now = Date.now();
  try {
    const db = database;
    if (!db) throw new Error('Protection database unavailable');
    const key = await clientKey(request.headers, now);
    const blockedUntil = blockedClients.get(key) || 0;
    if (blockedUntil > now) throw new PolicyError('Too many requests. Please wait before trying again.', 429, Math.ceil((blockedUntil - now) / 1000));
    try { await admitClient(db, key, now); } catch (error) {
      if (error instanceof PolicyError && error.status === 429) {
        if (blockedClients.size >= 1024) blockedClients.clear();
        blockedClients.set(key, now + error.retryAfter * 1000);
      }
      throw error;
    }
    const cached = await readMuseumCache(db, upstreamUrl);
    if (cached && cached.expires_at > now) return json(cached.body, 'HIT');
    if (cached && cached.stale_until > now) stale = cached;
    await reserveMuseumRequest(db);
    const response = await fetcher(upstreamUrl, { signal: AbortSignal.timeout(12000), redirect: 'manual' });
    if (response.status === 429) {
      const seconds = await pauseMuseum(db, response.headers.get('retry-after'));
      throw new PolicyError('The museum asked us to pause. Please try again later.', 503, seconds);
    }
    if (!response.ok) throw new PolicyError(response.status === 404 ? 'This artwork could not be found.' : 'The museum is temporarily unavailable. Please try again.', response.status === 404 ? 404 : 502, 30);
    const raw = await response.json() as T;
    const body = JSON.stringify(transform(raw));
    await writeMuseumCache(db, upstreamUrl, body, ttl);
    return json(body, 'MISS');
  } catch (error) {
    if (stale) return json(stale.body, 'STALE');
    if (error instanceof PolicyError) return failure(error);
    console.error('Museum request protection failed:', error instanceof Error ? error.message : 'unknown error');
    return failure(new PolicyError('The gallery is temporarily unavailable. Please try again shortly.', 503, 30));
  }
}
