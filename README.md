# How Many Rhode Islands

A web app that shows how many Rhode Islands fit inside any country, US state, national park, or major city. A rebuild of the long-gone original site — rebuilt for a good mom.

> Rhode Island is **1,214 sq mi**. The math is simple:
> `searched_area / 1214 = how many Rhode Islands`

## Quickstart

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Status

**Live at Vercel.** All five original tasks are complete and deployed.

- Countries, US states, national parks: real outlines from bundled GeoJSON
- Cities: live OSM Nominatim fetch per request
- Long-tail places: Wikidata fallback for anything not in `places.json`
- OG images, share button, inline search on result page
- Vercel Analytics wired

**Outstanding issues** (see HANDOFF for details):
- City outlines may show placeholder boxes on Vercel — Nominatim accessibility from datacenter IPs is unverified
- Countries with remote outlying islands (France, Chile) zoom too far out — the mainland is tiny relative to the box

## Read this first

**👉 [`docs/HANDOFF.md`](./docs/HANDOFF.md)** is the entry point for any contributor (human or agent) picking up this project.

## Doc tree

```
docs/
├── HANDOFF.md                          ← Read first.
├── ARCHITECTURE.md                     ← System design + rendering math.
├── DECISIONS.md                        ← Decision log: every "why X not Y".
├── tasks/
│   ├── 01-nps-park-boundaries.md       ← ✅ Done.
│   ├── 02-wikidata-fallback.md         ← ✅ Done.
│   ├── 03-city-boundaries.md           ← ✅ Done (cities wired; Vercel reliability TBD).
│   ├── 04-share-and-polish.md          ← ✅ Done.
│   └── 05-deploy-to-vercel.md          ← ✅ Done.
└── reference/
    ├── DATA_SOURCES.md                 ← Every external dependency.
    └── TROUBLESHOOTING.md              ← Symptom → diagnosis decision tree.
```

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · d3-geo · Vercel

## License

TBD before public release.
