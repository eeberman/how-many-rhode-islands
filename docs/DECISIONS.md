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

When you make a meaningful decision while implementing a task, append it here. Format:

```
### D-NNN: [one-line decision]

**Choice:** what you did.

**Alternatives:** what you considered and why you rejected them.

**Tradeoff accepted:** what you give up.
```
