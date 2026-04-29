# Task 03: City Boundaries via OSM

## Goal

Replace the placeholder rounded square with real boundary outlines for the 115 entries of `type: "city"` in the static dataset. Fetch from OpenStreetMap Nominatim on-demand, simplify, cache in Vercel KV.

## Pre-flight checks

```bash
# 1. Task 02 should be complete (verifies the long-tail fallback is working).
test -f src/lib/wikidata.ts && echo "ok: wikidata wired" || echo "FAIL: complete Task 02 first"

# 2. Confirm Nominatim reachability
curl -sI 'https://nominatim.openstreetmap.org/search?q=Tokyo&format=json&limit=1' \
  -H 'User-Agent: HowManyRhodeIslands/1.0' \
  | head -1
# Expected: HTTP/2 200

# 3. Confirm 115 city entries currently lack geojson_key
node -e '
  const places = require("./data/places.json");
  const cities = places.filter(p => p.type === "city");
  const stubs = cities.filter(p => !p.geojson_key);
  console.log(`cities: ${cities.length}, currently without key: ${stubs.length}`);
'
# Expected: cities: 115, currently without key: 115
```

## Acceptance criteria

- [ ] New file `src/lib/osm.ts` with a typed `fetchCityBoundary(slug, displayName)` function.
- [ ] `src/lib/geo.ts` is now async-aware: `getFeature()` becomes `getFeatureAsync()` for runtime fetches; static lookups still synchronous.
- [ ] Cities use `getFeatureAsync()` and the result feeds into `ScaleCompare`.
- [ ] `ScaleCompare` accepts a pre-resolved feature (or null) instead of fetching itself — keeps it pure / async-free.
- [ ] Manual: `/tokyo-japan` → real Tokyo metropolis outline visible (Tokyo is large enough that RI sits inside).
- [ ] Manual: `/paris-france` → flips correctly: RI outline as container, Paris commune (small) inside.
- [ ] Manual: `/manila-philippines` → flips: RI outline, tiny Manila inside.
- [ ] Manual: same URL twice — second hit is fast (cache hit).
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` succeeds.

## Source: OSM Nominatim

**Endpoint:** `https://nominatim.openstreetmap.org/search`

**The query:**
```
GET https://nominatim.openstreetmap.org/search
  ?q=<display name>
  &format=geojson
  &polygon_geojson=1
  &limit=1
  &featuretype=city
```

**Returns:** GeoJSON FeatureCollection. The first feature's `geometry` is what we want (Polygon or MultiPolygon).

### Critical: Nominatim usage policy

Nominatim is a free, volunteer-run service with strict rules:

1. **Max 1 request per second**. We respect this naturally — requests are user-driven and KV-cached.
2. **Must include a descriptive User-Agent** (see Task 02 wikidata.ts pattern).
3. **No bulk geocoding**. Don't pre-warm the cache for all 115 cities at once. Let cache fill organically as users hit pages.
4. **Caching is encouraged**, not optional. Once we cache a city, it lives ~indefinitely (cities don't move).

> If we ever exceed the rate limit, we get a temporary 429. The KV cache means this is unlikely at side-project scale.

### Geometry quality caveat

Nominatim's "city" boundary varies by country:
- Tokyo: returns Tokyo Metropolis (847 sq mi). Matches our dataset.
- Paris: returns the commune (41 sq mi). Matches our dataset.
- New York: may return NYC (303 sq mi) or NY County (Manhattan, 23 sq mi) — depends on the disambiguation.

Our `places.json` has both `name` ("Tokyo, Japan") and a known `area_sq_mi`. We trust our area number; the geometry is just for visualization. If OSM returns a wildly different boundary, the visual ratio will look "off" relative to the headline number. This is acceptable for v1 — area is the authoritative number, geometry is decorative.

## Implementation

### 1. New file: `src/lib/osm.ts`

```ts
/**
 * OSM Nominatim city boundary lookup.
 *
 * Returns a GeoJSON Feature (Polygon or MultiPolygon) for a city,
 * or null if not found / rate-limited / network error.
 *
 * Caching: uses Next.js fetch cache (`next: { revalidate: N }`), matching
 * the approach in wikidata.ts. No external cache service required.
 *
 * Found results cache for 30 days (cities don't move).
 * Negative results aren't cached at this layer (Next caches successful
 * fetches only) — repeated 404s for the same city will re-hit Nominatim.
 * Acceptable at side-project traffic.
 */

import type { Feature, Polygon, MultiPolygon } from "geojson";

const UA = "HowManyRhodeIslands/0.1 (https://github.com/your-handle/how-many-rhode-islands)";
const TIMEOUT_MS = 5000;
const CACHE_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

/**
 * Quantize coordinates to ~110m precision (3 decimals).
 * Same approach as build-geo.mjs to keep responses small.
 */
function quantize(geom: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const mapPoint = (pt: number[]) => [round(pt[0]), round(pt[1])];
  const mapRing = (ring: number[][]) => ring.map(mapPoint);
  const mapPolygon = (poly: number[][][]) => poly.map(mapRing);
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: mapPolygon(geom.coordinates) };
  }
  return {
    type: "MultiPolygon",
    coordinates: geom.coordinates.map(mapPolygon),
  };
}

/**
 * Public API: fetch a city's boundary by display name.
 * Returns null on rate limit, missing geometry, or network error.
 */
export async function fetchCityBoundary(
  displayName: string
): Promise<Feature<Polygon | MultiPolygon, { name: string }> | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", displayName);
    url.searchParams.set("format", "geojson");
    url.searchParams.set("polygon_geojson", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("featuretype", "city");

    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: CACHE_TTL_SEC },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const f = data.features?.[0];
    if (!f?.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) {
      return null;
    }

    return {
      type: "Feature",
      properties: { name: displayName },
      geometry: quantize(f.geometry),
    };
  } catch (err) {
    console.warn("[osm] fetchCityBoundary failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
```

### 2. Modify: `src/lib/geo.ts`

Add the async variant alongside the sync `getFeature`:

```ts
import { fetchCityBoundary } from "./osm";
import type { Place } from "./places";

/**
 * Resolves a feature for any place, including cities (which require an async fetch).
 * Use this from server components; falls through to null for unmatched.
 */
export async function getFeatureAsync(
  place: Place
): Promise<Feature<Geometry, { name: string }> | null> {
  // Synchronous lookup (countries, US states, parks)
  const sync = getFeature(place.type, place.geojson_key ?? null);
  if (sync) return sync;

  // Async lookup (cities)
  if (place.type === "city") {
    return fetchCityBoundary(place.name);
  }

  return null;
}
```

### 3. Modify: `src/components/ScaleCompare.tsx`

Refactor to accept pre-resolved features instead of resolving them itself. This keeps the component pure and async-free.

Change the props:

```ts
interface Props {
  place: Place;
  searchedFeature: Feature<Geometry, { name: string }> | null;
  riFeature: Feature<Geometry, { name: string }>;
}

export default function ScaleCompare({ place, searchedFeature, riFeature }: Props) {
  // delete the getFeature / getRhodeIslandFeature calls inside;
  // everything else stays the same
}
```

### 4. Modify: `src/app/[place]/page.tsx`

Resolve features before passing to `ScaleCompare`:

```ts
import { getFeatureAsync, getRhodeIslandFeature } from "@/lib/geo";

// inside PlacePage, after `if (!place) notFound();`:
const [searchedFeature, riFeature] = await Promise.all([
  getFeatureAsync(place),
  Promise.resolve(getRhodeIslandFeature()),
]);

// then in JSX:
<ScaleCompare
  place={place}
  searchedFeature={searchedFeature}
  riFeature={riFeature}
/>
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| 429 from Nominatim | Hit rate limit (1 req/sec). | Should be rare with KV cache. If it happens, the function caches the miss for 1h and returns null (placeholder shown). |
| Slow page load on first city visit | Synchronous on server; user sees nothing until OSM responds. | Acceptable for v1 (~500ms). If this hurts UX, consider streaming or a "loading" state. |
| Wrong city returned (e.g. "Springfield" without state) | Ambiguous query. | Our names include qualifiers ("Springfield, IL") — should disambiguate naturally. If not, append the country to the query. |
| Tokyo geometry comes back as a point, not polygon | OSM doesn't have a polygon for that admin level. | Our code handles this — returns null, falls back to placeholder. |
| Cache returns `null` repeatedly for a city we expect to work | Cached miss with 24h TTL (no boundary returned previously). | Wait 24h, or manually clear: `vercel env exec -- redis-cli DEL osm:<slug>`. |
| Geometry imports broken in TypeScript | `@types/geojson` may be stale. | `npm install @types/geojson@latest -D`. |
| `ScaleCompare` props mismatch | Forgot to update one of the two callers. | Search: `rg "ScaleCompare" src/`. Should be exactly two: import + render. |

## Pitfall: don't pre-warm the cache

Tempting to write a script that loops through all 115 cities and warms the KV cache. **Do not.** That's exactly the bulk-geocoding pattern Nominatim's policy forbids. Let the cache fill organically as users hit pages.

## Validation

```bash
# Local dev
npm run dev

# Visit a few city pages (each will be slow first time, fast after):
# /tokyo-japan          → Tokyo metropolis outline, RI inside
# /paris-france         → flips: RI outline, Paris commune inside
# /manila-philippines   → flips: RI outline, tiny Manila inside
# /new-york-city-ny     → check disambiguation; should not be NY County

# Re-visit the same URL — should be ~10× faster (cache hit).

# Typecheck + build
npx tsc --noEmit
npm run build
```

## When done

- [ ] All acceptance criteria check.
- [ ] Update `docs/HANDOFF.md` Current State: flip `Visual: cities` from 🟡 to ✅.
- [ ] Append a decision to `docs/DECISIONS.md` if non-obvious (e.g. cache TTL policy, disambiguation strategy).
- [ ] Commit: `feat(03-cities): add OSM city boundaries with KV cache`.
