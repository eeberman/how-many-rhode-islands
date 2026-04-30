import placesData from "../../data/places.json";

export type PlaceType = "country" | "us_state" | "national_park" | "city";

export interface Place {
  name: string;
  slug: string;
  type: PlaceType;
  area_sq_mi: number;
  ri_ratio: number;
  /** Key into bundled GeoJSON (data/geo/*.json). null/undefined when no
   *  bundled geometry is available. */
  geojson_key?: string | null;
}

export const RI_AREA_SQ_MI = 1214;

const PLACES: Place[] = placesData as Place[];

/**
 * Find a place by URL slug.
 * Returns null if not found in the static dataset (caller should
 * then attempt the live Wikidata fallback).
 */
export function findPlaceBySlug(slug: string): Place | null {
  const normalized = slug.toLowerCase();
  return PLACES.find((p) => p.slug === normalized) ?? null;
}

/**
 * Search the static dataset by name. Case-insensitive substring match
 * with prefix-match prioritization. Caps results to `limit`.
 */
export function searchPlaces(query: string, limit = 8): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const prefixMatches: Place[] = [];
  const substringMatches: Place[] = [];

  for (const p of PLACES) {
    const nameLc = p.name.toLowerCase();
    if (nameLc.startsWith(q)) {
      prefixMatches.push(p);
    } else if (nameLc.includes(q)) {
      substringMatches.push(p);
    }
    if (prefixMatches.length + substringMatches.length >= limit * 3) break;
  }

  // Sort each bucket: countries/states first, then by area desc
  const typeRank: Record<PlaceType, number> = {
    country: 0,
    us_state: 1,
    national_park: 2,
    city: 3,
  };
  const sortFn = (a: Place, b: Place) =>
    typeRank[a.type] - typeRank[b.type] || b.area_sq_mi - a.area_sq_mi;

  return [...prefixMatches.sort(sortFn), ...substringMatches.sort(sortFn)].slice(
    0,
    limit
  );
}

/**
 * Convert a free-text query into a slug for routing.
 * Used when the user picks "Search [X] anyway" — that route
 * triggers the live Wikidata fallback in [place]/page.tsx.
 */
export function queryToSlug(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

/**
 * Format the comparison number with appropriate precision.
 *   5446.54 → "5,447"
 *   2.86    → "2.9"
 *   0.25    → "0.25"
 */
export function formatRatio(ratio: number): string {
  if (ratio >= 100) return Math.round(ratio).toLocaleString();
  if (ratio >= 10) return ratio.toFixed(0);
  if (ratio >= 1) return ratio.toFixed(1);
  return ratio.toFixed(2);
}
