# Task 01: NPS Park Boundaries

## Goal

Replace the placeholder rounded square with real boundary outlines for all 62 entries of `type: "national_park"` in the static dataset. Output bundled in `data/geo/national-parks.json` and looked up at runtime by `geo.ts`.

## Pre-flight checks

Run these before starting. They confirm you're starting from the correct state.

```bash
# 1. Verify you're in the project root
test -f data/places.json && echo "ok: places.json present" || echo "FAIL: wrong directory"

# 2. Verify there are 62 park entries currently lacking geojson_key
node -e '
  const places = require("./data/places.json");
  const parks = places.filter(p => p.type === "national_park");
  const stubs = parks.filter(p => !p.geojson_key);
  console.log(`parks: ${parks.length}, currently without key: ${stubs.length}`);
'
# Expected: parks: 62, currently without key: 62

# 3. Verify NPS endpoint is reachable from your machine
curl -sI 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/0?f=pjson' \
  | head -1
# Expected: HTTP/2 200
```

If any check fails, stop and diagnose. Don't proceed with a broken starting state.

## Acceptance criteria

- [ ] `data/geo/national-parks.json` exists; contains entries for all 62 parks (or fewer if NPS is missing some — log warnings).
- [ ] `data/places.json`: every `type: "national_park"` entry that matched has a non-null `geojson_key`.
- [ ] `npm run build:geo` is idempotent (running twice produces identical files).
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` succeeds.
- [ ] Manual: `npm run dev` then visit:
  - [ ] `/yellowstone-national-park` → real Yellowstone outline visible, RI clearly inside.
  - [ ] `/wrangell-st-elias-national-park` → real outline (largest park, RI is small inside).
  - [ ] `/acadia-national-park` → flips correctly: RI outline as container, Acadia inside (Acadia is 76 sq mi, smaller than RI).

## Source

NPS publishes park boundaries via an ArcGIS Feature Service. The "NPS Boundary" layer is on the Land Resources Division service.

**Discovery URL** (what's available): https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services

**The feature service we want:**
```
https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/0
```

**Query for just National Parks (not monuments, recreation areas, etc.):**
```
https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/0/query?where=UNIT_TYPE+%3D+%27National+Park%27&outFields=UNIT_NAME,UNIT_CODE,UNIT_TYPE&outSR=4326&f=geojson
```

URL-decoded `where` clause: `UNIT_TYPE = 'National Park'`.

> ⚠️ **The layer ID `0` and field `UNIT_TYPE` are best-effort — verify before relying on them.** ArcGIS feature services are notorious for renaming fields. Run the discovery URL first; if the layer index moved or fields were renamed, adjust accordingly. The `?f=pjson` parameter on the layer root URL returns metadata describing all fields.

### Field reference (as of writing)

| Field | Example | Use |
|---|---|---|
| `UNIT_NAME` | "Yellowstone National Park" | Match against our `name` |
| `UNIT_CODE` | "YELL" | Stable 4-letter code; good join key |
| `UNIT_TYPE` | "National Park" | Filter |
| `geometry` | MultiPolygon | The outline |

## Implementation

### Files to create

| Path | Purpose |
|---|---|
| `data/geo/national-parks.json` | Output, keyed by `UNIT_CODE` (e.g. "YELL") |

### Files to modify

| Path | Change |
|---|---|
| `scripts/build-geo.mjs` | Add NPS fetch + processing block. |
| `src/lib/geo.ts` | Import `national-parks.json`, branch `getFeature()` to handle `national_park`. |

### Code template: `scripts/build-geo.mjs` additions

Insert after the US states processing block, before the "Read places.json" block:

```js
// ─── Process National Parks (NPS ArcGIS Feature Service) ─────────────
log("Fetching National Park boundaries from NPS…");

const NPS_URL = new URL(
  "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/" +
  "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/0/query"
);
NPS_URL.searchParams.set("where", "UNIT_TYPE = 'National Park'");
NPS_URL.searchParams.set("outFields", "UNIT_NAME,UNIT_CODE");
NPS_URL.searchParams.set("outSR", "4326");
NPS_URL.searchParams.set("f", "geojson");

let parksByName = new Map();
let parksByCode = new Map();
try {
  const res = await fetch(NPS_URL);
  if (!res.ok) throw new Error(`NPS fetch ${res.status}`);
  const npsFC = await res.json();
  if (npsFC.type !== "FeatureCollection" || !Array.isArray(npsFC.features)) {
    throw new Error("Unexpected NPS response shape");
  }
  for (const f of npsFC.features) {
    parksByName.set(normalizeName(f.properties.UNIT_NAME), f);
    parksByCode.set(f.properties.UNIT_CODE, f);
  }
  log(`Fetched ${npsFC.features.length} parks from NPS`);
} catch (err) {
  warn(`NPS fetch failed (${err.message}). Park entries will keep null geojson_key.`);
}
```

Inside the `for (const p of places)` loop, replace the `else` branch (which currently lumps parks + cities together) with:

```js
  } else if (p.type === "national_park") {
    const f = parksByName.get(normalizeName(p.name));
    if (f) {
      const code = f.properties.UNIT_CODE;
      p.geojson_key = code;
      parksOut[code] = {
        type: "Feature",
        id: code,
        properties: { name: p.name },
        geometry: quantizeGeometry(f.geometry),
      };
      matched.national_park = (matched.national_park ?? 0) + 1;
    } else {
      p.geojson_key = null;
      missed.national_park = missed.national_park ?? [];
      missed.national_park.push(p.name);
    }
  } else {
    // city: handled in Task 03 via runtime OSM fetch
    p.geojson_key = null;
  }
```

Add to the output writes:

```js
const parksOut = {}; // declare near countriesOut, statesOut
// ... after the loop
writeFileSync("data/geo/national-parks.json", JSON.stringify(parksOut));
const pSize = statSync("data/geo/national-parks.json").size;
log(`national-parks.json: ${(pSize / 1024).toFixed(1)} KB`);
```

Update the report at the bottom:

```js
log(`Matched: ${matched.country} countries, ${matched.us_state} US states, ${matched.national_park ?? 0} parks`);
if (missed.national_park?.length) warn("Unmatched parks:", missed.national_park);
```

### Code template: `src/lib/geo.ts` additions

```ts
import nationalParks from "../../data/geo/national-parks.json";
const NATIONAL_PARKS = nationalParks as unknown as FeatureMap;

export function getFeature(
  type: PlaceType,
  geojsonKey: string | null
): Feature<Geometry, { name: string }> | null {
  if (!geojsonKey) return null;
  if (type === "country") return COUNTRIES[geojsonKey] ?? null;
  if (type === "us_state") return US_STATES[geojsonKey] ?? null;
  if (type === "national_park") return NATIONAL_PARKS[geojsonKey] ?? null;
  return null; // cities — Task 03
}
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `NPS fetch failed: 400 Bad Request` | URL params not URL-encoded properly. | Use `URL.searchParams.set()` (in template); don't concatenate strings. |
| `NPS fetch failed: 404` | Layer ID changed (was 0, now N). | Hit the discovery URL `…/FeatureServer?f=pjson` and find the correct layer index for "Park Tracts" or "Boundary". |
| `Unexpected NPS response shape` | Service returned XML or HTML (auth wall, error page). | Check `&f=geojson` is present. NPS sometimes redirects to ArcGIS Online auth. |
| Many "Unmatched parks" warnings | Our `name` doesn't match `UNIT_NAME` exactly. | Inspect the diff (see verification snippet below). Add a `PARK_NAME_OVERRIDES` map analogous to `COUNTRY_NAME_OVERRIDES`. |
| `national-parks.json` is huge (>5MB) | Quantization not applied / too many MultiPolygon features. | Confirm `quantizeGeometry()` is being called. If still too big, reduce coords to 2 decimals (~11km precision, fine for our viewBox). |
| TypeScript error on JSON import | `tsconfig.json` `resolveJsonModule` is set, but the type assertion is wrong. | Add `as unknown as FeatureMap` cast (see geo.ts pattern). |
| `/yellowstone-national-park` still placeholder | `geojson_key` not set. | `node -e 'const p = require("./data/places.json").find(p => p.slug === "yellowstone-national-park"); console.log(p);'` — should show `geojson_key: "YELL"`. |
| Park outline appears wildly off-center | `geometry.coordinates` shape mismatch. | Most likely a Polygon vs MultiPolygon issue. Confirm `quantizeGeometry` handles both. d3-geo handles both natively when consumed downstream. |

### Diagnostic snippet: which parks didn't match

After running `build:geo`, if there are unmatched warnings:

```bash
node -e '
const ours = require("./data/places.json")
  .filter(p => p.type === "national_park" && !p.geojson_key)
  .map(p => p.name);
console.log("Our unmatched park names:");
ours.forEach(n => console.log("  -", n));
'
```

Then fetch a sample of NPS names to compare:

```bash
curl -s 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/0/query?where=UNIT_TYPE+%3D+%27National+Park%27&outFields=UNIT_NAME&returnGeometry=false&f=json' \
  | jq -r '.features[].attributes.UNIT_NAME' | sort
```

Add overrides to `build-geo.mjs` for any cases where ours doesn't equal NPS's (common: "St." vs "Saint", "and" vs "&").

## Validation

After implementing, run all of these:

```bash
# 1. Build the geo data
npm run build:geo
# Expected: "Matched: 196 countries, 50 US states, ~62 parks"

# 2. Typecheck
npx tsc --noEmit

# 3. Build
npm run build

# 4. Inspect the output
ls -lh data/geo/national-parks.json   # should be ~500KB-2MB
node -e 'const p = require("./data/geo/national-parks.json"); console.log("park keys:", Object.keys(p).slice(0, 5));'
# Expected: park keys: [ 'YELL', 'GRCA', 'YOSE', ... ]

# 5. Spot check a place
node -e 'const p = require("./data/places.json").find(p => p.slug === "yellowstone-national-park"); console.log(p);'
# Expected: { ..., geojson_key: "YELL", ... }

# 6. Run dev and visit:
npm run dev
#   → http://localhost:3000/yellowstone-national-park   (real Yellowstone outline, RI inside)
#   → http://localhost:3000/wrangell-st-elias-national-park
#   → http://localhost:3000/acadia-national-park   (RI outline, Acadia inside — flipped)
```

## When done

- [ ] All acceptance criteria check.
- [ ] Update `docs/HANDOFF.md` Current State table: flip `Visual: national parks` from 🟡 to ✅.
- [ ] Append a decision to `docs/DECISIONS.md` if you made a non-obvious choice (e.g. switched layer IDs, added park name overrides).
- [ ] Commit: `feat(01-nps-parks): add NPS boundary outlines for 62 national parks`.
