# Architecture

This doc explains *how the system works*. Read top-to-bottom on first contact; reference specific sections later.

## 1. The premise

Rhode Island is **1,214 sq mi**. For any other place, the question is:

```
ratio = place_area / 1214
```

If `ratio >= 1`: "X Rhode Islands fit inside [place]."
If `ratio < 1`: flipped form: "Rhode Island is (1/ratio)× bigger than [place]."

Both branches share the same visual: the bigger of the two shapes fills a fixed box; the smaller sits centered inside, scaled to its true relative size.

## 2. Request flow

```
                                             ┌──────────────────────┐
   GET /russia                               │ data/places.json     │
        │                                    │ (425 entries)        │
        ▼                                    └──────────────────────┘
   src/app/[place]/page.tsx (SSR)                       │
        │                                               │ findPlaceBySlug
        │ resolvePlace("russia")                        │
        │      │                                        │
        │      ├──→ static lookup (places.ts) ◀────────┘
        │      │       └──→ Place { name, area_sq_mi, ri_ratio, geojson_key }
        │      │
        │      └──→ Wikidata fallback if not found in static dataset
        │
        │ getFeatureAsync(place)
        │      │
        │      ├──→ getFeature(type, geojson_key)        ← countries, states, parks, England
        │      │       └──→ data/geo/*.json              ← bundled, O(1) lookup
        │      │
        │      ├──→ fetchOSMBoundary(name, "city")       ← cities only (live fetch)
        │      │       └──→ Nominatim API → MultiPolygon
        │      │
        │      └──→ fetchOSMBoundary(name)               ← unkeyed countries (live fetch)
        │
        ▼
   <ScaleCompare place riFeature searchedFeature />
        │
        ▼
   projectToBox(feature, INNER)                          ← d3-geo Mercator
        └──→ SVG <path d="…"> strings
        
   HTML response (server-rendered)
```

## 3. The rendering algorithm

This is the part that is easy to get subtly wrong. Read carefully before touching `ScaleCompare.tsx`.

### 3.1 The math

Given `area_searched` and `area_ri`, the **linear** ratio (not the area ratio) is:

```
linear_ratio = sqrt(area_smaller / area_bigger)
```

This is the part that's easy to mess up: if A has 100× the area of B, then B's *linear size* is `1/sqrt(100) = 1/10` of A's, not `1/100`.

### 3.2 The viewBox

```
┌────────────────────────────────────┐  ◀── viewBox: 400×400
│                                    │
│   ┌────────────────────────────┐  │  ◀── PADDING: 20 on each side
│   │                            │  │
│   │                            │  │
│   │      INNER box: 360×360   │  │  ◀── INNER = VIEWBOX - 2*PADDING
│   │                            │  │
│   │                            │  │
│   └────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### 3.3 Projecting the bigger shape

```ts
const center = antimeridianCenter(biggerFeature);
const projection = geoMercator().rotate([-center, 0]).fitSize([INNER, INNER], biggerFeature);
const path = geoPath(projection)(biggerFeature);
```

`fitSize` does three things at once:
1. Scales the feature so its bounding box fits inside `[INNER, INNER]`.
2. **Preserves aspect ratio** (Russia stays wide, England stays tall — no cropping, no distortion).
3. Centers the result at `(INNER/2, INNER/2)`.

The bigger shape is rendered at `transform="translate(PADDING, PADDING)"`, so its center sits at `(VIEWBOX/2, VIEWBOX/2)`.

### 3.4 Projecting the smaller shape

The smaller shape is also projected to fill `[INNER, INNER]` *as if* it were the only shape. Then it gets scaled down + repositioned via SVG transform.

```ts
const innerTranslate = (INNER / 2) * (1 - linear_ratio) + PADDING;
const transform = `translate(${innerTranslate} ${innerTranslate}) scale(${linear_ratio})`;
```

**Derivation:** After `scale(s)`, a point at `(INNER/2, INNER/2)` moves to `(s·INNER/2, s·INNER/2)`. We want it at `(INNER/2 + PADDING) = VIEWBOX/2`. So `tx = (INNER/2)(1 - s) + PADDING`.

**Why not re-project at smaller size:** SVG transforms are more reliable than micro-projection at very small sizes; `vector-effect="non-scaling-stroke"` only works via transforms.

### 3.5 `vector-effect="non-scaling-stroke"`

When `scale(0.0136)` (Russia case) is applied, strokes also scale to ~0.027px and disappear. Setting `vector-effect="non-scaling-stroke"` on the inner `<path>` keeps the stroke at its declared width regardless of transform.

### 3.6 Sub-pixel safety net

When `INNER * linear_ratio < 4` (inner shape smaller than 4 pixels), render a small `<circle>` at viewBox center as a guaranteed-visible marker. Russia's ratio (0.0136 → 4.9px) is just above this threshold.

### 3.7 The flip (smaller-than-RI case)

When `place.area_sq_mi < RI_AREA_SQ_MI`:
- "bigger" is RI; "smaller" is the searched place.
- Outer shape: ocean-blue filled RI.
- Inner shape: white-stroked outline of the searched place.
- Headline: *"Rhode Island is X× bigger than [place]"*.

The math is symmetric — only the colors and headline change.

## 4. Antimeridian handling

Features crossing the ±180° longitude line (Russia, Alaska, Fiji, Kiribati, New Zealand) render split across the viewbox without correction.

**Fix:** Detect antimeridian-crossing features by checking `max_lon - min_lon > 180°`. Unwrap negative longitudes (+360°) to make the range contiguous, compute the midpoint, and rotate the Mercator projection so the feature is centered away from the clip boundary.

```typescript
// geo.ts
function antimeridianCenter(feature): number {
  // Returns center longitude to rotate to (0 = no crossing, no rotation)
  const lons = collectLongitudes(feature.geometry);
  const min = Math.min(...lons), max = Math.max(...lons);
  if (max - min <= 180) return 0;
  // Unwrap negatives, find midpoint
  const unwrapped = lons.map(l => l < 0 ? l + 360 : l);
  const uMin = Math.min(...unwrapped), uMax = Math.max(...unwrapped);
  const center = (uMin + uMax) / 2;
  return center > 180 ? center - 360 : center;
}

// In projectToBox:
const center = antimeridianCenter(feature);
geoMercator().rotate([-center, 0]).fitSize([INNER, INNER], feature)
//                   ↑ NEGATIVE of center — d3-geo adds λ to each longitude,
//                   so rotate([-c, 0]) centers the feature at longitude c.
```

**Sign convention (critical):** `geoMercator().rotate([λ, 0])` maps each geographic longitude as `lon + λ`. To center on longitude `c`, set `λ = -c`. Getting this wrong (using `+center`) clips the feature at the wrong meridian and splits it.

## 5. Data layer

### 5.1 `data/places.json`

The static dataset. 425 entries, four types: `country`, `us_state`, `national_park`, `city`.

```json
{
  "name": "Russia",
  "slug": "russia",
  "type": "country",
  "area_sq_mi": 6612100,
  "ri_ratio": 5446.54,
  "geojson_key": "643"
}
```

`geojson_key` is `null` for entries without bundled boundary data (cities, Tuvalu). `"england"` is a synthetic key for the manually bundled England polygon.

### 5.2 `data/geo/countries.json`

Map: `key → GeoJSON Feature`. Keys are ISO numeric codes for sovereign countries (e.g. "643" = Russia) plus the synthetic key `"england"` for England's separately bundled polygon. ~200 entries, ~2MB after quantization.

England is in this file because it is a constituent country of the UK — not present in `world-atlas` (which only has sovereign states). Its boundary was fetched from Nominatim locally and bundled.

### 5.3 `data/geo/us-states.json`

Map: `FIPS code → GeoJSON Feature`. 50 entries. ~245KB.

### 5.4 `data/geo/national-parks.json`

Map: `NPS unit code → GeoJSON Feature`. ~61 entries. Generated from NPS ArcGIS `FeatureServer/2` (polygon layer — not layer 0, which is centroids).

### 5.5 The build script

`scripts/build-geo.mjs` is the only thing that writes to `data/geo/` (except the manual England addition) and updates `geojson_key` in `data/places.json`. Run via `npm run build:geo`.

**Note:** `build-geo.mjs` does NOT handle cities (live fetch at runtime) or constituent countries like England (manually bundled). It also does not know about the `"england"` entry in `countries.json` — if you run `build:geo` again, it will overwrite `countries.json` WITHOUT England. Re-add England after any `build:geo` run:

```bash
npm run build:geo
node -e "
const fs = require('fs');
const countries = JSON.parse(fs.readFileSync('data/geo/countries.json', 'utf8'));
// ... re-fetch and re-add England if missing
"
```

The better long-term fix is to have `build:geo` know about synthetic entries and preserve them. See DECISIONS D-023.

## 6. Feature resolution chain

`getFeatureAsync(place)` in `geo.ts` resolves features in this order:

```
place.geojson_key is set?
  └─ YES → look up in bundled data (countries / states / parks)
  └─ NO  → place.type === "city"?
              └─ YES → fetchOSMBoundary(place.name, "city")
              └─ NO  → place.type === "country"?
                          └─ YES → fetchOSMBoundary(place.name)   [no featuretype filter]
                          └─ NO  → return null → placeholder rectangle
```

The `featuretype` param distinction matters: `featuretype=city` filters Nominatim results to city-class features. Constituent countries like England (before it was bundled) were not classified as `featuretype=city` in Nominatim — omitting the filter lets Nominatim return the best match by importance.

## 7. File responsibility map

| File | Responsibility | Should NOT |
|---|---|---|
| `places.ts` | Static dataset access. Search. Slug normalization. Ratio formatting. | Know about GeoJSON. |
| `geo.ts` | GeoJSON lookup. d3-geo projection. Antimeridian detection. | Know about Place metadata beyond `type` + `geojson_key`. |
| `osm.ts` | Nominatim HTTP fetch. Quantize. | Cache to disk (let Next.js handle HTTP caching). |
| `places.json` | Hold the curated dataset. | Be hand-edited for `geojson_key` (let `build-geo` do that, except for manual entries). |
| `[place]/page.tsx` | Resolve slug → Place. Fetch features. SSR the page. Generate metadata. | Render shapes (delegates to `ScaleCompare`). |
| `ScaleCompare.tsx` | Compute linear_ratio. Render the SVG. | Know about lookup, caching, or fallback chains. |
| `SearchBar.tsx` | Autocomplete UX. Escape hatch. | Know about result rendering. |
| `build-geo.mjs` | One-time GeoJSON construction. | Be in the runtime path. |

## 8. Known visual issues

### 8.1 Outlying islands (France, Chile)

Countries with small islands far from the mainland render with the mainland shrunken into the viewbox. `fitSize` must fit the entire feature's geographic bounding box — if France's bounding box must include Réunion (Indian Ocean), metropolitan France occupies a tiny fraction.

**Archipelago countries (Greece, Indonesia, Philippines) are fine** because all islands are geographically close; the bounding box is tight.

**Proposed fix:** In `projectToBox`, use the largest sub-polygon's bounds for `fitSize`, but still render the whole feature. See HANDOFF Issue 2 for the code sketch.

**Affected countries in dataset:** France, Chile, USA (Hawaii — but world-atlas contiguous-US boundary excludes Hawaii by default), Norway (Svalbard), Portugal (Azores), Spain (Canary Islands).

### 8.2 City outlines on Vercel

Live Nominatim fetches for city boundaries (`cache: "no-store"`) may fail if Vercel's function IPs are blocked or throttled by Nominatim. Cities fall back to placeholder rectangles. See HANDOFF Issue 1 for diagnosis steps.

## 9. Constraints (which shaped many decisions)

- **Free Vercel only**: no paid services.
- **Mobile-first**: phones are primary. The viewBox + layout are sized for ~375px wide screens.
- **Shareable URLs**: the entire reason this exists is so the project owner's mom can send him a link.
- **SSR over CSR**: search engines and link unfurlers (iMessage, Twitter) need server-rendered HTML to scrape OG tags.

## 10. Where to extend (and where not to)

**Easy:**
- New static entries → edit `places.json`, run `build:geo`.
- New visual style → edit `ScaleCompare.tsx`. Math is stable; only paint changes.
- New autocomplete behavior → edit `searchPlaces()` in `places.ts`.

**Harder:**
- Fix outlying-island projection → edit `projectToBox` in `geo.ts`. (See §8.1 for approach.)
- Fix city boundary reliability → edit `osm.ts` fetch strategy or switch data source.
- New bundled boundary category → edit `build-geo.mjs` + `geo.ts`.

**Off-limits without re-reading this doc:**
- The math in `ScaleCompare.tsx`. It is correct.
- The antimeridian sign in `rotate([-center, 0])`. Using `+center` splits Russia.
- The viewBox dimensions. `VIEWBOX=400, PADDING=20` are baked into transform derivations.
