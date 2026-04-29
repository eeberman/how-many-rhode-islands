# Task 02: Wikidata Long-Tail Fallback — Verify & Harden

> **Status note:** Unlike most other tasks, this one is *partially implemented already*. `src/lib/wikidata.ts` exists and is wired into `[place]/page.tsx`. Your job is to **verify, harden, and ship** — not to build from scratch. Read carefully before touching anything.

## Goal

Long-tail queries (slugs not in `data/places.json`) resolve via Wikidata, return real area data, and render correctly. Caching is reliable. Unit conversion is correct for all common cases.

## Current state (read first)

The existing `src/lib/wikidata.ts` (~170 lines) does:
- Slug → search query conversion (`-` → space).
- `wbsearchentities` API call to find candidates (top 5).
- For each candidate in order: fetch `Special:EntityData/<Qid>.json`, look at claims `P2046` (area), pick highest-rank claim, extract amount + unit URI.
- Convert amount × unit factor → sq mi.
- First candidate with a valid area wins.
- Returns a `Place`-shaped object or `null`.

Caching: uses **Next.js fetch cache** (`next: { revalidate: <seconds> }`) — *not* Vercel KV. This is a deliberate v1 simplification (no extra service to provision; no env vars to manage). Upgrade to KV is the punt; not needed for side-project traffic.

The page route (`src/app/[place]/page.tsx`) calls it correctly:
```ts
async function resolvePlace(slug: string): Promise<Place | null> {
  const fromStatic = findPlaceBySlug(slug);
  if (fromStatic) return fromStatic;
  return await fetchPlaceFromWikidata(slug);
}
```

## Pre-flight checks

```bash
# 1. Confirm wikidata.ts exists and is wired
test -f src/lib/wikidata.ts && grep -q "fetchPlaceFromWikidata" src/app/\[place\]/page.tsx \
  && echo "ok: wired" || echo "FAIL: wiring missing — file may have been deleted"

# 2. Quick smoke test — should return real Sahara area
npm run dev &
DEV_PID=$!
sleep 5
curl -s http://localhost:3000/sahara-desert | grep -oE 'Rhode Islands fit inside|bigger than' | head -1
kill $DEV_PID

# 3. Confirm Wikidata reachability from your machine
curl -sI 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=test&language=en&format=json' \
  | head -1
# Expected: HTTP/2 200
```

## Known issues to fix

The existing implementation has these unresolved items. **Verify each before declaring the task done.**

### Issue A: unit Q-id table needs verification

The current `UNIT_TO_SQ_MI` table:

```ts
const UNIT_TO_SQ_MI: Record<string, number> = {
  Q712226:  0.386102,    // square kilometre
  Q3214456: 1.0,         // square mile  ← VERIFY: is this Q-id correct for sq mi?
  Q23725:   0.00386102,  // hectare      ← VERIFY: should this be Q35852?
  Q828224:  3.86102e-7,  // square metre ← VERIFY: should this be Q11573?
  Q35852:   0.00156,     // acre         ← VERIFY: should this be Q828224?
};
```

The labels and Q-ids look mismatched against my Wikidata reference. **Do this:**

```bash
# Spot-check each Q-id by hitting Wikidata directly
for qid in Q712226 Q3214456 Q23725 Q828224 Q35852 Q11573 Q232291 Q60762470; do
  label=$(curl -s "https://www.wikidata.org/wiki/Special:EntityData/${qid}.json" \
    | jq -r ".entities.${qid}.labels.en.value // \"???\"")
  echo "$qid: $label"
done
```

Then update the table with verified Q-ids. Reference table for what each unit *should* be:

| Q-id | Expected unit | Multiplier to sq mi |
|---|---|---|
| Q712226 | square kilometre | 0.386102 |
| Q232291 | square mile | 1.0 |
| Q35852 | hectare | 0.00386102 |
| Q11573 | square metre | 3.86102e-7 |
| Q828224 | acre | 0.0015625 |
| Q60762470 | square nautical mile | 1.32348 |

> ⚠️ The values above are my best research, **not guaranteed**. Verify each Q-id with the curl loop above before committing.

### Issue B: User-Agent placeholder

Current code:
```ts
const UA = "HowManyRhodeIslands/0.1 (https://github.com/your-handle/how-many-rhode-islands)";
```

Replace `your-handle` with the actual GitHub handle (or repo URL) of the project owner. Wikidata logs UAs and may block ones with placeholder text if traffic grows.

### Issue C: First-candidate-wins disambiguation

Current logic: iterate top 5 candidates from `wbsearchentities`, take the first one with a valid P2046 area.

This works for most cases ("sahara" → Sahara). It can misfire for ambiguous slugs:
- "georgia" → returns the country (Q230), not the US state. Acceptable — the US state is in our static dataset under slug `georgia` so this branch is never reached.
- "venice" → could return Venice the city (Q641) or the lagoon. Probably city wins. Acceptable.
- "nile" → returns the river (Q3392), which has area data. Returns ~999 sq mi-ish (river surface area). Acceptable but quirky.

**Don't fix this** for v1. The single-best-match heuristic is good enough; UI complexity for disambiguation isn't worth the effort for a tiny side project.

### Issue D: Negative cache (404s aren't memoized)

Next.js fetch cache only caches *successful* fetches by default. For slugs like `/asdkfjasdkf`, every request re-hits Wikidata search, gets 0 results, returns null, repeat.

For side-project traffic this is fine. Document it and move on. If it ever matters, add a tiny in-memory LRU keyed by slug for known-misses (no KV needed for that either).

## Acceptance criteria

- [ ] Pre-flight checks all pass.
- [ ] `UNIT_TO_SQ_MI` table verified (run the curl loop, update Q-ids if needed).
- [ ] `UA` constant has the actual project owner's GitHub handle, not `your-handle`.
- [ ] Manual: `/sahara-desert` returns ~3,000 RIs (Sahara is ~3.6M sq mi).
- [ ] Manual: `/pluto` returns a real number (Pluto's surface area).
- [ ] Manual: `/lake-superior` returns a real number (verifies non-administrative entities work).
- [ ] Manual: `/asdkfjasdkf` 404s gracefully.
- [ ] Manual: repeat call to `/sahara-desert` is observably faster (cache hit). Add a temporary `console.log` in `fetchJson` to verify Next's fetch cache hits on the second call.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` succeeds.

## Validation

```bash
# Fresh dev server
npm run dev

# Visit each:
#   /sahara-desert    — should be ~3,000 RIs
#   /pluto            — Pluto's surface area in sq mi (~6.4M, so ~5,300 RIs)
#   /lake-superior    — Lake Superior's area (~31,700 sq mi, so ~26 RIs)
#   /asdkfjasdkf      — 404
#   /sahara-desert (2nd time) — much faster

# Build
npx tsc --noEmit
npm run build
```

## When done

- [ ] All acceptance criteria check.
- [ ] Update `docs/HANDOFF.md` Current State table: flip `Long-tail` from 🟡 to ✅.
- [ ] If you fixed Q-ids, append `D-018: corrected Wikidata unit Q-ids after verification` to `docs/DECISIONS.md`.
- [ ] Commit: `fix(02-wikidata): verify unit Q-ids and harden long-tail fallback`.

## Out of scope

- Vercel KV migration. Next.js fetch cache is sufficient for v1. If we later see Wikidata rate-limiting or want longer TTLs than fetch cache provides, *that's* the trigger.
- Disambiguation UX. See Issue C above.
- Geometry from Wikidata or OSM for long-tail. Long-tail entities (deserts, planets, lakes) keep the placeholder rectangle forever. City geometry is Task 03.
