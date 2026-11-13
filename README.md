# Artelier

An art discovery application for exploring open-access works from the Cleveland Museum of Art. Search artists and artworks, browse by medium and period, examine artwork details, and save favorites to a personal collection.

[Live Demo](https://artelier-oa.vercel.app)

## Features

- **Explore the collection:** start with museum highlights and discover more works through the open-access catalog.
- **Search and filter:** search by artist or title, browse paintings, prints, drawings, photography, and sculpture, and filter by historical period.
- **Artwork details:** view enlarged images alongside available information about the artist, date, medium, dimensions, origin, and credit line, with a link to the museum record.
- **Personal collection:** save and remove favorites, then search and filter your saved works. Collections persist in the current browser without an account.
- **Shareable views:** search, filters, pagination, collection view, and artwork selection are reflected in the URL. Saved collection contents remain local.
- **Responsive interface:** browse on desktop and mobile with loading placeholders, empty states, and actionable error messages.
- **Efficient requests:** debounced search, query cancellation, client caching, and server caching reduce repeated museum requests.

## Tech Stack

| Area                    | Technologies                                                    |
| ----------------------- | --------------------------------------------------------------- |
| Framework               | Next.js App Router, React, TypeScript                           |
| Styling                 | Tailwind CSS, custom CSS, Lucide icons                          |
| Client data             | TanStack Query                                                  |
| API                     | Next.js route handlers, Cleveland Museum of Art Open Access API |
| Persistence             | Browser `localStorage` for saved artworks                       |
| Server cache and quotas | In-memory adapter, optional Redis REST adapter                  |
| Testing                 | Node.js test runner, SQLite-backed policy tests                 |

## Getting Started

### Prerequisites

- Node.js **22.x**
- npm
- Internet access to retrieve museum metadata and images

### Installation

Clone this repository, open the project directory, and run:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The gallery works without environment variables, accounts, or a database service. Optional shared caching and quotas are described below.

### Production Build

```bash
npm run build
npm start
```

## Available Scripts

| Command             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Start the development server.                          |
| `npm run build`     | Create a production build.                             |
| `npm start`         | Serve the production build.                            |
| `npm test`          | Run the automated policy and protection adapter tests. |
| `npm run typecheck` | Check TypeScript types without emitting files.         |

## Project Structure

```text
app/                        Application page, layout, and global styles
app/api/artworks/           Artwork search and detail endpoints
components/artelier/        Gallery, artwork details, client API helpers, and types
lib/artworks.ts             Museum data models and normalization
lib/museum-service.ts       Next.js request adapter
lib/museum-service-core.ts  Upstream requests, validation, and caching
lib/museum-policy.ts        Quotas, cooldowns, and cache policy
lib/vercel-store.ts         In-memory and Redis protection adapters
tests/                      Automated policy and adapter tests
vercel.json                 Next.js deployment configuration
```

Legacy Cloudflare worker, database migration, and Sites tooling files are retained in the repository. They are not used by the current Next.js runtime.

## API

| Endpoint                | Description                                                       |
| ----------------------- | ----------------------------------------------------------------- |
| `GET /api/artworks`     | Search artworks with `q`, `type`, `era`, and `page` parameters.   |
| `GET /api/artworks/:id` | Retrieve details for an artwork eligible for open-access display. |

Example request:

```text
/api/artworks?q=monet&type=paintings&era=1800-1899&page=1
```

Requests validate search lengths, filter values, numeric IDs, pagination, duplicate parameters, and unknown parameters. Search pagination is capped at 100 pages. Upstream requests use a fixed museum origin and do not follow redirects.

The client debounces search by 400 ms, caches queries for five minutes, and keeps the previous results visible while another page loads. It does not automatically retry responses with status 400, 404, 429, or 503.

## Collections and Storage

Saved artworks use the `artelier.collection.v1` key in browser `localStorage`. Collections stay in the current browser and origin; they are not synchronized across devices or users. Clearing site storage removes saved artworks.

Museum metadata is retrieved through the application's API. Images load directly from the museum CDN, so browsing depends on the museum services being available.

## Caching and Request Limits

The application applies these limits to metadata requests:

| Control               | Policy                                                             |
| --------------------- | ------------------------------------------------------------------ |
| Client requests       | 30 requests per client per UTC minute                              |
| Upstream spacing      | At least 500 ms between new museum requests                        |
| Daily upstream budget | 2,000 admissions per UTC day                                       |
| Search cache          | 6 hours                                                            |
| Detail cache          | 24 hours                                                           |
| Stale cache fallback  | An additional 24 hours during upstream outages or exhausted quotas |

A museum `429` response triggers a cooldown of at least 60 seconds and respects a longer `Retry-After` value. These are application policies, not published service limits from the museum.

By default, cache entries, quotas, and cooldowns apply **per running server instance** and can reset on restarts or deployments. On Vercel, separate instances do not share these limits unless Redis is configured.

### Optional Shared Storage

To share caching, quotas, and cooldowns across instances, configure both server-side variables using a compatible Redis REST service:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

See `.env.example` for the configuration template. Keep credential values server-side and out of version control.

The Redis adapter uses atomic Lua operations for quota updates. Partial configuration or shared storage failures return `503` rather than falling back to instance-local limits. The `X-Artelier-Protection-Scope` response header identifies the active scope as `instance` or `shared`.

On Vercel, the request adapter uses platform-provided client IP headers and discards incoming Cloudflare IP headers. Outside Vercel, clients share a fallback bucket. Client identifiers are hashed with a daily namespace rather than stored as raw IP addresses.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

Tests cover the SQLite-backed policy, in-memory adapter, Redis command construction, concurrent requests, quotas, client IP handling, caching, cooldowns, redirects, and storage failure behavior. Redis command tests use mocks; they do not validate a live Redis deployment. Tests do not load-test the museum API.

## Attribution

Artwork images and metadata are provided by the [Cleveland Museum of Art](https://www.clevelandart.org/) through its [Open Access API](https://openaccess-api.clevelandart.org/). Only artworks marked `share_license_status: CC0` are presented.

Artelier is an independent project by Oscar Avelar and is not affiliated with the museum.
