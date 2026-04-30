/**
 * scripts/build-geo.mjs
 *
 * One-time build step. Run with: `node scripts/build-geo.mjs`
 *
 * What it does:
 *   1. Reads world-atlas (countries) and us-atlas (US states) TopoJSON from npm
 *   2. Converts to GeoJSON, strips properties, builds keyed lookup objects
 *   3. Writes to data/geo/countries.json + data/geo/us-states.json + data/geo/national-parks.json
 *   4. Updates data/places.json with `geojson_key` per entry
 *
 * What it does NOT do:
 *   - Fetch city boundaries. Curated city boundaries in data/geo/cities.json
 *     are preserved by key.
 *
 * Re-run this whenever you want fresh boundary data, or when you add new entries
 * to data/places.json that need geojson_key set.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { feature } from "topojson-client";
import worldTopo from "world-atlas/countries-50m.json" with { type: "json" };
import statesTopo from "us-atlas/states-10m.json" with { type: "json" };

// ─── Country name → world-atlas display name ─────────────────────────
// world-atlas uses Natural Earth's "name" field, which differs from ours
// in some cases. This map handles those cases.
const COUNTRY_NAME_OVERRIDES = {
  "United States": "United States of America",
  "Czech Republic": "Czechia",
  "Ivory Coast": "Côte d'Ivoire",
  // "Congo" matches NE "Congo" directly — no override needed
  "Democratic Republic of Congo": "Dem. Rep. Congo",
  "Vatican City": "Vatican",
  "Eswatini": "eSwatini",
  "Cape Verde": "Cabo Verde",
  "Bosnia and Herzegovina": "Bosnia and Herz.",
  "Central African Republic": "Central African Rep.",
  "South Sudan": "S. Sudan",
  "Dominican Republic": "Dominican Rep.",
  "Equatorial Guinea": "Eq. Guinea",
  "Solomon Islands": "Solomon Is.",
  "Marshall Islands": "Marshall Is.",
  "Saint Kitts and Nevis": "St. Kitts and Nevis",
  "Saint Vincent and the Grenadines": "St. Vin. and Gren.",
  "Antigua and Barbuda": "Antigua and Barb.",
  "São Tomé and Príncipe": "São Tomé and Principe",
  "Western Sahara": "W. Sahara",
  "North Macedonia": "Macedonia",
  // "Tuvalu" is not present in world-atlas 1:50m (too small) — placeholder used
};

/**
 * Quantize coordinates to ~110m precision (3 decimal places).
 * Cuts file size roughly in half with no visible difference at our 400px viewBox.
 */
function quantizeGeometry(geom) {
  const round = (n) => Math.round(n * 1000) / 1000;
  const mapPoint = (pt) => [round(pt[0]), round(pt[1])];
  const mapRing = (ring) => ring.map(mapPoint);
  const mapPolygon = (poly) => poly.map(mapRing);
  if (geom.type === "Polygon") {
    return { type: "Polygon", coordinates: mapPolygon(geom.coordinates) };
  }
  if (geom.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: geom.coordinates.map(mapPolygon) };
  }
  return geom;
}

// ─── Helpers ──────────────────────────────────────────────────────────
const log = (...args) => console.log("[build-geo]", ...args);
const warn = (...args) => console.warn("[build-geo] ⚠️ ", ...args);

function normalizeName(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9]/g, "");
}

// ─── Process countries ────────────────────────────────────────────────
log("Processing countries…");
const countriesFC = feature(worldTopo, worldTopo.objects.countries);
const countriesByName = new Map();
for (const f of countriesFC.features) {
  countriesByName.set(normalizeName(f.properties.name), f);
}

// ─── Process US states ────────────────────────────────────────────────
log("Processing US states…");
const statesFC = feature(statesTopo, statesTopo.objects.states);
const statesByName = new Map();
for (const f of statesFC.features) {
  statesByName.set(normalizeName(f.properties.name), f);
}

// ─── Process National Parks (NPS ArcGIS Feature Service) ─────────────
// NPS name → our dataset name, for cases where the official name differs.
const PARK_NAME_OVERRIDES = new Map([
  ["National Park of American Samoa", "American Samoa National Park"],
  ["Redwood National and State Parks", "Redwood National Park"],
]);

log("Fetching National Park boundaries from NPS…");
const NPS_URL = new URL(
  "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/" +
  "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query"
);
NPS_URL.searchParams.set("where", "UNIT_TYPE IN ('National Parks','National Parks & Preserves','National Preserves')");
NPS_URL.searchParams.set("outFields", "UNIT_NAME,UNIT_CODE,UNIT_TYPE");
NPS_URL.searchParams.set("resultRecordCount", "500");
NPS_URL.searchParams.set("outSR", "4326");
NPS_URL.searchParams.set("f", "geojson");

const parksByName = new Map(); // normalized name → NPS feature
try {
  const res = await fetch(NPS_URL);
  if (!res.ok) throw new Error(`NPS fetch ${res.status}`);
  const npsFC = await res.json();
  if (npsFC.type !== "FeatureCollection" || !Array.isArray(npsFC.features)) {
    throw new Error("Unexpected NPS response shape");
  }
  for (const f of npsFC.features) {
    const displayName = PARK_NAME_OVERRIDES.get(f.properties.UNIT_NAME) ?? f.properties.UNIT_NAME;
    parksByName.set(normalizeName(displayName), f);
    // Also index without the "& Preserve" / "and Preserve" suffix so e.g.
    // "Wrangell-St. Elias National Park" matches "Wrangell - St Elias National Park & Preserve"
    // and "New River Gorge National Park" matches "New River Gorge National Park and Preserve".
    const withoutPreserve = normalizeName(displayName.replace(/\s*((&|and)\s*preserve)/i, ""));
    if (withoutPreserve !== normalizeName(displayName)) {
      parksByName.set(withoutPreserve, f);
    }
  }
  log(`Fetched ${npsFC.features.length} parks from NPS`);
} catch (err) {
  warn(`NPS fetch failed (${err.message}). Park entries will keep null geojson_key.`);
}

// ─── Read places.json and assign geojson_keys ────────────────────────
log("Updating places.json with geojson_keys…");
const places = JSON.parse(readFileSync("data/places.json", "utf8"));
const existingCountries = JSON.parse(readFileSync("data/geo/countries.json", "utf8"));
const existingCities = JSON.parse(readFileSync("data/geo/cities.json", "utf8"));

const countriesOut = {};   // ISO numeric id → GeoJSON feature
const statesOut = {};      // FIPS code → GeoJSON feature
const parksOut = {};       // NPS UNIT_CODE → GeoJSON feature
const matched = { country: 0, us_state: 0, national_park: 0 };
const missed = { country: [], us_state: [], national_park: [] };

for (const p of places) {
  if (p.type === "country") {
    if (p.geojson_key && !/^\d+$/.test(p.geojson_key) && existingCountries[p.geojson_key]) {
      countriesOut[p.geojson_key] = existingCountries[p.geojson_key];
      matched.country++;
      continue;
    }

    const lookupName = COUNTRY_NAME_OVERRIDES[p.name] ?? p.name;
    const f = countriesByName.get(normalizeName(lookupName));
    if (f) {
      p.geojson_key = f.id;
      countriesOut[f.id] = {
        type: "Feature",
        id: f.id,
        properties: { name: p.name },
        geometry: quantizeGeometry(f.geometry),
      };
      matched.country++;
    } else {
      p.geojson_key = null;
      missed.country.push(p.name);
    }
  } else if (p.type === "us_state") {
    const f = statesByName.get(normalizeName(p.name));
    if (f) {
      p.geojson_key = f.id;
      statesOut[f.id] = {
        type: "Feature",
        id: f.id,
        properties: { name: p.name },
        geometry: quantizeGeometry(f.geometry),
      };
      matched.us_state++;
    } else {
      p.geojson_key = null;
      missed.us_state.push(p.name);
    }
  } else if (p.type === "national_park") {
    const f = parksByName.get(normalizeName(p.name));
    if (f) {
      const code = f.properties.UNIT_CODE;
      p.geojson_key = code;
      parksOut[code] = {
        type: "Feature",
        id: code,
        properties: { name: p.name },
        geometry: quantizeGeometry(f.geometry),
      };
      matched.national_park++;
    } else {
      p.geojson_key = null;
      missed.national_park.push(p.name);
    }
  } else if (p.type === "city") {
    if (p.geojson_key && existingCities[p.geojson_key]) {
      continue;
    }
    if (existingCities[p.slug]) {
      p.geojson_key = p.slug;
    } else {
      p.geojson_key = null;
    }
  }
}

// ─── Write output ─────────────────────────────────────────────────────
writeFileSync("data/geo/countries.json", JSON.stringify(countriesOut));
writeFileSync("data/geo/us-states.json", JSON.stringify(statesOut));
writeFileSync("data/geo/national-parks.json", JSON.stringify(parksOut));
writeFileSync("data/places.json", JSON.stringify(places, null, 2));

// ─── Report ───────────────────────────────────────────────────────────
log("Done.");
log(`Matched: ${matched.country} countries, ${matched.us_state} US states, ${matched.national_park} parks`);
if (missed.country.length) warn("Unmatched countries:", missed.country);
if (missed.us_state.length) warn("Unmatched states:", missed.us_state);
if (missed.national_park.length) warn("Unmatched parks:", missed.national_park);

const cSize = statSync("data/geo/countries.json").size;
const sSize = statSync("data/geo/us-states.json").size;
const pSize = statSync("data/geo/national-parks.json").size;
log(`countries.json: ${(cSize / 1024).toFixed(1)} KB`);
log(`us-states.json: ${(sSize / 1024).toFixed(1)} KB`);
log(`national-parks.json: ${(pSize / 1024).toFixed(1)} KB`);
