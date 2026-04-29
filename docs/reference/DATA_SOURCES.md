# Data Sources

Every piece of data this project depends on. If a source disappears or changes shape, this is your map of where to look and what to update.

## Bundled (in repo)

### `data/places.json`

**What:** The static dataset of 424 curated places. Hand-edited.

**Schema:**
```ts
{
  name: string;          // display name, e.g. "Russia"
  slug: string;          // URL-safe, e.g. "russia"
  type: "country" | "us_state" | "national_park" | "city";
  area_sq_mi: number;
  ri_ratio: number;      // = area_sq_mi / 1214
  geojson_key: string | null; // links to data/geo/*.json or null for placeholder
}
```

**Update flow:** Hand-edit the JSON, then run `npm run build:geo` to refresh `geojson_key` and the `data/geo/*.json` files.

**Source notes per category:**
- Countries: ISO 3166 list with areas from CIA World Factbook and Wikipedia (Wikipedia where Factbook is missing).
- US states: areas from US Census Bureau (total area including water).
- National parks: areas from NPS official figures (acres → sq mi).
- Cities: city-proper areas where reasonably comparable. Some cities use metro/admin division (Tokyo, London, Beijing) where city-proper isn't a meaningful concept.

### `data/geo/countries.json`

**What:** GeoJSON Features keyed by ISO 3166-1 numeric code. 196 entries.

**Generated from:** `world-atlas/countries-50m.json` (npm package by Mike Bostock, derived from Natural Earth).

**Update:** `npm run build:geo`.

**Size:** ~1.5MB after coordinate quantization to 3 decimals (~110m precision).

### `data/geo/us-states.json`

**What:** GeoJSON Features keyed by FIPS code. 50 entries.

**Generated from:** `us-atlas/states-10m.json` (npm package by Mike Bostock, derived from US Census TIGER).

**Update:** `npm run build:geo`.

**Size:** ~245KB.

### `data/geo/national-parks.json` (after Task 01)

**What:** GeoJSON Features keyed by NPS UNIT_CODE (e.g. "YELL"). ~62 entries.

**Generated from:** NPS ArcGIS Feature Service (live fetch in `build-geo.mjs`).

**Update:** `npm run build:geo` (requires internet at build time).

## Live (runtime)

### Wikidata — long-tail area lookup (Task 02)

**Endpoint:** `https://www.wikidata.org/w/api.php` (search) and `https://www.wikidata.org/wiki/Special:EntityData/<Q-id>.json` (entity details).

**What we get:** Area (P2046) for arbitrary named entities — countries, cities, deserts, planets, rivers, etc.

**Cost:** Free. No API key. Polite user-agent required.

**License:** [CC0](https://www.wikidata.org/wiki/Wikidata:Licensing) (public domain). Attribution appreciated but not required.

**Rate limits:** Generous; no documented hard limit. Be reasonable, cache aggressively.

**Caching:** Vercel KV with 30-day TTL for hits, 24h for misses.

### OSM Nominatim — city boundary lookup (Task 03)

**Endpoint:** `https://nominatim.openstreetmap.org/search`

**What we get:** GeoJSON polygon for a named place (specifically: cities).

**Cost:** Free.

**License:** [ODbL](https://www.openstreetmap.org/copyright). Attribution required if data is republished. We don't republish the geometry — we render it ephemerally. For v1, no attribution is shown; consider adding a tiny "Data: OpenStreetMap" footer on city result pages if Nominatim usage grows.

**Rate limits:** **Hard limit of 1 request/second**. [Usage policy](https://operations.osmfoundation.org/policies/nominatim/) explicitly prohibits bulk geocoding. Our cache strategy keeps us well under this.

**User-Agent:** Required. Use a descriptive UA with contact info.

**Caching:** Vercel KV with 30-day TTL for hits, 1h for rate-limit errors, 24h for legitimate misses.

## Third-party services

### Vercel KV (production cache)

**What:** Redis-compatible KV store, used to cache Wikidata + OSM results.

**Cost:** Free tier: 30,000 commands/month, 256MB storage, 256MB bandwidth/month.

**Setup:** Provision via Vercel dashboard → Storage tab → Create Database → KV. Auto-injects env vars (`KV_REST_API_URL`, `KV_REST_API_TOKEN`).

**Local dev:** `vercel env pull .env.local` to use the same KV in development.

**Fallback:** If env vars are absent, `src/lib/cache.ts` no-ops gracefully — app works without caching, just slower.

### Vercel (hosting)

**What:** Next.js hosting + edge functions + KV.

**Cost:** Free hobby tier covers everything in the v1 scope.

**Limits to know:**
- 100 GB bandwidth/month (we're nowhere close).
- 100 GB-Hr serverless function execution time (irrelevant for our SSR pages).
- Build time: 45 min/build (we're under 2 min).

## Removed / not used

A few sources were considered and rejected. Documented here so they don't get re-litigated:

- **Google Places API** — costs money after free tier, requires key in client.
- **Mapbox tilesets** — overkill for our needs; we render once per request, not interactively.
- **Natural Earth direct download** — replaced by `world-atlas` npm package (same data, easier to consume).
- **GeoNames** — free but spotty area data quality, especially for non-country entities.
- **Bing Maps API** — costs money.
- **REST Countries** — easy and free for country areas, but our static dataset already covers all countries with curated values.

## License summary

| Source | License | Implications for us |
|---|---|---|
| Natural Earth (via `world-atlas`) | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/) | None. Use freely. |
| US Census TIGER (via `us-atlas`) | Public domain (US gov work) | None. |
| NPS boundary data | Public domain (US gov work) | None. |
| Wikidata | CC0 | None. Attribution appreciated. |
| OpenStreetMap | ODbL | If we republish significant geometry, attribution required. Currently we don't. |

**Project license:** Not yet defined. Recommend MIT or Apache-2.0 if open-sourcing. Add a `LICENSE` file before public release.
