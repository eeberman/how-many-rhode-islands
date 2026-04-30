import { geoMercator, geoPath } from "d3-geo";
import type { Feature, GeoJsonProperties, Geometry, MultiPolygon, Position } from "geojson";
import countries from "../../data/geo/countries.json";
import usStates from "../../data/geo/us-states.json";
import nationalParks from "../../data/geo/national-parks.json";
import cities from "../../data/geo/cities.json";
import type { Place, PlaceType } from "./places";
import { fetchOSMBoundary } from "./osm";

type FeatureMap = Record<string, Feature<Geometry, { name: string }>>;

const COUNTRIES = countries as unknown as FeatureMap;
const US_STATES = usStates as unknown as FeatureMap;
const NATIONAL_PARKS = nationalParks as unknown as FeatureMap;
const CITIES = cities as unknown as FeatureMap;

/**
 * Look up a GeoJSON feature for a place by type + key.
 * Returns null for cities (no bundled data; resolved at runtime via OSM)
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
  if (type === "city") return CITIES[geojsonKey] ?? null;
  return null;
}

/**
 * Resolves a GeoJSON feature for any place type, including cities and
 * constituent countries (England etc.) that have no bundled GeoJSON.
 * Falls back to null → placeholder rectangle.
 */
export async function getFeatureAsync(
  place: Place
): Promise<Feature<Geometry, { name: string }> | null> {
  const sync = getFeature(place.type, place.geojson_key ?? null);
  if (sync) return sync;
  if (place.type === "city") return fetchOSMBoundary(place.name, "city");
  // Countries without bundled GeoJSON (England, Tuvalu, etc.) — try OSM
  if (place.type === "country" && !place.geojson_key) return fetchOSMBoundary(place.name);
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

// ─── Antimeridian helpers ─────────────────────────────────────────────

function collectLongitudes(geometry: Geometry): number[] {
  const lons: number[] = [];
  function walk(coords: unknown) {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      lons.push(coords[0] as number);
    } else if (Array.isArray(coords)) {
      (coords as unknown[]).forEach(walk);
    }
  }
  if ("coordinates" in geometry) walk(geometry.coordinates);
  return lons;
}

/**
 * Returns the longitude to center the Mercator projection on, so that a
 * feature crossing the antimeridian renders as one consolidated shape.
 * Returns 0 for features that don't cross (the common case — no-op rotation).
 *
 * Algorithm: if max-min > 180°, the feature straddles ±180°. We unwrap
 * negative longitudes (+360) to make the coordinate range contiguous,
 * then use the midpoint as the center.
 */
function antimeridianCenter(feature: Feature<Geometry, unknown>): number {
  const lons = collectLongitudes(feature.geometry);
  if (lons.length === 0) return 0;

  let min = Infinity, max = -Infinity;
  for (const l of lons) {
    if (l < min) min = l;
    if (l > max) max = l;
  }
  if (max - min <= 180) return 0; // no crossing

  // Unwrap: shift negative longitudes into positive space
  let uMin = Infinity, uMax = -Infinity;
  for (const l of lons) {
    const u = l < 0 ? l + 360 : l;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
  }
  const center = (uMin + uMax) / 2;
  return center > 180 ? center - 360 : center;
}

interface PolygonInfo {
  coordinates: Position[][];
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  area: number;
}

function polygonBounds(coordinates: Position[][]): PolygonInfo {
  const ring = coordinates[0] ?? [];
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  const lonSpan = Math.max(0, maxLon - minLon);
  const latSpan = Math.max(0, maxLat - minLat);
  return {
    coordinates,
    minLon,
    maxLon,
    minLat,
    maxLat,
    area: lonSpan * latSpan,
  };
}

function containsBounds(outer: PolygonInfo, inner: PolygonInfo): boolean {
  return (
    inner.minLon >= outer.minLon &&
    inner.maxLon <= outer.maxLon &&
    inner.minLat >= outer.minLat &&
    inner.maxLat <= outer.maxLat
  );
}

function expandBounds(bounds: PolygonInfo, amount: number): PolygonInfo {
  return {
    ...bounds,
    minLon: bounds.minLon - amount,
    maxLon: bounds.maxLon + amount,
    minLat: bounds.minLat - amount,
    maxLat: bounds.maxLat + amount,
  };
}

/**
 * Fit the primary landmass cluster for countries whose tiny remote territories
 * make the full bounds mostly ocean. Archipelagos still use their full bounds:
 * this only activates when one polygon dominates and remote outliers stretch
 * the overall envelope.
 */
function fitFeature(feature: Feature<Geometry, GeoJsonProperties>): Feature<Geometry, GeoJsonProperties> {
  if (feature.geometry.type !== "MultiPolygon") return feature;

  const polygons = feature.geometry.coordinates;
  if (polygons.length < 2) return feature;

  const infos = polygons.map((polygon) => polygonBounds(polygon));
  const totalArea = infos.reduce((sum, info) => sum + info.area, 0);
  if (totalArea === 0) return feature;

  const largest = infos.reduce((best, info) => (info.area > best.area ? info : best), infos[0]);
  const largestShare = largest.area / totalArea;
  const full = infos.reduce<PolygonInfo>(
    (bounds, info) => ({
      ...bounds,
      minLon: Math.min(bounds.minLon, info.minLon),
      maxLon: Math.max(bounds.maxLon, info.maxLon),
      minLat: Math.min(bounds.minLat, info.minLat),
      maxLat: Math.max(bounds.maxLat, info.maxLat),
    }),
    { ...largest }
  );

  const largestLonSpan = Math.max(0.001, largest.maxLon - largest.minLon);
  const largestLatSpan = Math.max(0.001, largest.maxLat - largest.minLat);
  const hasRemoteOutliers =
    (full.maxLon - full.minLon) / largestLonSpan > 2.75 ||
    (full.maxLat - full.minLat) / largestLatSpan > 2.75;

  if (largestShare < 0.8 || !hasRemoteOutliers) return feature;

  const padding = Math.max(largestLonSpan, largestLatSpan) * 0.5;
  const clusterBounds = expandBounds(largest, padding);
  const cluster = infos
    .filter((info) => containsBounds(clusterBounds, info))
    .map((info) => info.coordinates);

  if (cluster.length === 0 || cluster.length === polygons.length) return feature;

  return {
    ...feature,
    geometry: {
      type: "MultiPolygon",
      coordinates: cluster,
    } satisfies MultiPolygon,
  };
}

/**
 * Project a GeoJSON feature to fit a square box.
 * Returns the SVG path `d` attribute string.
 *
 * Uses d3-geo's `geoMercator().fitSize([w, h], feature)` which:
 *   - Scales the feature so its bounding box fits within [w, h]
 *   - Preserves aspect ratio
 *   - Centers the result in the box
 *
 * For features crossing the antimeridian (Russia, Alaska, Fiji, etc.),
 * the projection is rotated to consolidate the shape before fitting.
 */
export function projectToBox(
  feature: Feature<Geometry, { name: string }>,
  boxSize: number
): string {
  const boundsFeature = fitFeature(feature);
  const center = antimeridianCenter(boundsFeature);
  // rotate([center, 0]) makes d3-geo project lon as (lon - center),
  // centering the feature at 0° and keeping it away from the ±180° clip boundary.
  const projection = geoMercator()
    .rotate([-center, 0])
    .fitSize([boxSize, boxSize], boundsFeature);
  const path = geoPath(projection);
  return path(feature) ?? "";
}
