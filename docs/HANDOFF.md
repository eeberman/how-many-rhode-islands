# How Many Rhode Islands — Handoff

You (Claude Code, or any future contributor) are picking up an in-progress side project. Read this doc, then look at the outstanding issues below.

## TL;DR

- **What it is**: A simple web app. User searches a place; gets *"X Rhode Islands fit inside [place]"* with a to-scale visual. Mobile-first, dark navy + ocean blue.
- **Why it exists**: The original site (`howmanyrhodeislands.com`, long defunct) was beloved by the project owner's mom. He's rebuilding it for her so she has a simple way to share results back to him.
- **Stack**: Next.js 15 App Router on Vercel free tier. TypeScript. Tailwind. d3-geo for projections. `world-atlas` + `us-atlas` + NPS ArcGIS for bundled boundary data. OSM Nominatim for live city boundary fetches.
- **Status**: All five original tasks are done and deployed to Vercel. Two outstanding visual issues remain (see below).

## Quickstart

```bash
npm install
npm run dev      # → http://localhost:3000
```

GeoJSON for countries, states, and parks is built and committed. Re-run only if `data/places.json` changes:

```bash
npm run build:geo
```

## Current State

| Feature | Status | Where it lives |
|---|---|---|
| Search + autocomplete | ✅ | `src/components/SearchBar.tsx` |
| Result page (SSR, shareable URL) | ✅ | `src/app/[place]/page.tsx` |
| Visual: countries (real outlines) | ✅ | `data/geo/countries.json` |
| Visual: US states (real outlines) | ✅ | `data/geo/us-states.json` |
| Visual: national parks | ✅ | `data/geo/national-parks.json` |
| Visual: cities | 🟢 | `src/lib/osm.ts` + `getFeatureAsync()` — works locally; Vercel reliability unverified |
| Long-tail (anything not in `places.json`) | ✅ | `src/lib/wikidata.ts` + `[place]/page.tsx` |
| OG image / share card | ✅ | `src/app/[place]/opengraph-image.tsx` + `ShareButton` |
| Inline search on result page | ✅ | `<SearchBar />` at bottom of `[place]/page.tsx` |
| Deployed to Vercel | ✅ | Auto-deploy from GitHub |
| Vercel Analytics | ✅ | `<Analytics />` in layout; enable in Vercel dashboard |
| Antimeridian (Russia, Alaska) | ✅ | `antimeridianCenter()` + `rotate([-center, 0])` in `geo.ts` |
| England bundled | ✅ | `countries.json["england"]` — no live fetch |

Legend: ✅ done · 🟢 wired but reliability unverified · 🟡 stubbed · 🔴 broken

---

## Outstanding Issues

### Issue 1: City outlines may show as placeholder boxes on Vercel

**Symptom:** Searching a city (e.g. New York City, Tokyo) shows a rounded white rectangle instead of the city's real boundary polygon.

**Root cause (best hypothesis):** OSM Nominatim may block or throttle requests from Vercel's datacenter IP ranges. The fetch in `osm.ts` uses `cache: "no-store"` — it makes a live request on every page render. If Nominatim returns a non-200 response or a Point geometry (not a Polygon), we return null → placeholder rectangle.

**What was already fixed:**
- Removed `AbortSignal.timeout()` which was incompatible with Next.js 15 fetch and caused all OSM fetches to throw silently
- Removed `next: { revalidate }` which may have cached failed responses across deployments
- Confirmed locally that Nominatim returns correct MultiPolygon geometries for all tested cities

**What to try next:**
- Check Vercel function logs for `[osm] fetchOSMBoundary failed:` warnings on city page requests
- If Nominatim is blocking: switch to a self-hosted Nominatim, a paid geocoding API (MapBox, Google), or pre-bundle a set of city boundaries from a public dataset (Natural Earth ne_10m_populated_places has simplified city polygons)
- Alternative: use the Overpass API (`overpass-api.de`) which is more datacenter-permissive

**Files to touch:** `src/lib/osm.ts` (fetch strategy), `src/lib/geo.ts` (getFeatureAsync), possibly `data/geo/cities.json` if bundling.

---

### Issue 2: Outlying islands cause mainland to appear tiny (France, Chile, etc.)

**Symptom:** Countries with small islands far from the mainland render with the mainland shrunken into a tiny corner of the box, surrounded by empty ocean. France's Réunion (Indian Ocean) and Chile's Easter Island (Pacific) are the clearest cases. The "archipelago" pattern (Greece, Indonesia, Philippines) works correctly because all islands are near the mainland — the issue is specifically *remote* outlying territories.

**Root cause:** `geoMercator().fitSize([INNER, INNER], feature)` fits the **entire feature's geographic bounding box** to the viewbox. For France, the bounding box must span from metropolitan France (8°E) to Réunion (56°E) and French Guiana (−54°W), making metropolitan France occupy a tiny fraction of the box.

**Known-good examples (archipelagos work fine):** Greece (Aegean islands), Indonesia, Philippines, New Zealand, Japan — all look correct because their islands are geographically close to the main landmass.

**Known-bad examples:**
| Country | Outlying territory | Approx. distance from mainland |
|---|---|---|
| France | Réunion, Martinique, French Guiana, New Caledonia | 3,000–16,000 km |
| Chile | Easter Island (Isla de Pascua) | ~3,700 km |
| USA | Hawaii, Guam | ~4,000–8,000 km |
| Norway | Svalbard | ~1,900 km |
| Portugal | Azores, Madeira | ~1,400–1,600 km |
| Spain | Canary Islands | ~1,100 km |

Note: USA doesn't have this problem in the current app because Alaska's antimeridian fix centers on the Far East, and the 50-state boundary in `world-atlas` uses a standard contiguous-state projection. However France and Chile are visibly broken today.

**Proposed fix approach — filter by largest polygon:**

For a MultiPolygon feature, identify the largest sub-polygon (by area or bounding-box size as a proxy), use ONLY that polygon's bounding box for `fitSize`, but still render all polygons using the resulting projection. Distant islands will render off-screen or at the edges — acceptable, since the mainland fills the frame.

```typescript
// In geo.ts — new helper
function mainlandBounds(feature: Feature<Geometry, unknown>): Feature<Geometry, unknown> {
  if (feature.geometry.type !== 'MultiPolygon') return feature;
  // Find the polygon with the largest bounding-box area (lon-span × lat-span)
  const polys = feature.geometry.coordinates;
  let best = polys[0], bestArea = 0;
  for (const poly of polys) {
    const lons = poly[0].map(p => p[0]);
    const lats = poly[0].map(p => p[1]);
    const area = (Math.max(...lons) - Math.min(...lons)) * (Math.max(...lats) - Math.min(...lats));
    if (area > bestArea) { best = poly; bestArea = area; }
  }
  // Return a synthetic single-polygon feature for bounds computation only
  return { ...feature, geometry: { type: 'Polygon', coordinates: best } };
}

export function projectToBox(feature, boxSize) {
  const center = antimeridianCenter(feature);
  const boundsFeature = mainlandBounds(feature);   // ← use mainland for fitSize
  const projection = geoMercator().rotate([-center, 0]).fitSize([boxSize, boxSize], boundsFeature);
  const path = geoPath(projection);
  return path(feature) ?? '';   // ← still render the whole feature
}
```

**Caveat:** This heuristic uses bounding-box area as a proxy for polygon size. It fails if an overseas territory is large enough to have a bigger bounding box than a narrow mainland (e.g. if we ever added French Guiana separately). For our static dataset, visual inspection of all country entries after the fix is recommended.

**Alternative fix — explicit mainland clip in places.json:**

Add an optional `mainland_bbox: [minLon, minLat, maxLon, maxLat]` field to `places.json` entries. When present, use it instead of the computed bounds for `fitSize`. More control, more maintenance.

---

## How to read this doc set

1. **Skim** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — data flow, rendering math, file responsibilities.
2. **Skim** [`DECISIONS.md`](./DECISIONS.md) — every meaningful design choice and the reasoning behind it.
3. **Reference** [`docs/reference/`](./reference/) for API contracts, sources, and troubleshooting.

## Key files (cheat sheet)

| Path | Role | Touch when… |
|---|---|---|
| `data/places.json` | Static dataset, 425 entries. Source of truth. | Adding new pre-curated places. Rerun `build:geo` after. |
| `data/geo/countries.json` | Country boundaries, keyed by ISO numeric code + "england" synthetic key. | Generated by build-geo. "england" entry was manually added from Nominatim data. |
| `data/geo/us-states.json` | 50 state boundaries, keyed by FIPS code. | Generated. Don't hand-edit. |
| `data/geo/national-parks.json` | ~61 park boundaries, keyed by NPS unit code. | Generated by build-geo (NPS ArcGIS layer 2). |
| `scripts/build-geo.mjs` | One-time GeoJSON build. | Adding new boundary sources or re-pulling fresh data. |
| `src/app/[place]/page.tsx` | The result route. SSR. Resolves slug, fetches features, renders page. | Page-level changes, metadata, OG. |
| `src/components/ScaleCompare.tsx` | The to-scale SVG. Math + rendering. | Visual changes. Math is stable — read ARCHITECTURE.md §3 before touching. |
| `src/lib/places.ts` | Static dataset access + search. | Autocomplete, fuzzy match. |
| `src/lib/geo.ts` | GeoJSON lookup + d3-geo projection. | Adding new feature sources, fixing projection bugs. |
| `src/lib/osm.ts` | OSM Nominatim fetch for city boundaries. | City fetch strategy, caching. |
| `src/lib/wikidata.ts` | Wikidata fallback for long-tail places. | Long-tail coverage. |
| `src/components/SearchBar.tsx` | Autocomplete + "search anyway" escape hatch. | UX changes. |

## Project-specific glossary

| Term | Meaning |
|---|---|
| **RI** | Rhode Island. 1,214 sq mi. The unit. |
| **linear_ratio** | `sqrt(area_smaller / area_bigger)`. Used to scale the inner shape. Always in `[0, 1]`. |
| **the flip** | When the searched place is smaller than RI, the visual flips: RI becomes the container; the searched place sits inside. Headline copy also flips: *"Rhode Island is X× bigger than [place]"*. |
| **static dataset** | `data/places.json`. The 425 places we've pre-curated. |
| **long-tail** | Any query not in the static dataset. Falls through to Wikidata fallback. |
| **placeholder rectangle** | The rounded square `ScaleCompare` renders when no GeoJSON is available for a place. Math/layout identical to real-shape rendering. |
| **bigger / smaller** | In `ScaleCompare`, refers to which shape (searched vs RI) has the larger area. Distinguishes the *rendering role* from the *user-facing identity*. |
| **viewBox** | The SVG coordinate system. Always `400×400`. `PADDING=20`; inner box is `360×360`. |
| **antimeridian crossing** | A feature whose longitude range exceeds 180° — it straddles the ±180° line. Russia, Alaska, Fiji, Kiribati. Handled by `antimeridianCenter()` + `rotate([-center, 0])`. |

## Non-goals (don't waste time on these)

- ❌ Authentication. The site has no users.
- ❌ Database. Static files + live fetches are the only storage layer.
- ❌ Multi-language support. English-only for v1.
- ❌ An admin panel. Adding new places means editing `data/places.json` directly.
- ❌ Pixel-perfect cross-browser polish. Modern browsers only.
- ❌ Comprehensive test suite. Manual checklist is sufficient for v1.
- ❌ Accessibility audit beyond basic semantic HTML.
