import type { PolicyDatabase, Statement } from './museum-policy';

type Values = (string | number)[];
type Quota = { count: number; expires_at: number };
type Cached = { body: string; expires_at: number; stale_until: number };

// Fallback is deliberately per process. It must never be described as a global/serverless quota.
export class MemoryPolicyDatabase implements PolicyDatabase {
  private quotas = new Map<string, Quota>();
  private cache = new Map<string, Cached>();
  prepare(sql: string): Statement {
    let values: Values = [];
    const execute = () => {
      if (sql.startsWith('SELECT expires_at')) return this.quotas.get(String(values[0])) || null;
      if (sql.startsWith('SELECT body')) return this.cache.get(String(values[0])) || null;
      if (sql.startsWith('INSERT INTO museum_cache')) {
        if (this.cache.size >= 200 && !this.cache.has(String(values[0]))) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(String(values[0]), { body: String(values[1]), expires_at: Number(values[2]), stale_until: Number(values[3]) }); return null;
      }
      if (sql.includes("VALUES ('museum:spacing'")) {
        const old = this.quotas.get('museum:spacing');
        if (old && old.expires_at > Number(values[1])) return null;
        this.quotas.set('museum:spacing', { count: 1, expires_at: Number(values[0]) }); return { count: 1 };
      }
      if (sql.includes("VALUES ('museum:cooldown'")) {
        const expires_at = Math.max(this.quotas.get('museum:cooldown')?.expires_at || 0, Number(values[0]));
        this.quotas.set('museum:cooldown', { count: 1, expires_at }); return null;
      }
      if (sql.startsWith('INSERT INTO museum_quotas')) {
        const key = String(values[0]), now = Number(values[2]), old = this.quotas.get(key);
        if (old && old.expires_at > now && old.count >= Number(values[5])) return null;
        if (!old && this.quotas.size >= 4096) {
          for (const [k, v] of this.quotas) if (v.expires_at <= now) this.quotas.delete(k);
          if (this.quotas.size >= 4096) throw new Error('Local protection capacity reached');
        }
        const result = !old || old.expires_at <= now ? { count: 1, expires_at: Number(values[1]) } : { ...old, count: old.count + 1 };
        this.quotas.set(key, result); return { count: result.count };
      }
      if (sql.startsWith('DELETE FROM museum_cache')) { for (const [k, v] of this.cache) if (v.stale_until < Number(values[0])) this.cache.delete(k); return null; }
      if (sql.startsWith('DELETE FROM museum_quotas')) { for (const [k, v] of this.quotas) if (v.expires_at < Number(values[0])) this.quotas.delete(k); return null; }
      throw new Error('Unsupported protection operation');
    };
    return { bind(...input) { values = input; return this; }, async first<T>() { return execute() as T | null; }, async run() { execute(); } };
  }
}

const counterScript = `local expiry=tonumber(redis.call('HGET',KEYS[1],'expires_at') or '0')
local count=tonumber(redis.call('HGET',KEYS[1],'count') or '0')
if expiry<=tonumber(ARGV[2]) then count=0; expiry=tonumber(ARGV[1]) end
if count>=tonumber(ARGV[3]) then return false end
count=count+1
redis.call('HSET',KEYS[1],'count',count,'expires_at',expiry)
redis.call('PEXPIREAT',KEYS[1],expiry)
return cjson.encode({count=count})`;
const spacingScript = `local expiry=tonumber(redis.call('HGET',KEYS[1],'expires_at') or '0')
if expiry>tonumber(ARGV[2]) then return false end
redis.call('HSET',KEYS[1],'count',1,'expires_at',ARGV[1])
redis.call('PEXPIREAT',KEYS[1],ARGV[1])
return cjson.encode({count=1})`;
const cooldownScript = `local expiry=math.max(tonumber(redis.call('HGET',KEYS[1],'expires_at') or '0'),tonumber(ARGV[1]))
redis.call('HSET',KEYS[1],'count',1,'expires_at',expiry)
redis.call('PEXPIREAT',KEYS[1],expiry)
return false`;
const quotaReadScript = `local expiry=redis.call('HGET',KEYS[1],'expires_at')
if not expiry then return false end
return cjson.encode({expires_at=tonumber(expiry)})`;
const cacheWriteScript = `redis.call('SET',KEYS[1],ARGV[1]); redis.call('PEXPIREAT',KEYS[1],ARGV[2]); return false`;

/** REST Redis uses Lua for atomic cross-instance quota updates, with native key expiration. */
export class RedisPolicyDatabase implements PolicyDatabase {
  constructor(private url: string, private token: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid Redis endpoint');
  }
  private async command(args: (string | number)[]) {
    const response = await fetch(this.url, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), cache: 'no-store', signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('Shared protection storage unavailable');
    const data = await response.json() as { result?: unknown; error?: string };
    if (data.error) throw new Error('Shared protection operation failed');
    return data.result == null ? null : typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  }
  prepare(sql: string): Statement {
    let values: Values = [];
    const quotaKey = (name: string) => 'artelier:v1:quota:' + name;
    const cacheKey = (name: string) => 'artelier:v1:cache:' + name;
    const execute = async () => {
      if (sql.startsWith('SELECT expires_at')) return this.command(['EVAL', quotaReadScript, 1, quotaKey(String(values[0]))]);
      if (sql.startsWith('SELECT body')) return this.command(['GET', cacheKey(String(values[0]))]);
      if (sql.startsWith('INSERT INTO museum_cache')) return this.command(['EVAL', cacheWriteScript, 1, cacheKey(String(values[0])), JSON.stringify({ body: String(values[1]), expires_at: Number(values[2]), stale_until: Number(values[3]) }), Number(values[3])]);
      if (sql.includes("VALUES ('museum:spacing'")) return this.command(['EVAL', spacingScript, 1, quotaKey('museum:spacing'), Number(values[0]), Number(values[1])]);
      if (sql.includes("VALUES ('museum:cooldown'")) return this.command(['EVAL', cooldownScript, 1, quotaKey('museum:cooldown'), Number(values[0])]);
      if (sql.startsWith('INSERT INTO museum_quotas')) return this.command(['EVAL', counterScript, 1, quotaKey(String(values[0])), Number(values[1]), Number(values[2]), Number(values[5])]);
      if (sql.startsWith('DELETE FROM museum_')) return null; // Redis TTL removes expired keys automatically.
      throw new Error('Unsupported protection operation');
    };
    return { bind(...input) { values = input; return this; }, async first<T>() { return await execute() as T | null; }, async run() { await execute(); } };
  }
}

const memory = new MemoryPolicyDatabase();
let redis: RedisPolicyDatabase | undefined;
export function getProtectionStore(): { database: PolicyDatabase; scope: 'shared' | 'instance' } {
  const url = process.env.UPSTASH_REDIS_REST_URL, token = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Partial configuration fails closed instead of silently downgrading intended distributed protection.
  if (Boolean(url) !== Boolean(token)) throw new Error('Incomplete shared protection configuration');
  if (url && token) { redis ||= new RedisPolicyDatabase(url, token); return { database: redis, scope: 'shared' }; }
  return { database: memory, scope: 'instance' };
}
