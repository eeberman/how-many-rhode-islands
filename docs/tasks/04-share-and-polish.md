# Task 04: Share & Polish

## Goal

Make the result page beautiful when shared. The site exists so the project owner's mom can send him links — those links should look great in iMessage, Messages, Signal, etc. Plus a few micro-polish items.

## Pre-flight checks

```bash
# 1. Confirm Tasks 01-03 are done — visual completeness matters here
node -e '
const places = require("./data/places.json");
const stubs = places.filter(p => !p.geojson_key && p.type !== "city");
console.log(`non-city entries without geojson_key: ${stubs.length}`);
'
# Expected: ~1 (just Tuvalu)

# 2. Confirm @vercel/og is NOT yet installed (you'll add it)
node -e 'try { require("@vercel/og"); console.log("already installed") } catch { console.log("not yet — good") }'
```

## Acceptance criteria

- [ ] Visiting any place URL on iMessage / Twitter / Discord / Signal renders a rich preview card with: place name, the Rhode Island count, and the to-scale visual.
- [ ] The OG image is generated dynamically per-place (one URL = one image).
- [ ] Image is 1200×630 (the standard OG size).
- [ ] A subtle "Send to a friend" affordance is present on the result page (mobile share API on supported devices, copy-link fallback).
- [ ] Home page has small "Try one of these" links (e.g. Russia, Texas, Yellowstone, Vatican City) — gives users / mom a starting point.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm run build` succeeds.

## Implementation

### Part A: Dynamic OG image

Next.js 15 has built-in support for OG image routes via `opengraph-image.tsx` files in any route folder.

#### New file: `src/app/[place]/opengraph-image.tsx`

```tsx
import { ImageResponse } from "next/og";
import { findPlaceBySlug, formatRatio } from "@/lib/places";
import { fetchPlaceFromWikidata } from "@/lib/wikidata";

export const runtime = "edge";

export const alt = "How Many Rhode Islands";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: { place: string } }) {
  // Same resolution chain as the page
  const place =
    findPlaceBySlug(params.place) ??
    (await fetchPlaceFromWikidata(params.place));

  if (!place) {
    return new ImageResponse(
      (
        <div style={{ ...styles.bg, ...styles.center }}>
          <div style={{ fontSize: 80, color: "#F5EFE6", fontFamily: "serif" }}>
            Not found
          </div>
        </div>
      ),
      size
    );
  }

  const isBigger = place.ri_ratio >= 1;
  const ratio = isBigger
    ? formatRatio(place.ri_ratio)
    : formatRatio(1 / place.ri_ratio);

  return new ImageResponse(
    (
      <div style={{ ...styles.bg, ...styles.column }}>
        {isBigger ? (
          <>
            <div style={{ fontSize: 220, color: "#00B4D8", fontWeight: 800, lineHeight: 1, fontFamily: "serif" }}>
              {ratio}
            </div>
            <div style={{ fontSize: 36, color: "#F5EFE6", marginTop: 24 }}>
              Rhode Islands fit inside
            </div>
            <div style={{ fontSize: 64, color: "#F5EFE6", marginTop: 8, fontFamily: "serif", fontStyle: "italic" }}>
              {place.name}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 64, color: "#F5EFE6", fontFamily: "serif", fontStyle: "italic" }}>
              Rhode Island
            </div>
            <div style={{ fontSize: 36, color: "#F5EFE6", marginTop: 12 }}>
              is{" "}
              <span style={{ color: "#00B4D8", fontSize: 96, fontWeight: 800 }}>{ratio}×</span>{" "}
              bigger than
            </div>
            <div style={{ fontSize: 64, color: "#F5EFE6", marginTop: 12, fontFamily: "serif", fontStyle: "italic" }}>
              {place.name}
            </div>
          </>
        )}
        <div style={{ position: "absolute", bottom: 30, fontSize: 24, color: "#F5EFE680" }}>
          how-many-rhode-islands
        </div>
      </div>
    ),
    size
  );
}

const styles = {
  bg: {
    width: "100%",
    height: "100%",
    background:
      "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(0, 119, 182, 0.25), transparent 60%), #0F1A33",
  },
  center: { display: "flex", alignItems: "center", justifyContent: "center" },
  column: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "60px",
    position: "relative" as const,
  },
};
```

> **Note: `@vercel/og`**: not needed as a dep. `next/og` is built into Next 15. The `opengraph-image.tsx` filename is auto-detected by Next.js.

> **Note: SVG visual in OG image**: rendering the actual to-scale SVG inside the OG image is tempting but fiddly — `next/og` uses Satori which has limited SVG support. For v1, the headline + place name is enough. The visual lives on the linked page itself.

#### Update: `src/app/[place]/page.tsx`

Next.js auto-wires `opengraph-image.tsx` into the page's metadata. You don't need to change `generateMetadata` for OG image — it'll just work. But you do want to make sure other metadata is set:

```ts
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { place: slug } = await params;
  const place = await resolvePlace(slug);
  if (!place) return { title: "Not found — How Many Rhode Islands" };

  const isBigger = place.ri_ratio >= 1;
  const headline = isBigger
    ? `${formatRatio(place.ri_ratio)} Rhode Islands fit inside ${place.name}`
    : `Rhode Island is ${formatRatio(1 / place.ri_ratio)}× bigger than ${place.name}`;

  return {
    title: `${headline} — How Many Rhode Islands`,
    description: headline,
    openGraph: {
      title: headline,
      description: `${place.name} is ${place.area_sq_mi.toLocaleString()} sq mi.`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: headline,
      description: `${place.name} is ${place.area_sq_mi.toLocaleString()} sq mi.`,
    },
  };
}
```

### Part B: Share button on result page

Add a small share affordance below the stats block. Uses the Web Share API where supported, falls back to copying the URL.

#### New file: `src/components/ShareButton.tsx`

```tsx
"use client";

import { useState } from "react";

interface Props {
  url: string;
  title: string;
}

export default function ShareButton({ url, title }: Props) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    // Web Share API on iOS/Android
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ url, title });
        return;
      } catch {
        // User canceled — fall through to copy
      }
    }
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: do nothing visible
    }
  }

  return (
    <button
      onClick={onClick}
      className="
        mt-6 px-5 py-2 rounded-full
        bg-ocean/15 hover:bg-ocean/25 text-bone
        text-sm transition-colors
        border border-white/10
      "
    >
      {copied ? "Copied!" : "Send to a friend"}
    </button>
  );
}
```

#### Update: `src/app/[place]/page.tsx`

Render the button. It needs the canonical URL, which Next.js doesn't expose directly server-side; you can construct from `headers()` or just use a `window.location.href`-equivalent client-side.

Since `ShareButton` is already a client component, give it the slug and let it construct the URL:

```tsx
// at the bottom, after the stats div:
<ShareButton
  url={`https://${process.env.NEXT_PUBLIC_VERCEL_URL ?? "localhost:3000"}/${slug}`}
  title={isBigger
    ? `${formatRatio(place.ri_ratio)} Rhode Islands fit inside ${place.name}`
    : `Rhode Island is ${formatRatio(1 / place.ri_ratio)}× bigger than ${place.name}`}
/>
```

> **Better URL construction**: `window.location.href` from inside the client component is more robust than guessing the host. Update `ShareButton` to read `window.location.href` if it's available, otherwise fall back to the prop.

### Part C: Suggested searches on home page

#### Update: `src/app/page.tsx`

Add a row of pre-filled examples below the search bar:

```tsx
const SUGGESTIONS = [
  { name: "Russia", slug: "russia" },
  { name: "Texas", slug: "texas" },
  { name: "Yellowstone", slug: "yellowstone-national-park" },
  { name: "Vatican City", slug: "vatican-city" },
  { name: "Luxembourg", slug: "luxembourg" },
];

// in JSX, after <SearchBar />:
<div className="mt-8 flex flex-wrap justify-center gap-2 max-w-md">
  {SUGGESTIONS.map((s) => (
    <Link
      key={s.slug}
      href={`/${s.slug}`}
      className="
        px-3 py-1.5 rounded-full
        bg-white/5 hover:bg-white/10 text-bone/70 hover:text-bone
        text-xs transition-colors
        border border-white/10
      "
    >
      {s.name}
    </Link>
  ))}
</div>
```

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| OG image not appearing in unfurl previews | Image route returns 500 in production. | Check Vercel logs. Most common: edge runtime can't import server-only modules. The provided template uses only `places.ts` and `wikidata.ts`, both of which are edge-safe. |
| OG image works locally, not on Vercel | URL in `og:image` is wrong (relative vs absolute). | Next.js handles this automatically with the `opengraph-image.tsx` convention. If still broken, set `metadataBase` in `layout.tsx`. |
| Share button does nothing on desktop | Web Share API not supported, clipboard fallback also failing. | Some desktop browsers require `https://` for clipboard API. Test in production, not on `http://localhost`. |
| OG image takes 5+ seconds | Cold start on edge runtime + Wikidata fetch chain. | First view of any new long-tail place is slow. Cache makes subsequent views fast. Acceptable for v1. |
| OG image shows wrong area for non-static slugs | The `opengraph-image.tsx` Wikidata call isn't sharing the cache with the page. | Both call `fetchPlaceFromWikidata`, which uses Next.js fetch cache — they should share the cache automatically since both run in the same Next runtime. If they don't, verify the URL passed to `fetch()` is byte-identical between the two callers. |

## Validation

```bash
# Local dev
npm run dev

# 1. Manual visual check on home: suggestions visible below search
open http://localhost:3000

# 2. Result page: share button visible
open http://localhost:3000/russia

# 3. OG image preview
open http://localhost:3000/russia/opengraph-image
# Should render a 1200×630 PNG with the headline

# 4. Verify metadata in HTML
curl -s http://localhost:3000/russia | grep -E '(og:image|og:title|twitter:card)'
# Should see all three present

# 5. After deploy: paste URL into iMessage / Discord / Twitter to confirm rich preview renders
```

## When done

- [ ] All acceptance criteria check.
- [ ] Update `docs/HANDOFF.md` Current State: flip `OG image / share polish` from 🟡 to ✅.
- [ ] Commit: `feat(04-share): dynamic OG images, share button, suggested searches`.
