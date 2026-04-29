# How Many Rhode Islands — Handoff

You (Claude Code, or any future contributor) are picking up an in-progress side project. Read this doc, then pick the next open task from `docs/tasks/`. Each task is independently executable.

## TL;DR

- **What it is**: A simple web app. User searches a place; gets *"X Rhode Islands fit inside [place]"* with a to-scale visual. Mobile-first, dark navy + ocean blue.
- **Why it exists**: The original site (`howmanyrhodeislands.com`, long defunct) was beloved by the project owner's mom. He's rebuilding it for her so she has a simple way to share results back to him.
- **Stack**: Next.js 15 App Router on Vercel free tier. TypeScript. Tailwind. d3-geo for projections. `world-atlas` + `us-atlas` for boundary data. Vercel KV (free tier) for caching long-tail lookups.
- **Status**: Scaffold complete. Countries + US states render real outlines. National parks, cities, and long-tail queries are stubbed.

## Quickstart

```bash
npm install
npm run dev      # → http://localhost:3000
```

GeoJSON for countries + states is already built and committed. Re-run only if `data/places.json` changes:

```bash
npm run build:geo
```

## Current State

| Feature | Status | Where it lives | Next step |
|---|---|---|---|
| Search + autocomplete | ✅ | `src/components/SearchBar.tsx` | — |
| Result page (SSR, shareable URL) | ✅ | `src/app/[place]/page.tsx` | — |
| Visual: countries (real outlines) | ✅ | `data/geo/countries.json` | — |
| Visual: US states (real outlines) | ✅ | `data/geo/us-states.json` | — |
| Visual: national parks | ✅ | `data/geo/national-parks.json` | — |
| Visual: cities | ✅ | `src/lib/osm.ts` + `getFeatureAsync()` in `geo.ts` | — |
| Long-tail (anything not in `places.json`) | ✅ | `src/lib/wikidata.ts` + `[place]/page.tsx` | — |
| OG image / share card | 🟡 default Next.js metadata | `[place]/page.tsx` `generateMetadata()` | **Task 04** |
| Deployed to Vercel | 🟡 not yet | — | **Task 05** |

Legend: ✅ done · 🟢 wired but needs validation · 🟡 stubbed · 🔴 broken (not currently any).

## How to read this doc set

**Order:**
1. **Skim** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — data flow, rendering math, file responsibilities.
2. **Skim** [`DECISIONS.md`](./DECISIONS.md) — every meaningful design choice and the reasoning behind it.
3. **Pick** a task from [`docs/tasks/`](./tasks/). Numbered in priority/dependency order. Each is independently executable.
4. **Read** the task doc end-to-end before writing any code.
5. **Reference** [`docs/reference/`](./reference/) for API contracts, sources, and troubleshooting.

## Per-task workflow (Claude Code, follow this)

For each task in `docs/tasks/`:

1. **Read** the task doc fully. Don't skim — every section matters.
2. **Run** the "Pre-flight checks" listed at the top. These verify dependencies and that the current code state matches what the task expects.
3. **Plan** before coding. Sketch which files you'll touch and in what order. The task doc gives you a "Files to create" and "Files to modify" list — use it.
4. **Implement** using the code templates in the task doc as starting points. Adapt to context; don't blind-paste.
5. **Validate** by running every command in the "Acceptance criteria" section. Every checkbox must check. If something fails, the task doc has a "Failure modes" section that maps symptoms to causes.
6. **Update** this `HANDOFF.md` — flip the relevant 🟡 to ✅ in the Current State table.
7. **Commit** with format: `feat(<task-id>): <one-line summary>`. Example: `feat(02-wikidata): add long-tail area lookup with KV cache`.

## Key files (cheat sheet)

| Path | Role | Touch when… |
|---|---|---|
| `data/places.json` | Static dataset, 424 entries. Source of truth. | Adding new pre-curated places. Rerun `build:geo` after. |
| `data/geo/countries.json` | 196 country boundaries, keyed by ISO numeric code. | Generated. Don't hand-edit. |
| `data/geo/us-states.json` | 50 state boundaries, keyed by FIPS code. | Generated. Don't hand-edit. |
| `scripts/build-geo.mjs` | One-time GeoJSON build. | Adding a new boundary source (e.g. NPS in Task 01). |
| `src/app/[place]/page.tsx` | The result route. SSR. | Adding the long-tail fallback (Task 02). |
| `src/components/ScaleCompare.tsx` | The to-scale SVG. Math + rendering. | Changing the visual. Math should stay untouched unless you've read `ARCHITECTURE.md`. |
| `src/lib/places.ts` | Static dataset access + search. | Tuning autocomplete, adding fuzzy match. |
| `src/lib/geo.ts` | GeoJSON lookup + projection. | Adding city / park feature loading (Tasks 01, 03). |
| `src/components/SearchBar.tsx` | Autocomplete + "search anyway" escape hatch. | UX changes. |

## Project-specific glossary

| Term | Meaning |
|---|---|
| **RI** | Rhode Island. 1,214 sq mi. The unit. |
| **linear_ratio** | `sqrt(area_smaller / area_bigger)`. Used to scale the inner shape. Always in `[0, 1]`. |
| **the flip** | When the searched place is smaller than RI, the visual flips: RI becomes the container; the searched place sits inside. Headline copy also flips: *"Rhode Island is X× bigger than [place]"*. |
| **static dataset** | `data/places.json`. The 424 places we've pre-curated. |
| **long-tail** | Any query not in the static dataset. Currently 404s; Task 02 wires Wikidata fallback. |
| **placeholder rectangle** | The rounded square `ScaleCompare` renders when no GeoJSON is available for a place. Math/layout identical to real-shape rendering. |
| **bigger / smaller** | In `ScaleCompare`, refers to which shape (searched vs RI) has the larger area, regardless of which one the user typed. Distinguishes the *rendering role* from the *user-facing identity*. |
| **viewBox** | The SVG coordinate system. Always `400×400`. `PADDING=20` on each side; inner box is `360×360`. |

## What "done" means

The project ships when:

- [ ] All 5 tasks in `docs/tasks/` are ✅ in the table above.
- [ ] `npm run build` succeeds with no warnings.
- [ ] Every URL in `docs/reference/TROUBLESHOOTING.md`'s "happy path checklist" renders correctly.
- [ ] App is deployed to Vercel and the project owner can send the URL to his mom.

## If you get stuck

1. Read `docs/reference/TROUBLESHOOTING.md` — it's a decision tree of common failure modes.
2. Re-read the relevant task doc. The "Failure modes" section is exhaustive.
3. Run `npx tsc --noEmit` — many issues are caught here first.
4. Check git diff — make sure you're not accidentally touching files outside the task scope.

## Non-goals (don't waste time on these)

- ❌ Authentication. The site has no users.
- ❌ Database. Vercel KV is the only storage layer; everything else is static.
- ❌ Multi-language support. English-only for v1.
- ❌ An admin panel. Adding new places means editing `data/places.json` directly.
- ❌ Pixel-perfect cross-browser polish. Modern browsers only.
- ❌ Comprehensive test suite. Manual checklist is sufficient for v1.
- ❌ Accessibility audit beyond basic semantic HTML. (Aim for "doesn't fail axe-core obvious checks", not WCAG AAA.)
