# How Many Rhode Islands

A simple web app that shows you how many Rhode Islands fit inside any country, US state, national park, or major city. A rebuild of the long-gone original site.

> Rhode Island is **1,214 sq mi**. The math is simple:
> `searched_area / 1214 = how many Rhode Islands`

## Quickstart

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Status

Scaffold complete. Countries + US states render real outlines. National parks, cities, and long-tail queries are stubbed.

## Read this first

**👉 [`docs/HANDOFF.md`](./docs/HANDOFF.md)** is the entry point for any contributor (human or agent) picking up this project.

It explains current state, links to architecture/design docs, and points to the next ordered task.

## Doc tree

```
docs/
├── HANDOFF.md                          ← Read first.
├── ARCHITECTURE.md                     ← System design + rendering math.
├── DECISIONS.md                        ← Decision log: every "why X not Y".
├── tasks/
│   ├── 01-nps-park-boundaries.md       ← Add real outlines for 62 parks.
│   ├── 02-wikidata-fallback.md         ← Long-tail coverage for any place.
│   ├── 03-city-boundaries.md           ← OSM city outlines (depends on 02).
│   ├── 04-share-and-polish.md          ← Dynamic OG images, share button.
│   └── 05-deploy-to-vercel.md          ← Cross the finish line.
└── reference/
    ├── DATA_SOURCES.md                 ← Every external dependency.
    └── TROUBLESHOOTING.md              ← Symptom → diagnosis decision tree.
```

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · d3-geo · Vercel KV (free tier).

## License

TBD before public release.
