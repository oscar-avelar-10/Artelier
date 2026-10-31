# Artelier

An independent portfolio project by Oscar Avelar. Explore public-domain artworks from the Cleveland Museum of Art, search artists and titles, filter by medium and period, inspect artwork details, and build a browser-local collection.

## Stack

Next.js App Router conventions, React, TypeScript, TanStack Query and CSS. The Sites deployment uses Vinext's Next.js compatibility layer on Cloudflare Workers.

## Run

```sh
npm run dev
npm run build
```

## API and behavior

- `GET /api/artworks?q=monet&type=paintings&era=1800-1899&page=1` proxies and validates museum search requests.
- `GET /api/artworks/:id` retrieves artwork metadata and rejects images not marked public domain.
- Queries use cancellation, a five-minute client cache, previous-page placeholders and retry handling.
- Search is debounced by 400ms. Search, filters, page, collection view and artwork selection are reflected in the URL.
- Favorites use `localStorage` and stay on the current browser; no account or cross-device synchronization.
- The app handles upstream errors, network timeouts and rate limits. The default gallery presents museum highlights; search and category filters explore the broader open-access catalog.
- Search pagination is capped at 100 pages to avoid deep-pagination limits.

## Attribution

Artwork data and images: [Cleveland Museum of Art](https://www.clevelandart.org/). [API documentation](https://openaccess-api.clevelandart.org/). Artelier is independent and is not affiliated with the museum. Only artworks marked `share_license_status: CC0` are presented. Artwork descriptions are attributed to the museum; see its [API licensing information](https://openaccess-api.clevelandart.org/).
