import type { Feature, Polygon, MultiPolygon } from "geojson";

const UA = "HowManyRhodeIslands/0.1 (https://github.com/eliaseberman/how-many-rhode-islands)";
const CACHE_SECONDS = 60 * 60 * 24 * 30;

function quantize(geom: Polygon | MultiPolygon): Polygon | MultiPolygon {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const mapPoint = (pt: number[]) => [round(pt[0]), round(pt[1])];
  const mapRing = (ring: number[][]) => ring.map(mapPoint).reverse();
  const mapPoly = (poly: number[][][]) => poly.map(mapRing);
  if (geom.type === "Polygon") return { type: "Polygon", coordinates: mapPoly(geom.coordinates) };
  return { type: "MultiPolygon", coordinates: geom.coordinates.map(mapPoly) };
}

function cityQueryVariants(displayName: string): string[] {
  const variants = [displayName];
  const firstSegment = displayName.split(",")[0]?.trim();
  if (firstSegment && firstSegment !== displayName) variants.push(firstSegment);
  return [...new Set(variants)];
}

async function fetchNominatim(
  displayName: string,
  query: string,
  featuretype?: string
): Promise<Feature<Polygon | MultiPolygon, { name: string }> | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", "5");
  if (featuretype) url.searchParams.set("featuretype", featuretype);

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "force-cache",
    next: { revalidate: CACHE_SECONDS },
  });
  if (!res.ok) {
    console.warn(`[osm] Nominatim ${res.status} for ${query}`);
    return null;
  }

  const data = await res.json();
  const f = data.features?.find(
    (feature: { geometry?: { type?: string } }) =>
      feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon"
  );
  if (!f?.geometry) return null;

  return {
    type: "Feature",
    properties: { name: displayName },
    geometry: quantize(f.geometry as Polygon | MultiPolygon),
  };
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
    const queries = featuretype === "city" ? cityQueryVariants(displayName) : [displayName];
    const featuretypes = featuretype ? [featuretype, undefined] : [undefined];

    for (const query of queries) {
      for (const type of featuretypes) {
        const boundary = await fetchNominatim(displayName, query, type);
        if (boundary) return boundary;
      }
    }
  } catch (err) {
    console.warn("[osm] fetchOSMBoundary failed:", err instanceof Error ? err.message : err);
  }
  return null;
}
