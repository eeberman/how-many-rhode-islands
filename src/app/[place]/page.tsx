import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  findPlaceBySlug,
  formatArea,
  formatRatio,
  pluralizePlaceName,
  RI_AREA_SQ_MI,
  type Place,
} from "@/lib/places";
import { fetchPlaceFromWikidata } from "@/lib/wikidata";
import { getFeatureAsync, getRhodeIslandFeature } from "@/lib/geo";
import ScaleCompare from "@/components/ScaleCompare";
import ShareButton from "@/components/ShareButton";
import SearchBar from "@/components/SearchBar";
import RandomButton from "@/components/RandomButton";

interface PageProps {
  params: Promise<{ place: string }>;
}

/**
 * Resolve the slug to a Place.
 *
 * Two layers:
 *   1. Static dataset (countries, US states, parks, major cities)
 *   2. Wikidata fallback for anything else
 *
 * Wikidata results have geojson_key=null, so the visual falls back to the
 * placeholder rounded square in ScaleCompare. The math and flip still work.
 */
async function resolvePlace(slug: string): Promise<Place | null> {
  const fromStatic = findPlaceBySlug(slug);
  if (fromStatic) return fromStatic;
  return await fetchPlaceFromWikidata(slug);
}

function ratioTextClass(ratio: string): string {
  const digits = ratio.replace(/[^0-9]/g, "").length;
  if (digits >= 13) return "text-[2.6rem] sm:text-6xl";
  if (digits >= 10) return "text-5xl sm:text-7xl";
  if (digits >= 7) return "text-6xl sm:text-8xl";
  return "text-7xl sm:text-8xl";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { place: slug } = await params;
  const place = await resolvePlace(slug);
  if (!place) {
    return { title: "Not found — How Many Rhode Islands" };
  }
  const isBigger = place.ri_ratio >= 1;
  const headline = isBigger
    ? `${formatRatio(place.ri_ratio)} Rhode Islands fit inside ${place.name}`
    : `${formatRatio(1 / place.ri_ratio)} ${pluralizePlaceName(place.name)} fit inside Rhode Island`;
  return {
    title: `${headline} — How Many Rhode Islands`,
      description: headline,
      openGraph: {
        title: headline,
        description: `${place.name} is ${formatArea(place.area_sq_mi)}.`,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: headline,
        description: `${place.name} is ${formatArea(place.area_sq_mi)}.`,
      },
  };
}

export default async function PlacePage({ params }: PageProps) {
  const { place: slug } = await params;
  const place = await resolvePlace(slug);
  if (!place) notFound();

  const searchedFeature = await getFeatureAsync(place);
  const riFeature = getRhodeIslandFeature();

  const isBigger = place.ri_ratio >= 1;
  const ratio = isBigger
    ? formatRatio(place.ri_ratio)
    : formatRatio(1 / place.ri_ratio);
  const placeUnit = pluralizePlaceName(place.name);
  const ratioClass = `font-display ${ratioTextClass(ratio)} font-bold text-ocean-bright leading-none tracking-tight max-w-full break-normal`;

  return (
    <main className="min-h-screen flex flex-col px-6 py-10">
      <Link
        href="/"
        className="text-bone/40 hover:text-bone/80 text-sm transition-colors"
      >
        ← New search
      </Link>

      <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full">
        {/* Headline */}
        <div className="text-center mb-8">
          {isBigger ? (
            <>
              <div className={ratioClass}>
                {ratio}
              </div>
              <div className="mt-3 font-body text-bone/80 text-lg">
                Rhode Islands fit inside
              </div>
              <div className="mt-1 font-display text-3xl sm:text-4xl text-bone">
                {place.name}
              </div>
            </>
          ) : (
            <>
              <div className={ratioClass}>
                {ratio}
              </div>
              <div className="mt-3 font-body text-bone/80 text-lg">
                {placeUnit} fit inside
              </div>
              <div className="mt-1 font-display text-3xl sm:text-4xl text-bone">
                Rhode Island
              </div>
            </>
          )}
        </div>

        {/* Visual */}
        <ScaleCompare place={place} searchedFeature={searchedFeature} riFeature={riFeature} />

        {/* Stats */}
        <div className="mt-10 text-center text-sm text-bone/50 space-y-1">
          <div>
            {place.name}: {formatArea(place.area_sq_mi)}
          </div>
          <div>
            Rhode Island: {formatArea(RI_AREA_SQ_MI)}
          </div>
        </div>

        <ShareButton
          title={isBigger
            ? `${ratio} Rhode Islands fit inside ${place.name}`
            : `${ratio} ${placeUnit} fit inside Rhode Island`}
        />

        <div className="mt-10 w-full">
          <SearchBar />
          <div className="flex justify-center">
            <RandomButton />
          </div>
        </div>
      </div>
    </main>
  );
}
