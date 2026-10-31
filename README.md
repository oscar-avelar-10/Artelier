# Artelier

An independent art-discovery portfolio project by Oscar Avelar. Explore public-domain artworks from the Cleveland Museum of Art, search artists and titles, filter by medium and period, inspect artwork details, and build a browser-local collection.

## Stack

Next.js App Router, React, TypeScript, TanStack Query, Tailwind CSS and custom CSS. Production target: Vercel / Node.js. The app does not require ChatGPT authentication.

## Run

```sh
npm ci
npm run dev
npm test
npm run build
npm start
```

## Deploy to Vercel

Import or deploy the project as a Next.js application, with `npm ci` and `npm run build`. `vercel.json` supplies the defaults. No environment variables are required for the gallery to work.

Optional shared protection uses a compatible Upstash Redis REST database. Configure these **server-only** environment variables in Vercel, then redeploy:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

See `.env.example`. Never prefix these secrets with `NEXT_PUBLIC_`, commit real values or put them in a deployment URL. This project does not provision a Redis account or select a paid plan automatically.

## API and client behavior

- `GET /api/artworks?q=monet&type=paintings&era=1800-1899&page=1` validates and proxies museum search requests.
- `GET /api/artworks/:id` retrieves artwork metadata and rejects images not marked CC0.
- Queries support cancellation, a five-minute client cache, previous-page placeholders and error handling.
- Search is debounced by 400ms. Search, filters, page, collection view and artwork selection appear in the URL.
- Favorites use `localStorage`: they stay in the current browser, with no account or cross-device synchronization.
- The initial gallery presents museum highlights; searches and categories explore the broader open-access catalog.
- Search pagination is capped at 100 pages.

## Abuse protection and deployment scope

The protection policy retains these limits:

- 30 API requests per client per UTC minute.
- One new museum admission every 500ms and a 2,000-admission daily UTC budget.
- Search cache: 6 hours. Detail cache: 24 hours. Cached responses can serve stale for another 24 hours during outages or exhausted upstream quotas.
- A museum `429` pauses requests for at least 60 seconds and respects a longer `Retry-After`. The browser does not automatically retry 400, 404, 429 or 503.
- Input lengths, allowed filters, numeric IDs, page bounds, duplicate parameters and unknown parameters are validated. Cache keys are normalized. The museum origin and path are fixed; redirects are not followed.

**Without Redis**, quotas, cooldowns and server cache apply **per running Vercel instance**. They can reset after cold starts or deployments and are not a global rate or daily cap. Memory use is bounded. This fallback keeps the gallery usable without extra services, but offers weaker protection than the original shared D1 backend.

**With Redis**, quota changes use atomic Lua scripts and the cache/cooldown are shared across instances. Configured shared storage failures fail closed; partial configuration returns 503 instead of silently reverting to local controls. The response header `X-Artelier-Protection-Scope` reports `instance` or `shared`.

On Vercel, only the platform-overwritten client IP headers are used. Incoming Cloudflare headers are discarded; outside Vercel, visitors share a conservative fallback bucket. IPs are hashed in a daily namespace rather than stored verbatim. Museum images load directly from the museum CDN, independently of the metadata API.

The official CMA documentation does not specify a requests-per-second allowance. These are conservative application limits, not a promise from the provider. They do not replace a platform WAF against a large denial-of-service attack. Shared Redis support is optional and must be configured before describing limits as global.

## Validation

`npm test` covers the SQLite-backed policy, local adapter, atomic Redis command construction, concurrency, quotas, spoofed headers, cache, cooldowns, redirects and fail-closed behavior. Redis command tests are mocked; they do not prove a live Redis service is provisioned. Tests do not load-test the museum.

## Migration history

The earlier Sites/Cloudflare deployment is recorded in the Git history. Its old configuration and migration artifacts are excluded from Vercel uploads and are not used by the Next.js runtime. The original live site is preserved until Vercel deployment is verified.

## Attribution

Artworks, images and data: [Cleveland Museum of Art](https://www.clevelandart.org/). [Open Access API documentation](https://openaccess-api.clevelandart.org/). Artelier is independent and is not affiliated with the museum. Only artworks marked `share_license_status: CC0` are presented.
