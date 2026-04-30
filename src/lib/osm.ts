import type { Feature, Polygon, MultiPolygon } from "geojson";

const UA = "HowManyRhodeIslands/0.1 (https://github.com/eliaseberman/how-many-rhode-islands)";
const TIMEOUT_MS = 8000;
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
 * Fetch a boundary polygon from OSM Nominatim.
 *
 * @param displayName  Search query (city name, country name, etc.)
 * @param featuretype  Optional Nominatim featuretype filter ('city', 'country', 'state',
 *                     'settlement'). Omit to let Nominatim return the best match — use this
 *                     for constituent countries like England that aren't classified as 'city'.
 *
 * Returns null on network error, timeout, rate limit, or if Nominatim
 * returns only a point (no polygon available).
 *
 * Caches successful responses for 30 days via Next.js fetch cache.
 */
export async function fetchOSMBoundary(
  displayName: string,
  featuretype?: string
): Promise<Feature<Polygon | MultiPolygon, { name: string }> | null> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", displayName);
    url.searchParams.set("format", "geojson");
    url.searchParams.set("polygon_geojson", "1");
    url.searchParams.set("limit", "1");
    if (featuretype) url.searchParams.set("featuretype", featuretype);

    const res = await fetch(url.toString(), {
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
    console.warn("[osm] fetchOSMBoundary failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
