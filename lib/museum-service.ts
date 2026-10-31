import { serveMuseumJSON } from './museum-service-core';
import { getProtectionStore } from './vercel-store';

export async function protectedMuseumJSON<T>(request: Request, upstreamUrl: string, ttl: number, transform: (raw: T) => unknown) {
  try {
    const { database, scope } = getProtectionStore();
    const headers = new Headers(request.headers);
    // Trust only headers overwritten by the deployed Vercel edge. Ignore client-supplied CF headers.
    headers.delete('cf-connecting-ip');
    if (process.env.VERCEL === '1') {
      const ip = headers.get('x-vercel-forwarded-for') || headers.get('x-forwarded-for');
      if (ip) headers.set('cf-connecting-ip', ip.split(',')[0].trim());
    }
    const response = await serveMuseumJSON(new Request(request.url, { method: request.method, headers }), upstreamUrl, ttl, transform, database);
    response.headers.set('X-Artelier-Protection-Scope', scope);
    return response;
  } catch {
    return Response.json({ error: 'The gallery is temporarily unavailable. Please try again shortly.' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
}
