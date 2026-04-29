import type { Feature, Polygon, MultiPolygon } from "geojson";

const UA = "HowManyRhodeIslands/0.1 (https://github.com/eliaseberman/how-many-rhode-islands)";
const TIMEOUT_MS = 5000;
const CACHE_TTL_SEC = 60 * 60 * 24 * 30; // 30 days — cities don't move

function quantize(geom: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const mapPoint = (pt: number[]) => [round(pt[0]), round(pt[1])];
  const mapRing = (ring: number[][]) => ring.map(mapPoint);
  const mapPoly = (poly: number[][][]) => poly.map(mapRing);
  if (geom.type === "Polygon") return { type: "Polygon", coordinates: mapPoly(geom.coordinates) };
  return { type: "MultiPolygon", coordinates: geom.coordinates.map(mapPoly) };
}

/**
 * Fetch a city's boundary polygon from OSM Nominatim.
 * Returns null on network error, timeout, rate limit, or if Nominatim
 * returns only a point (no polygon available for that city).
 *
 * Caches successful responses for 30 days via Next.js fetch cache.
 * Negative results are not cached at this layer (Next caches successful
 * fetches only) — repeated misses will re-hit Nominatim.
 * Acceptable at side-project traffic.
 */
export async function fetchCityBoundary(
  displayName: string
): Promise<Feature<Polygon | MultiPolygon, { name: string }> | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", displayName);
    url.searchParams.set("format", "geojson");
    url.searchParams.set("polygon_geojson", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("featuretype", "city");

    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: CACHE_TTL_SEC },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const f = data.features?.[0];
    if (
      !f?.geometry ||
      (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")
    ) {
      return null;
    }

    return {
      type: "Feature",
      properties: { name: displayName },
      geometry: quantize(f.geometry as Polygon | MultiPolygon),
    };
  } catch (err) {
    console.warn("[osm] fetchCityBoundary failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
