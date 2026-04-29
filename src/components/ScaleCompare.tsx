/**
 * ScaleCompare
 *
 * Renders two shapes to scale, with the smaller one centered inside the bigger one.
 *
 * SCALING MATH (the part that's easy to get wrong):
 *   linear_ratio = sqrt(area_ratio)
 *   If A has 100× the area of B, B is 1/sqrt(100) = 1/10 the linear size.
 *
 * RENDERING RULE:
 *   - Bigger shape is projected via d3-geo to fill the inner box (preserves aspect
 *     ratio — Russia stays wide, England stays tall).
 *   - Smaller shape is projected the same way, then transformed (scale + translate)
 *     so it sits centered inside the bigger shape at its true relative size.
 *
 * Falls back to a placeholder rounded square for places without bundled GeoJSON
 * (cities, national parks, and a few tiny island nations like Tuvalu). The math
 * and layout are identical — only the path shapes differ.
 */

import type { Feature, Geometry } from "geojson";
import {
  RI_AREA_SQ_MI,
  type Place,
} from "@/lib/places";
import {
  getFeature,
  getRhodeIslandFeature,
  projectToBox,
} from "@/lib/geo";

const VIEWBOX = 400;
const PADDING = 20;
const INNER = VIEWBOX - PADDING * 2;
const CENTER = VIEWBOX / 2;

const COLOR_BONE = "#F5EFE6";
const COLOR_OCEAN = "#0077B6";
const COLOR_OCEAN_BRIGHT = "#00B4D8";

interface Props {
  place: Place;
}

export default function ScaleCompare({ place }: Props) {
  const searchedFeature = getFeature(place.type, place.geojson_key ?? null);
  const riFeature = getRhodeIslandFeature();

  const searchedIsBigger = place.area_sq_mi >= RI_AREA_SQ_MI;
  const linearRatio = Math.sqrt(
    searchedIsBigger
      ? RI_AREA_SQ_MI / place.area_sq_mi
      : place.area_sq_mi / RI_AREA_SQ_MI
  );

  // Inner-shape transform: scale by linearRatio, then translate so the result
  // is centered at the viewBox center.
  // Derived from: after scale(s) around origin, a point at (INNER/2, INNER/2)
  // moves to (s*INNER/2, s*INNER/2). We want it at (CENTER, CENTER) = (INNER/2 + PADDING).
  // → translation = (INNER/2)(1 - s) + PADDING
  const innerTranslate = (INNER / 2) * (1 - linearRatio) + PADDING;
  const innerTransform = `translate(${innerTranslate} ${innerTranslate}) scale(${linearRatio})`;

  // Resolve which feature plays the "bigger" role and which plays "smaller"
  const biggerFeature = searchedIsBigger ? searchedFeature : riFeature;
  const smallerFeature = searchedIsBigger ? riFeature : searchedFeature;

  return (
    <div className="w-full max-w-md mx-auto">
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className="w-full h-auto"
        aria-label={
          searchedIsBigger
            ? `${place.name} with Rhode Island shown to scale inside`
            : `Rhode Island with ${place.name} shown to scale inside`
        }
      >
        {/* Outer (bigger) shape — drawn at full inner-box size */}
        <g transform={`translate(${PADDING} ${PADDING})`}>
          <ShapeOrPlaceholder
            feature={biggerFeature}
            box={INNER}
            fill={searchedIsBigger ? "transparent" : COLOR_OCEAN}
            stroke={searchedIsBigger ? COLOR_BONE : "transparent"}
            strokeWidth={2}
          />
        </g>

        {/* Inner (smaller) shape — projected at full size, then scaled down toward center */}
        <g transform={innerTransform}>
          <ShapeOrPlaceholder
            feature={smallerFeature}
            box={INNER}
            fill={searchedIsBigger ? COLOR_OCEAN : "transparent"}
            stroke={searchedIsBigger ? "transparent" : COLOR_BONE}
            strokeWidth={searchedIsBigger ? 0 : 1.5}
            nonScalingStroke
          />
        </g>

        {/* Visibility safety net: if linear_ratio is sub-pixel (e.g. RI in Russia),
            render a tiny dot at viewBox center so the inner shape doesn't disappear */}
        {INNER * linearRatio < 4 && (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={3}
            fill={searchedIsBigger ? COLOR_OCEAN_BRIGHT : COLOR_BONE}
          />
        )}
      </svg>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-4 text-xs uppercase tracking-wider">
        <span className="flex items-center gap-2 text-bone/70">
          <span className="w-3 h-3 rounded-sm bg-ocean" />
          Rhode Island
        </span>
        <span className="flex items-center gap-2 text-bone/70">
          <span className="w-3 h-3 rounded-sm border border-bone" />
          {place.name}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ShapeOrPlaceholder: real GeoJSON path if we have it, rounded square otherwise
// ─────────────────────────────────────────────────────────────────────
interface ShapeProps {
  feature: Feature<Geometry, { name: string }> | null;
  box: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  nonScalingStroke?: boolean;
}

function ShapeOrPlaceholder({
  feature,
  box,
  fill,
  stroke,
  strokeWidth,
  nonScalingStroke,
}: ShapeProps) {
  const vectorEffect = nonScalingStroke ? "non-scaling-stroke" : undefined;

  if (feature) {
    const d = projectToBox(feature, box);
    return (
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        vectorEffect={vectorEffect}
      />
    );
  }

  // Placeholder: rounded square. Used for cities, national parks, and any
  // unmatched static entries (e.g. Tuvalu). Same coordinate space as
  // projectToBox output: (0,0) to (box, box).
  return (
    <rect
      x={0}
      y={0}
      width={box}
      height={box}
      rx={12}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      vectorEffect={vectorEffect}
    />
  );
}
