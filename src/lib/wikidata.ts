/**
 * src/lib/wikidata.ts
 *
 * Long-tail fallback for places not in our static dataset.
 *
 * Strategy:
 *   1. Convert slug → search query
 *   2. Call wbsearchentities to find Wikidata entity candidates
 *   3. For each candidate (in order), fetch the entity and look at P2046 (area)
 *   4. First candidate with a valid area wins
 *   5. Convert area to sq mi, return as a Place-shaped object
 *
 * Caching: Uses Next.js's built-in fetch cache (`next: { revalidate: N }`).
 * Found results cache for 30 days; not-found path won't be cached at this layer
 * because Next caches fetch calls, not the absence of results.
 *
 * No Vercel KV needed for v1. Upgrade path: replace with KV if request volume
 * grows enough that fetch-level caching feels coarse.
 */

import type { Place } from "./places";

const SEARCH_URL = "https://www.wikidata.org/w/api.php";
const ENTITY_URL_BASE = "https://www.wikidata.org/wiki/Special:EntityData";
const TIMEOUT_MS = 3000;
const CACHE_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

// Wikidata is strict about User-Agent. Identify the app + a contact path.
const UA = "HowManyRhodeIslands/0.1 (https://github.com/eliaseberman/how-many-rhode-islands)";

// ─── Unit conversion table ───────────────────────────────────────────
// Wikidata stores areas with a unit URI. Convert each known unit to sq mi.
// Q-ids verified against Wikidata entity labels — see DECISIONS.md D-021.
// Unknown units return null (better to 404 than display the wrong number).
const UNIT_TO_SQ_MI: Record<string, number> = {
  Q712226:   0.386102,    // square kilometre
  Q232291:   1.0,         // square mile
  Q35852:    0.00386102,  // hectare
  Q25343:    3.86102e-7,  // square metre
  Q81292:    0.0015625,   // acre
  Q23931103: 1.32348,     // square nautical mile
};

function convertToSqMi(amount: number, unitUri: string): number | null {
  // Unit URIs look like "http://www.wikidata.org/entity/Q712226"
  const match = unitUri.match(/Q\d+$/);
  if (!match) return null;
  const factor = UNIT_TO_SQ_MI[match[0]];
  if (factor === undefined) return null;
  return amount * factor;
}

// ─── Types matching the Wikidata API response shape ─────────────────
interface SearchHit {
  id: string;
  label: string;
}

interface SearchResponse {
  search?: SearchHit[];
}

interface WikidataClaim {
  mainsnak?: {
    datavalue?: {
      value?: {
        amount?: string;
        unit?: string;
      };
    };
  };
  rank?: "preferred" | "normal" | "deprecated";
}

interface WikidataEntity {
  labels?: { en?: { value: string } };
  claims?: { P2046?: WikidataClaim[] };
}

interface EntityResponse {
  entities?: Record<string, WikidataEntity>;
}

// ─── HTTP helpers ────────────────────────────────────────────────────
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: CACHE_TTL_SEC },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    // Timeout, network error, or invalid JSON — caller treats as not found
    console.error("[wikidata] fetch error:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Search → top entity candidates ──────────────────────────────────
async function searchEntities(query: string): Promise<SearchHit[]> {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "en",
    format: "json",
    limit: "5",
  });
  const data = await fetchJson<SearchResponse>(`${SEARCH_URL}?${params}`);
  return data?.search ?? [];
}

// ─── Entity lookup → area in sq mi ───────────────────────────────────
async function getEntityArea(
  entityId: string
): Promise<{ name: string; areaSqMi: number } | null> {
  const data = await fetchJson<EntityResponse>(`${ENTITY_URL_BASE}/${entityId}.json`);
  const entity = data?.entities?.[entityId];
  if (!entity) return null;

  const claims = entity.claims?.P2046;
  if (!claims || claims.length === 0) return null;

  // Prefer "preferred" rank claims if any exist; else first non-deprecated
  const ranked =
    claims.find((c) => c.rank === "preferred") ??
    claims.find((c) => c.rank !== "deprecated") ??
    claims[0];

  const value = ranked.mainsnak?.datavalue?.value;
  if (!value?.amount || !value.unit) return null;

  const amount = parseFloat(value.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const areaSqMi = convertToSqMi(amount, value.unit);
  if (areaSqMi === null || areaSqMi <= 0) return null;

  const name = entity.labels?.en?.value ?? entityId;
  return { name, areaSqMi };
}

// ─── Public entry point ──────────────────────────────────────────────
/**
 * Try to resolve a slug to a Place via Wikidata.
 * Returns null if not found, ambiguous, or the API is unreachable.
 */
export async function fetchPlaceFromWikidata(slug: string): Promise<Place | null> {
  const query = slug.replace(/-/g, " ").trim();
  if (!query) return null;

  const candidates = await searchEntities(query);
  for (const candidate of candidates) {
    const area = await getEntityArea(candidate.id);
    if (area) {
      const areaSqMi = Math.round(area.areaSqMi);
      return {
        name: area.name,
        slug,
        type: "country", // cosmetic — Wikidata results don't display this
        area_sq_mi: areaSqMi,
        ri_ratio: +(areaSqMi / 1214).toFixed(2),
        geojson_key: null, // no bundled geometry → placeholder rectangle in render
      };
    }
  }
  return null;
}
