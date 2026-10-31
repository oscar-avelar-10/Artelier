import { env } from 'cloudflare:workers';
import { serveMuseumJSON } from './museum-service-core';

export function protectedMuseumJSON<T>(request: Request, upstreamUrl: string, ttl: number, transform: (raw: T) => unknown) {
  return serveMuseumJSON(request, upstreamUrl, ttl, transform, env.DB);
}
