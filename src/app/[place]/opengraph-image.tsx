import { ImageResponse } from "next/og";
import { findPlaceBySlug, formatRatio, RI_AREA_SQ_MI } from "@/lib/places";
import { fetchPlaceFromWikidata } from "@/lib/wikidata";
import { getFeatureAsync, getRhodeIslandFeature, projectToBox } from "@/lib/geo";

// Node runtime required — geo.ts imports countries.json (1.5MB) which exceeds edge bundle limit.
export const runtime = "nodejs";
export const alt = "How Many Rhode Islands";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0F1A33";
const OCEAN = "#0077B6";
const BONE = "#F5EFE6";
const OCEAN_BRIGHT = "#00B4D8";

const SVG_BOX = 340;
const SVG_PADDING = 20;
const SVG_SIZE = SVG_BOX + SVG_PADDING * 2; // 380

export default async function Image({ params }: { params: Promise<{ place: string }> }) {
  const { place: slug } = await params;

  const place = findPlaceBySlug(slug) ?? (await fetchPlaceFromWikidata(slug));

  if (!place) {
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            background: BG,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ color: BONE, fontSize: 60, fontFamily: "serif" }}>Not found</span>
        </div>
      ),
      size
    );
  }

  const searchedFeature = await getFeatureAsync(place);
  const riFeature = getRhodeIslandFeature();

  const searchedIsBigger = place.area_sq_mi >= RI_AREA_SQ_MI;
  const ratio = searchedIsBigger
    ? formatRatio(place.ri_ratio)
    : formatRatio(1 / place.ri_ratio);

  // Same linearRatio math as ScaleCompare.tsx
  const linearRatio = Math.sqrt(
    searchedIsBigger
      ? RI_AREA_SQ_MI / place.area_sq_mi
      : place.area_sq_mi / RI_AREA_SQ_MI
  );
  const innerTranslate = (SVG_BOX / 2) * (1 - linearRatio) + SVG_PADDING;
  const innerTransform = `translate(${innerTranslate} ${innerTranslate}) scale(${linearRatio})`;

  const biggerFeature = searchedIsBigger ? searchedFeature : riFeature;
  const smallerFeature = searchedIsBigger ? riFeature : searchedFeature;
  const biggerPath = biggerFeature ? projectToBox(biggerFeature, SVG_BOX) : null;
  const smallerPath = smallerFeature ? projectToBox(smallerFeature, SVG_BOX) : null;
  const outerFill = searchedIsBigger ? "transparent" : OCEAN;
  const outerStroke = searchedIsBigger ? BONE : "transparent";
  const innerFill = searchedIsBigger ? OCEAN : "transparent";
  const innerStroke = searchedIsBigger ? "transparent" : BONE;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: BG,
          alignItems: "center",
          padding: "60px",
        }}
      >
        {/* Left: headline text */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            paddingRight: "40px",
          }}
        >
          {searchedIsBigger ? (
            <>
              <span
                style={{
                  fontSize: 140,
                  fontWeight: 800,
                  color: OCEAN_BRIGHT,
                  lineHeight: 1,
                  fontFamily: "serif",
                }}
              >
                {ratio}
              </span>
              <span style={{ fontSize: 32, color: `${BONE}CC`, marginTop: 16 }}>
                Rhode Islands fit inside
              </span>
              <span
                style={{
                  fontSize: 56,
                  color: BONE,
                  marginTop: 8,
                  fontFamily: "serif",
                  fontStyle: "italic",
                }}
              >
                {place.name}
              </span>
            </>
          ) : (
            <>
              <span
                style={{
                  fontSize: 140,
                  fontWeight: 800,
                  color: OCEAN_BRIGHT,
                  lineHeight: 1,
                  fontFamily: "serif",
                }}
              >
                {ratio}
              </span>
              <span style={{ fontSize: 32, color: BONE + "CC", marginTop: 16 }}>
                {place.name} fit inside
              </span>
              <span
                style={{
                  fontSize: 56,
                  color: BONE,
                  marginTop: 8,
                  fontFamily: "serif",
                  fontStyle: "italic",
                }}
              >
                Rhode Island
              </span>
            </>
          )}
          <span style={{ fontSize: 20, color: `${BONE}40`, marginTop: 32 }}>
            howmanyrhodeislands
          </span>
        </div>

        {/* Right: to-scale SVG comparison */}
        <div
          style={{
            display: "flex",
            width: SVG_SIZE,
            height: SVG_SIZE,
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width={SVG_SIZE}
            height={SVG_SIZE}
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          >
            {/* Outer (bigger) shape */}
            <g transform={`translate(${SVG_PADDING} ${SVG_PADDING})`}>
              {biggerPath ? (
                <path
                  d={biggerPath}
                  fill={outerFill}
                  stroke={outerStroke}
                  strokeWidth={2}
                />
              ) : (
                <rect
                  x={0}
                  y={0}
                  width={SVG_BOX}
                  height={SVG_BOX}
                  rx={12}
                  fill={outerFill}
                  stroke={outerStroke}
                  strokeWidth={2}
                />
              )}
            </g>
            {/* Inner (smaller) shape */}
            <g transform={innerTransform}>
              {smallerPath ? (
                <path
                  d={smallerPath}
                  fill={innerFill}
                  stroke={innerStroke}
                  strokeWidth={2}
                />
              ) : (
                <rect
                  x={0}
                  y={0}
                  width={SVG_BOX}
                  height={SVG_BOX}
                  rx={12}
                  fill={innerFill}
                  stroke={innerStroke}
                  strokeWidth={2}
                />
              )}
            </g>
          </svg>
        </div>
      </div>
    ),
    size
  );
}
