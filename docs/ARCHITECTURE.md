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
   GET /russia                                  │ data/places.json     │
        │                                       │ (424 entries)        │
        ▼                                       └──────────────────────┘
   src/app/[place]/page.tsx (SSR)                          │
        │                                                  │ findPlaceBySlug
        │ resolvePlace("russia")                           │
        │      │                                           │
        │      ├──→ static lookup (places.ts) ◀────────────┘
        │      │       │
        │      │       └──→ Place { name, area_sq_mi, ri_ratio, geojson_key }
        │      │
        │      └──→ [Task 02] Wikidata fallback if not found
        │
        ▼
   <ScaleCompare place={place} />  ───────┐
        │                                  │ getFeature(type, geojson_key)
        ▼                                  ▼
   src/lib/geo.ts                 ┌──────────────────────┐
        │ projectToBox()           │ data/geo/            │
        │ (d3-geo Mercator)        │   countries.json     │
        │                          │   us-states.json     │
        ▼                          └──────────────────────┘
   <svg> with two <path> elements
        │
        ▼
   HTML response
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
const projection = geoMercator().fitSize([INNER, INNER], biggerFeature);
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
const projection = geoMercator().fitSize([INNER, INNER], smallerFeature);
const path = geoPath(projection)(smallerFeature);

// Transform: scale around viewBox center, no separate translate-back needed
// because we've collapsed the math:
//   After scale(s), a point at (INNER/2, INNER/2) is at (s*INNER/2, s*INNER/2).
//   We want it at (INNER/2 + PADDING) = (VIEWBOX/2).
//   ∴ tx = (INNER/2)(1 - s) + PADDING

const innerTranslate = (INNER / 2) * (1 - linear_ratio) + PADDING;
const transform = `translate(${innerTranslate} ${innerTranslate}) scale(${linear_ratio})`;
```

**Why not `translate(viewBoxCenter) scale(s) translate(-viewBoxCenter) translate(PADDING)`?**

Because that's four operations and the math is fragile. The collapsed form is one translate + one scale, derived once. If you find yourself "fixing the centering," check the derivation above first; the math is correct.

### 3.5 `vector-effect="non-scaling-stroke"`

When `scale(0.0136)` (Russia case) is applied, *strokes* would also scale to ~0.027px and disappear. We don't want that — we want the inner shape to remain visibly outlined.

Setting `vector-effect="non-scaling-stroke"` on the inner `<path>` keeps the stroke at its declared width regardless of transform.

### 3.6 Sub-pixel safety net

When `linear_ratio < 4 / INNER` (i.e. the inner shape is smaller than 4 pixels), even a non-scaling stroke can be hard to see. We render a small `<circle>` at viewBox center as a guaranteed-visible marker. Currently triggers at `INNER * linear_ratio < 4` — Russia's ratio (0.0136 → 4.9px) is just above this threshold.

If you change `INNER` or want the fallback to kick in for more cases, edit the threshold in `ScaleCompare.tsx`.

### 3.7 The flip (smaller-than-RI case)

When `place.area_sq_mi < RI_AREA_SQ_MI`:
- "bigger" is RI; "smaller" is the searched place.
- Outer shape: ocean-blue filled RI.
- Inner shape: white-stroked outline of the searched place.
- Headline: *"Rhode Island is X× bigger than [place]"*.

The math is symmetric — only the colors and the headline change.

## 4. Data layer

### 4.1 `data/places.json`

The static dataset. 424 entries, four types: `country`, `us_state`, `national_park`, `city`.

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

`geojson_key` is `null` for entries without bundled boundary data (parks, cities, Tuvalu).

### 4.2 `data/geo/countries.json`

Map: `ISO numeric code → GeoJSON Feature`. 196 entries. ~1.5MB after coordinate quantization to 3 decimals.

### 4.3 `data/geo/us-states.json`

Map: `FIPS code → GeoJSON Feature`. 50 entries. ~245KB.

### 4.4 The build script

`scripts/build-geo.mjs` is the only thing that writes to `data/geo/` and the only thing that updates `geojson_key` in `data/places.json`. Run via `npm run build:geo` whenever you add new entries to `places.json` or want fresh boundary data.

## 5. File responsibility map

| File | Responsibility | Should NOT |
|---|---|---|
| `places.ts` | Static dataset access. Search. Slug normalization. Ratio formatting. | Know about GeoJSON. |
| `geo.ts` | GeoJSON lookup. d3-geo projection. | Know about Place metadata beyond `type` + `geojson_key`. |
| `places.json` | Hold the curated dataset. | Be hand-edited for `geojson_key` (let `build-geo` do that). |
| `[place]/page.tsx` | Resolve slug → Place. SSR the page. Generate metadata. | Render shapes (delegates to `ScaleCompare`). |
| `ScaleCompare.tsx` | Compute linear_ratio. Render the SVG. | Know about lookup, caching, or fallback chains. |
| `SearchBar.tsx` | Autocomplete UX. Escape hatch. | Know about result rendering. |
| `build-geo.mjs` | One-time GeoJSON construction. | Be in the runtime path. |

If a future change crosses these lines (e.g. "ScaleCompare needs to know if a place is a city"), reconsider — usually the right move is to push the decision *up* to the page or down to a new dedicated module.

## 6. The hybrid lookup strategy

Coverage by tier:

| Tier | Source | Latency | Coverage | Cost |
|---|---|---|---|---|
| 1. Static | `data/places.json` | ~0ms | 424 curated places | Free, bundled |
| 2. Long-tail (Task 02) | Wikidata SPARQL | ~500ms-2s first time, ~0ms cached | Most named entities on Earth | Free, KV-cached |
| 3. City geometry (Task 03) | OSM Nominatim | ~500ms-1s first time, ~0ms cached | Most major cities | Free, KV-cached, rate-limited |

The page uses tier 1 for everything in the static dataset. For unknown slugs, it falls through to tier 2 (Wikidata) for area data and stays at the placeholder rectangle for the visual. Tier 3 upgrades the visual for city entries (which are in tier 1 for area but lack bundled geometry).

## 7. Constraints (which shaped many decisions)

- **Free Vercel only**: no paid services. KV free tier is generous (30,000 reqs/month, 256MB storage).
- **Mobile-first**: phones are primary. The viewBox + layout are sized for ~375px wide screens.
- **No login, no analytics beyond Vercel's free**: keep the surface area small.
- **Shareable URLs**: the entire reason this exists is so the project owner's mom can send him a link.
- **SSR over CSR**: search engines and link unfurlers (iMessage, Twitter) need server-rendered HTML to scrape OG tags.

## 8. Where to extend (and where not to)

**Easy to extend:**
- New static entries → edit `places.json`, run `build:geo`.
- New visual style → edit `ScaleCompare.tsx`. Math is stable; only paint changes.
- New autocomplete behavior → edit `searchPlaces()` in `places.ts`.

**Harder:**
- New boundary source → edit `build-geo.mjs` *and* `geo.ts` *and* `ScaleCompare.tsx` (just to know the new place type can have real geometry).
- New entry type → touch every file in the responsibility map. Avoid unless necessary.

**Off-limits without re-reading this doc:**
- The math in `ScaleCompare.tsx`. It's correct. If something looks "off-center," 99% of the time it's a CSS issue, not a math issue.
- The viewBox dimensions. Many things are derived from `VIEWBOX=400, PADDING=20`. Changing these means recomputing transform formulas.
