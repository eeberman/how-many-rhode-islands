import { geoMercator, geoPath } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import countries from "../../data/geo/countries.json";
import usStates from "../../data/geo/us-states.json";
import nationalParks from "../../data/geo/national-parks.json";
import type { Place, PlaceType } from "./places";
import { fetchCityBoundary } from "./osm";

type FeatureMap = Record<string, Feature<Geometry, { name: string }>>;

const COUNTRIES = countries as unknown as FeatureMap;
const US_STATES = usStates as unknown as FeatureMap;
const NATIONAL_PARKS = nationalParks as unknown as FeatureMap;

/**
 * Look up a GeoJSON feature for a place by type + key.
 * Returns null for cities (no bundled data; resolved at runtime in Task 03)
 * or any place with a null geojson_key — caller falls back to placeholder rectangle.
 */
export function getFeature(
  type: PlaceType,
  geojsonKey: string | null
): Feature<Geometry, { name: string }> | null {
  if (!geojsonKey) return null;
  if (type === "country") return COUNTRIES[geojsonKey] ?? null;
  if (type === "us_state") return US_STATES[geojsonKey] ?? null;
  if (type === "national_park") return NATIONAL_PARKS[geojsonKey] ?? null;
  return null; // cities — use getFeatureAsync instead
}

/**
 * Resolves a GeoJSON feature for any place type, including cities (async OSM fetch).
 * Use this from server components; falls back to null → placeholder rectangle.
 */
export async function getFeatureAsync(
  place: Place
): Promise<Feature<Geometry, { name: string }> | null> {
  const sync = getFeature(place.type, place.geojson_key ?? null);
  if (sync) return sync;
  if (place.type === "city") return fetchCityBoundary(place.name);
  return null;
}

/**
 * Rhode Island feature, hardcoded as a one-time lookup. RI is FIPS "44".
 */
export function getRhodeIslandFeature(): Feature<Geometry, { name: string }> {
  const f = US_STATES["44"];
  if (!f) throw new Error("Rhode Island feature not found in us-states.json");
  return f;
}

/**
 * Project a GeoJSON feature to fit a square box.
 * Returns the SVG path `d` attribute string.
 *
 * Uses d3-geo's `geoMercator().fitSize([w, h], feature)` which:
 *   - Scales the feature so its bounding box fits within [w, h]
 *   - Preserves aspect ratio (Russia stays wide, England stays tall)
 *   - Centers the result in the box
 */
export function projectToBox(
  feature: Feature<Geometry, { name: string }>,
  boxSize: number
): string {
  const projection = geoMercator().fitSize([boxSize, boxSize], feature);
  const path = geoPath(projection);
  return path(feature) ?? "";
}
