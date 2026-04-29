# Troubleshooting

A decision tree of common failure modes, organized by symptom. If you're staring at a broken page, start here.

## Happy path checklist

These URLs are the canonical "is the app working" smoke test. After any change, run through this list in order. The first one to fail tells you which subsystem broke.

| URL | Expected | What it tests |
|---|---|---|
| `/` | Home page renders, search works | Layout, fonts, search component |
| `/russia` | "5,447 Rhode Islands fit inside Russia", real outline | Static dataset + countries GeoJSON |
| `/texas` | "221 Rhode Islands fit inside Texas", real outline | Static dataset + states GeoJSON |
| `/yellowstone-national-park` | "2.9 RIs", outline (Task 01) or placeholder | Static dataset + parks GeoJSON (Task 01) |
| `/luxembourg` | "Rhode Island is 1.2× bigger than Luxembourg" | The flip + countries GeoJSON |
| `/andorra` | "Rhode Island is 6.7× bigger than Andorra" | The flip with smaller ratio |
| `/tokyo-japan` | Real Tokyo outline (Task 03) or placeholder | Static dataset + OSM (Task 03) |
| `/sahara-desert` | Real result (Task 02) or 404 | Wikidata fallback (Task 02) |
| `/asdkfjasdkf` | 404 page | Negative case |

## Symptom → diagnosis

### "The number on the page is wrong"

```
Is the area in places.json wrong?
├── YES → fix places.json, run `npm run build:geo`
└── NO → is the formula off in places.ts `formatRatio()`?
    ├── YES → 1: check formatRatio thresholds (100, 10, 1)
    │        2: check ri_ratio = area_sq_mi / 1214 in build-dataset
    └── NO → static dataset's ri_ratio is stale (you edited area_sq_mi but
             didn't rerun build:geo). Fix: `npm run build:geo`.
```

### "The shapes look distorted / off-center"

Read `docs/ARCHITECTURE.md` §3 first. The math is correct; if it looks "off" the cause is almost always one of:

```
Is the inner shape the wrong scale?
├── Inner is too big or too small → linear_ratio computation is wrong.
│   Check: `Math.sqrt(...)` not `area_smaller / area_bigger` directly.
├── Inner is centered but visibly not at the geographic center of outer →
│   This is correct. The inner shape is centered at the *viewBox center*,
│   which is the center of the outer's *projected bounding box*, not its
│   geographic centroid. This is by design (D-007).
├── Outer is cropped / cut off → fitSize aspect-ratio handling broke.
│   Verify: `geoMercator().fitSize([INNER, INNER], feature)` (not `fitExtent`).
└── Both shapes are tiny in the corner → something is rendering pre-scale.
    Check: outer has translate(PADDING, PADDING); inner has the combined
    translate-scale transform.
```

### "TypeScript errors I don't understand"

```
Is the error in a JSON import?
├── YES → check tsconfig.json has `"resolveJsonModule": true`
│        and the import has `as unknown as <Type>` cast.
└── NO → is the error in d3-geo / geojson types?
    ├── YES → run `npm install @types/geojson @types/d3-geo --save-dev`
    └── NO → run `npx tsc --noEmit` and read carefully. Most TS errors
             have a clear path forward; the only tricky ones are JSON
             imports and the GeoJSON type narrowing on Polygon vs MultiPolygon.
```

### "`npm run build` fails with a font error"

```
Error: "Failed to fetch font 'Fraunces'" (or DM Sans)
└── This means Google Fonts wasn't reachable during the build.
    ├── On Vercel: should never happen (Vercel has full internet)
    ├── On a sandboxed machine (CI without internet): expected.
    │   Solution A: build on Vercel, not the sandbox.
    │   Solution B: switch to local fonts (download the .woff2 files).
    └── On your dev machine, but no internet right now:
        Solution: connect to internet. The first build needs to fetch
        and cache the font files.
```

### "Wikidata lookups always return null"

```
Is the User-Agent header set?
├── NO → set it. Wikidata returns 403 without one (silent in fetch).
└── YES → is the slug → search query conversion right?
    ├── Test: node -e 'console.log(slugToSearchQuery("sahara-desert"))'
    │   Expected: "sahara desert"
    └── If still null: try the search endpoint manually:
        curl 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=sahara&language=en&format=json' \
          -H 'User-Agent: HowManyRhodeIslands/1.0'
        If this returns results but our code doesn't, parsing is broken.
```

### "Cache isn't working in production"

```
Are the env vars set?
├── Verify: vercel env ls
│   Should show KV_REST_API_URL and KV_REST_API_TOKEN for "Production".
├── If missing: provision Vercel KV via Storage tab in dashboard,
│   then redeploy.
└── If present but cache still missing: check Vercel function logs.
    Look for "[cache] get failed" or "[cache] set failed" warnings.
    Most common cause: KV instance was deleted, env vars stale.
```

### "OG image doesn't appear when sharing"

```
Does GET /<slug>/opengraph-image return a PNG?
├── NO (returns 500): edge runtime issue. Check Vercel logs.
│   Most common: edge runtime can't import a module.
│   Fix: switch to Node runtime by removing `export const runtime = "edge"`.
├── NO (returns 404): file is in wrong location.
│   Verify: src/app/[place]/opengraph-image.tsx (not pages/)
└── YES (returns PNG):
    └── Issue is in the unfurler caching the URL.
        ├── iMessage: send the URL to a different chat to bust cache.
        ├── Twitter: use https://cards-dev.twitter.com/validator
        ├── Discord: append ?v=2 to the URL to bust cache.
        └── Slack: usually picks up after the first OG fetch; just retry.
```

### "Tasks 02/03 work locally but not on Vercel"

Most likely: KV not provisioned in production. See "Cache isn't working in production" above.

Second most likely: the function bundle is too large.

```
Run: npx vercel inspect <deployment-url> | grep "Bundle"
└── Bundles > 50MB → trim. The biggest hog is usually data/geo/countries.json.
    Fix: lazy-import it, or split per-feature, or move to KV instead of bundle.
```

### "I added a new place to places.json and the page 404s"

```
Did you run `npm run build:geo`?
├── NO → run it. The script is what populates geojson_key.
└── YES → check the slug. Slug in URL must match `slug` field exactly.
    Verify: node -e 'console.log(require("./data/places.json").find(p => p.slug === "<your-slug>"))'
```

### "I added a new place but the visual is a placeholder"

This means the place's `geojson_key` is null after `build:geo`. Either:
- Name didn't match the source's name (add to `*_NAME_OVERRIDES` in `build-geo.mjs`).
- Source doesn't have that place (e.g. micro-state in 1:50m world-atlas).

Run `npm run build:geo` and read the warnings — they list unmatched places.

## When to give up and ask

If you've been stuck for >30 min on something that isn't here:

1. Check `docs/DECISIONS.md` — there might be a deliberate choice that explains the surprising behavior.
2. `git log --oneline -20` — recent commits might give context.
3. Read the failing file's docstring at the top — design intent is captured there.
4. Worst case: roll back to a known-good commit (`git reflog`, `git reset --hard <commit>`) and reapply changes more incrementally.

## Helpful one-liners

```bash
# How many places are in each type / how many have geojson_key?
node -e '
const types = {};
require("./data/places.json").forEach(p => {
  const k = p.type;
  types[k] = types[k] || { total: 0, with_key: 0 };
  types[k].total++;
  if (p.geojson_key) types[k].with_key++;
});
console.table(types);
'

# Find a place by partial name
node -e '
const q = "yel";
console.log(require("./data/places.json").filter(p => p.name.toLowerCase().includes(q)));
'

# Verify all countries map cleanly
node -e '
const places = require("./data/places.json");
const geo = require("./data/geo/countries.json");
const orphans = places
  .filter(p => p.type === "country" && p.geojson_key && !geo[p.geojson_key]);
console.log("orphans:", orphans.length, orphans.map(p => p.name));
'

# Inspect a single GeoJSON feature
node -e '
const f = require("./data/geo/countries.json")["643"];  // Russia
console.log("type:", f.geometry.type, "rings:",
  f.geometry.type === "Polygon"
    ? f.geometry.coordinates.length
    : f.geometry.coordinates.reduce((n, p) => n + p.length, 0));
'

# Quick visual inspect of an SVG path (if you have python)
npm run dev &
sleep 3
curl -s http://localhost:3000/russia | grep -oE 'd="[^"]*"' | head -1
```
