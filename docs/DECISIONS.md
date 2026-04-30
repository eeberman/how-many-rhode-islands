# Decisions Log

Every meaningful design choice and the alternatives considered. If you're tempted to "fix" something here, read the entry first — there's usually a reason.

---

### D-001: Static dataset + live fallback (hybrid)

**Choice:** Pre-curate ~500 entries (countries, US states, national parks, major cities). Use Wikidata as live fallback for the long tail.

**Alternatives:**
- Pure live: every query hits Wikidata. **Rejected**: latency on common queries; brittle to Wikidata downtime; rate limits.
- Pure static: only known places work. **Rejected**: anything weird ("Sahara Desert", "Pluto", "my backyard") fails.

**Tradeoff accepted:** Maintenance — adding new common entries means editing `places.json` + rerunning `build:geo`. Worth it for fast happy-path UX.

---

### D-002: world-atlas + us-atlas via npm (not Natural Earth direct)

**Choice:** Use the Mike Bostock npm packages `world-atlas` and `us-atlas` as bundled boundary sources.

**Alternatives:**
- Natural Earth direct from naturalearthdata.com: requires hosting/proxying the files; download adds build complexity.
- Geo-JSON CDN like geojson.io: not pinned, can drift.
- Self-hosted in repo: large binary, git noise.

**Why this works:** `world-atlas` is *literally Natural Earth* repackaged, pinned, and TopoJSON-encoded for compactness. Available offline once installed. Mike Bostock maintains it. ISC license.

---

### D-003: TopoJSON → GeoJSON conversion at build time

**Choice:** `scripts/build-geo.mjs` runs once, expanding TopoJSON to keyed GeoJSON, writing to `data/geo/*.json`.

**Alternatives:**
- TopoJSON at runtime: smaller files (~700KB countries-50m vs 1.5MB after expansion + quantization). **Rejected**: every request would `topojson.feature(...)` the whole world to extract one country. Too slow.
- Per-feature files (`data/geo/countries/RUS.json`, etc.): smaller individual loads. **Rejected for v1**: more files = more bookkeeping; current bundle size (~1.7MB total) is fine for free Vercel.

**Tradeoff accepted:** Slightly larger bundled JSON, but O(1) lookup at request time and trivial code.

---

### D-004: ISO numeric (not alpha-3) for country `geojson_key`

**Choice:** Use the `id` field that `world-atlas` already provides — ISO 3166-1 numeric (e.g. "643" for Russia, "840" for USA).

**Alternatives:**
- ISO alpha-3 ("RUS", "USA"): more human-readable. **Rejected**: requires a separate lookup table to convert; `world-atlas` doesn't include alpha-3 in the `id` field.
- Country name as key: human-friendly. **Rejected**: name collisions ("Congo" vs "Dem. Rep. Congo"), accents, name changes (Macedonia → North Macedonia).

**Tradeoff accepted:** Keys aren't human-readable in `places.json` (`"geojson_key": "643"` instead of `"RUS"`), but they're stable and unambiguous.

---

### D-005: Coordinate quantization to 3 decimals (~110m precision)

**Choice:** In `build-geo.mjs`, round all coordinates to 3 decimal places before writing.

**Math:** At a 400px viewBox, 1 viewBox unit ≈ 60-100 km (depends on the country's bounding box). 110m precision is well below 1 viewBox pixel.

**Why:** Cuts `countries.json` from 3.5MB → 1.5MB with no visible difference.

**Alternatives:**
- 4 decimals (~11m): same visual result, double the file size. **Rejected**.
- Topology-aware simplification (mapshaper): better preserves shared borders. **Rejected for v1**: extra build dep, not visible at our zoom level.

---

### D-006: `geoMercator` (not Albers, not Robinson)

**Choice:** d3-geo's `geoMercator()` for all projections.

**Alternatives:**
- `geoAlbersUsa` for US states: handles Alaska/Hawaii nicely. **Rejected**: introduces inconsistency between countries and states.
- `geoRobinson` / `geoEqualEarth`: more visually balanced for world view. **Rejected**: Mercator's straight-meridians make outline-recognition easier ("that's Russia" / "that's Italy").

**Caveat accepted:** Mercator distorts near the poles. Greenland looks oversized. We're showing single-country views, not a world map, so this rarely surfaces.

---

### D-007: Square fixed viewBox (not aspect-aware)

**Choice:** Always render into a 400×400 viewBox, regardless of the bigger shape's aspect ratio. Russia ends up wide-and-short within the box; England ends up narrow-and-tall.

**Alternatives:**
- Adaptive viewBox sized to the shape: tighter rendering. **Rejected**: layout would jump per-place, the legend would shift, and the visual comparison between two queries would be apples-to-oranges.

**The user explicitly chose this:** *"The bigger will always take the same basic amount of the screen. … Russia is really long, England is tall. These will still take up the same box on the screen, just shrunk down to fit."*

---

### D-008: Inner shape gets `transform`, not re-projection at smaller size

**Choice:** Project the smaller shape into a full `[INNER, INNER]` box, then apply `transform="translate(…) scale(…)"`.

**Alternatives:**
- Project the smaller shape directly into `[INNER * linear_ratio, INNER * linear_ratio]`: avoids the transform. **Rejected**: SVG transforms are more reliable than micro-projection at very small sizes; the transform also makes the math reusable for both branches of the flip.

**Side benefit:** `vector-effect="non-scaling-stroke"` only works with transforms — not with the projection-at-smaller-box approach.

---

### D-009: SSR (not SSG, not CSR)

**Choice:** Server-side render `[place]/page.tsx` on each request.

**Alternatives:**
- SSG (`generateStaticParams` for all 424 places): pre-renders at build time, fastest. **Rejected**: long-tail Wikidata fallback (Task 02) makes paths dynamic; we'd lose that.
- CSR with API: ship empty HTML, fetch JSON, render. **Rejected**: link unfurlers (iMessage, Twitter, Discord) only see empty HTML; OG metadata won't populate.

**Tradeoff accepted:** Each request does light server work. Vercel free tier handles this comfortably for a side project.

---

### D-010: Vercel KV (not Redis Cloud, not Upstash direct)

**Choice:** Vercel KV for caching long-tail Wikidata + OSM lookups.

**Alternatives:**
- Upstash Redis (also free, KV is built on Upstash anyway). **Rejected for default**: more wiring; Vercel KV auto-injects env vars.
- File-based cache in `/tmp`: free, no setup. **Rejected**: Vercel functions are ephemeral; `/tmp` doesn't persist across cold starts.
- No cache: every long-tail query hits Wikidata fresh. **Rejected**: latency + risk of being rate-limited.

**Free tier caps:** 30,000 commands/month, 256MB storage. We won't approach either at side-project traffic.

---

### D-011: Mobile-first, single-column

**Choice:** All layouts stack vertically. Even on desktop, the result content is a single centered column.

**Alternatives:**
- Side-by-side comparison on desktop: more "designed". **Rejected**: complexity not worth it for a site whose primary user is the project owner's mom on her phone.

---

### D-012: Dark navy + ocean blue (matching the t-shirt photo)

**Choice:** Background `#0F1A33`, RI fill `#0077B6`, outline `#F5EFE6`. Inspired by a real-world reference (the "Don't Mess With Rhode Island Either" t-shirt the project owner sent).

**Alternatives:**
- Light theme: more familiar. **Rejected**: the dark-and-bold aesthetic makes the size disparity visceral and screenshots look great in iMessage.

---

### D-013: Fraunces + DM Sans (not Inter, not Roboto)

**Choice:** Display font Fraunces (Google Fonts), body font DM Sans (Google Fonts).

**Why not Inter:** ubiquitous on AI-generated sites; we want a tiny bit of character.

**Why Fraunces:** has a slightly retro, optical-sizing feel that pairs well with the project's "rebuild of a beloved old website" tone.

---

### D-014: TypeScript, not JavaScript

**Choice:** Strict TS throughout.

**Why:** The project owner is a senior data analyst who works in typed environments (Scala, PySpark). TS keeps the contract between `places.json` schema, the rendering component, and the geo helper explicit.

---

### D-015: No client-side state library (no Zustand, no Redux)

**Choice:** React `useState` only, in `SearchBar.tsx`. No global store.

**Why:** The result page is fully server-rendered; there's no shared client state worth managing.

---

### D-016: Tuvalu is a placeholder rectangle

**Choice:** Tuvalu (10 sq mi) is in `places.json` but has no bundled GeoJSON because it's not present in `world-atlas` 1:50m source. Falls back to placeholder.

**Alternatives:**
- Use `world-atlas` 1:10m (3.5MB raw, includes more micro-states). **Rejected**: 4× the bundle size for a few extra island nations; not worth it.
- Hand-craft a Tuvalu polygon. **Rejected**: not worth the effort for v1.

**Acceptable**: Task 02 (Wikidata fallback) will improve the headline number for Tuvalu but won't add geometry. Placeholder rectangle is the long-term answer for tiny island nations.

---

### D-017: National parks and cities deferred to live fetch

**Choice:** Don't bundle GeoJSON for parks (Task 01) or cities (Task 03). Instead:
- Parks: fetch from NPS ArcGIS at build time, bundle the result.
- Cities: fetch from OSM Nominatim at request time, cache in KV.

**Why parks at build:** Park count is small (~62), boundaries change rarely, fits the "bundled" pattern.

**Why cities at runtime:** Cities are too numerous and too varied (city proper vs metro varies by country) to maintain a clean bundled list.

---

### D-018: NPS query broadened to include "National Preserve" unit type

**Choice:** Query `UNIT_TYPE IN ('National Park','National Park & Preserve','National Preserve')` instead of just `'National Park'`.

**Why:** New River Gorge National Park and Preserve is classified as `UNIT_TYPE = 'National Preserve'` in the NPS ArcGIS layer despite being officially designated a National Park since 2020. The task doc's original filter of `'National Park'` missed it. Gauley River National Recreation Area is not a National Park and correctly has no match.

**Tradeoff accepted:** Fetching ~20 extra NPS features (standalone preserves). These are silently ignored during name-matching since they don't correspond to any entry in our 62-park dataset. No correctness risk.

---

### D-019: "& Preserve" / "and Preserve" suffix stripping for park name matching

**Choice:** After applying `PARK_NAME_OVERRIDES`, index each NPS feature under both its full normalized name and a version with the preserve suffix stripped (`/\s*((&|and)\s*preserve)/i`).

**Why:** NPS names like "Wrangell - St Elias National Park & Preserve" don't normalize-match our dataset entry "Wrangell-St. Elias National Park". Stripping the suffix at index time avoids a large override table.

**Tradeoff accepted:** If a standalone preserve (no park) had the same prefix as one of our parks, it could match incorrectly. No such collision exists in our 62-park dataset.

---

### D-020: Gauley River National Recreation Area left as placeholder rectangle

**Choice:** Accept null geojson_key for "Gauley River National Recreation Area". It is the only `type: "national_park"` entry that will never match NPS because it is classified as a Recreation Area.

**Tradeoff accepted:** Gauley River renders a placeholder rectangle instead of a real outline. Acceptable — it's a river corridor, not a traditional park shape.

---

### D-021: Corrected Wikidata unit Q-ids after verification

**Choice:** Replaced all Q-ids in `UNIT_TO_SQ_MI` with verified values. Removed 3 wrong entries (Q3214456 = unknown, Q23725 = Byzantium, Q828224 = kilometre the length unit). Added 4 correct entries: Q232291 (square mile), Q25343 (square metre), Q81292 (acre), Q23931103 (square nautical mile).

**Alternatives:** The original table had comments claiming correct labels but the Q-ids were wrong — likely copy-paste errors when the table was first written. No alternatives considered; verification is just fact-checking.

**Tradeoff accepted:** None. Correct Q-ids strictly improve the system.

---

### D-022: /pluto 404s by design — Wikidata has no P2046 for Pluto

**Choice:** Accept that `/pluto` 404s. Wikidata entity Q339 (Pluto) has no P2046 (area) claim. Our code correctly returns null when no area data exists.

**Alternatives:** Adding Pluto to `places.json` as a static entry would fix it. Not worth the one-off for v1.

**Tradeoff accepted:** The task doc's acceptance criterion "Manual: /pluto returns a real number" cannot be met at the Wikidata layer. The system is correct; the data gap is Wikidata's.

---

---

### D-023: England bundled in countries.json with synthetic key, not fetched at runtime

**Choice:** Fetch England's boundary polygon from Nominatim once (locally), quantize it, and store it in `data/geo/countries.json` under the synthetic key `"england"`. Set `geojson_key: "england"` in `places.json`. England now resolves from bundled data with no live network dependency.

**Why England needs special handling:** England is a constituent country of the United Kingdom, not a sovereign state. It is absent from `world-atlas` (which only covers sovereign nations at ISO 3166-1 level). It cannot be matched by the normal `build-geo.mjs` country-lookup path.

**Alternatives:**
- Live OSM fetch at render time: unreliable from Vercel datacenter IPs (same root cause as the cities issue).
- Add a `gb-regions.json` file for constituent UK countries (England, Scotland, Wales, Northern Ireland): more organized but over-engineering for a single entry.
- Use a UK-specific GeoJSON dataset: another dependency to manage.

**Tradeoff accepted:** `build-geo.mjs` does not know about the `"england"` entry. Running `npm run build:geo` overwrites `countries.json` and loses the England polygon. Whoever runs `build:geo` must re-add England afterward. The long-term fix is to make `build:geo` preserve synthetic entries.

---

### D-024: Antimeridian rotation uses rotate([-center, 0]), not rotate([center, 0])

**Choice:** In `projectToBox`, apply `geoMercator().rotate([-center, 0])` where `center` is the longitude computed by `antimeridianCenter`.

**The sign convention:** `geoMercator().rotate([λ, 0])` adds `λ` to each geographic longitude before projecting. To center the feature at longitude `c`, we need `lon + λ = 0` when `lon = c`, so `λ = -c`. Using `+center` rotates the wrong direction and clips the feature at the wrong meridian (Russia splits at the Urals with `rotate([105, 0])`; it consolidates correctly with `rotate([-105, 0])`).

**Alternatives:** None considered — this is a correctness fix, not a design choice.

**Tradeoff accepted:** None. The sign derivation is documented here and in the code to prevent future "fixes" that re-introduce the wrong sign.

---

### D-025: NPS FeatureServer layer 2 (polygons), not layer 0 (centroids)

**Choice:** The NPS ArcGIS service has multiple layers. Layer 0 (`nps_boundary_centroids`) returns Point geometries. Layer 2 (`nps_boundary`) returns Polygon/MultiPolygon geometries. `build-geo.mjs` queries layer 2.

**Why this matters:** The original script queried layer 0, which returned centroid Points. Our geometry type check (`type !== 'Polygon' && type !== 'MultiPolygon'`) correctly rejected them, resulting in null geojson_key for all parks → placeholder rectangles.

**Tradeoff accepted:** Layer 2's `UNIT_TYPE` values use plural form (`'National Parks'`, not `'National Park'`). The WHERE clause must match exactly — a detail easy to regress if the query is edited.

---

### D-026: City OSM fetch uses cache:"no-store" (not next:{revalidate})

**Choice:** `fetchOSMBoundary` in `osm.ts` uses `cache: "no-store"`. Each page render makes a fresh request to Nominatim.

**History:**
- Original code had `signal: AbortSignal.timeout(TIMEOUT_MS)` combined with `next: { revalidate: N }`. In Next.js 15, these two options conflict — the fetch throws immediately and the catch block returns null. All OSM fetches silently failed.
- After removing `AbortSignal.timeout`, switched to `next: { revalidate: 2592000 }` (30 days). Suspected issue: the Next.js Data Cache on Vercel persists across deployments and may have cached failed responses from the broken era.
- Switched to `cache: "no-store"` to bypass the Data Cache entirely.

**Alternatives:**
- `next: { revalidate: 86400 }` (24h): better for production performance; re-try once DataCache-poisoning is confirmed cleared.
- Vercel KV for explicit caching: more control, more wiring.
- `cache: "force-cache"`: depends on Nominatim sending proper HTTP Cache-Control headers (it does not reliably).

**Tradeoff accepted:** Every city page render makes a live Nominatim HTTP request. Slower than cached (~500ms added latency on cold render). Acceptable for a side project with low traffic. If/when city boundaries are confirmed working, switch back to a caching strategy.

---

### D-027: Countries with remote outlying islands are a known visual defect (not yet fixed)

**Choice:** No fix implemented yet. France (`/france`) and Chile (`/chile`) currently render with the mainland occupying a small portion of the viewbox because `fitSize` must encompass the entire feature's geographic bounds, including distant overseas territories.

**Why archipelago countries work fine:** Greece (Aegean), Indonesia, Philippines, Japan — all islands are geographically close to the main landmass. The bounding box is tight and the mainland fills the frame.

**Why France/Chile break:** France's bounding box must include Réunion (56°E, Indian Ocean), French Guiana (−54°W), and New Caledonia (166°E, Pacific) alongside metropolitan France (−5° to 8°E). The resulting viewbox is mostly ocean.

**Proposed fix:** In `projectToBox`, detect MultiPolygon features, identify the dominant sub-polygon by bounding-box area, use only that polygon for `fitSize`, and still render all polygons using the resulting projection. Distant islands render off-screen. See ARCHITECTURE §8.1 and HANDOFF Issue 2 for the code sketch.

**Tradeoff accepted (current state):** France and Chile show visually wrong results. Acceptable for v1 — these are known, documented, and fixable without architectural changes.

---

When you make a meaningful decision while implementing a task, append it here. Format:

```
### D-NNN: [one-line decision]

**Choice:** what you did.

**Alternatives:** what you considered and why you rejected them.

**Tradeoff accepted:** what you give up.
```
