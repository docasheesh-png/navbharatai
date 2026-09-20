// CPCB AIR QUALITY — India's OWN official AQI, on a licence that covers a commercial product.
//
// WHY THIS EXISTS (admin 2026-09-20, after reading the Licence Exposure panel: "use karo!!").
// AQI used to come from the same no-key provider as the weather, whose terms reserve that tier for
// NON-COMMERCIAL use — a live exposure, because NavBharatAI charges money. This replaces the AQI half
// with the Central Pollution Control Board's own real-time feed on data.gov.in, published under the
// **Government Open Data License – India**, which states in terms that the data may be used "for all
// lawful commercial and non-commercial purposes".
//
// 🔑 IT IS ALSO A BETTER ANSWER, WHICH IS WHY IT IS NOT MERELY A LICENCE SWAP. The old source
// returned the **US AQI** — a different scale, computed by a different country's method. An Indian
// user checking the air compares what we say against CPCB's own number on the news, on SAFAR, on
// their phone's widget. Those are CPCB numbers. We were quoting a scale nobody around them uses.
//
// 🔒 ATTRIBUTION IS A LICENCE CONDITION, NOT A COURTESY. GODL-India requires the source to be
// attributed and forbids implying endorsement. The block this module feeds therefore names CPCB
// explicitly. That does NOT conflict with the White-Label Law: that law hides which AI VENDOR did
// the work, and CPCB is a government data source the licence obliges us to credit — the same way
// the block already linked CPCB for the official figure.
//
// ⚠️ NO KEY ⇒ NOTHING, NEVER A FALLBACK TO THE OLD SOURCE. If `DATA_GOV_IN_API_KEY` is unset the
// module returns null and the caller's web search answers the question, exactly as it already does
// for gold rates and showtimes. Quietly falling back to the non-commercial feed would re-open the
// exposure this change exists to close, and it would do it invisibly.
//
// PURE where it can be: every rule below (which records count, how the index is computed, which city
// name to ask for) is a pure function with its own test. Only `fetchCityAirQuality` does I/O.

/**
 * The real-time AQI resource on data.gov.in. Fixed id, fixed host — no SSRF surface, the same
 * discipline every other source in liveDataSources.ts follows.
 */
import { fetchGovResource } from './govData/client';

export const CPCB_RESOURCE_ID = '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';
const CPCB_HOST = 'https://api.data.gov.in/resource';

/**
 * One city can hold many stations and each station reports up to seven pollutants, so a big city
 * (Delhi has around forty stations) needs a few hundred rows. 500 is comfortably above that and
 * still one request.
 */
const RECORD_LIMIT = 500;

/**
 * CPCB's National AQI method: the overall index is the MAXIMUM sub-index, and it is only computed
 * when at least three pollutants are available, one of which must be PM2.5 or PM10. Both halves
 * matter — reporting a lone NO2 sub-index as "the AQI" would be a number CPCB never published.
 */
const MIN_POLLUTANTS = 3;
const PARTICULATE = new Set(['PM2.5', 'PM10']);

/**
 * The API key, trimmed.
 *
 * ⚠️ Whitespace-only counts as UNSET, and that is not defensive padding — this repo has already paid
 * for the opposite twice (a trailing space in `BRAVE_API_KEY`, an `=` in `ALERT_EMAIL_FROM`). A
 * value that is present but unusable must read as "not configured", or the console shows a key while
 * every call is refused and nothing anywhere says so.
 */
export function cpcbApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.DATA_GOV_IN_API_KEY ?? '').trim();
}

/** Is the official AQI feed configured at all? */
export function cpcbAqiConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return cpcbApiKey(env).length > 0;
}

/**
 * Cities whose CPCB spelling differs from what people type.
 *
 * `filters[city]` matches EXACTLY, so "Bangalore" returns zero rows against a feed that spells it
 * "Bengaluru" — and zero rows is indistinguishable from "no station there". Deliberately SHORT: only
 * renames where the old name is still in everyday use. A missing alias costs one web-search answer;
 * a wrong one would put another city's air on the screen.
 */
const CITY_ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru',
  bombay: 'Mumbai',
  calcutta: 'Kolkata',
  madras: 'Chennai',
  poona: 'Pune',
  gurgaon: 'Gurugram',
  trivandrum: 'Thiruvananthapuram',
  pondicherry: 'Puducherry',
  baroda: 'Vadodara',
  mysore: 'Mysuru',
  mangalore: 'Mangaluru',
  belgaum: 'Belagavi',
  allahabad: 'Prayagraj',
};

/**
 * The city name to ask CPCB for. PURE.
 *
 * Title-cases because the feed stores "Kanpur", not "kanpur" or "KANPUR", and applies the alias
 * table. Returns '' for anything that is not a plausible place name, so a junk value never becomes
 * a request.
 */
export function cpcbCityQuery(place: string): string {
  const raw = String(place ?? '').trim().replace(/\s+/g, ' ');
  if (!raw || raw.length > 40 || !/^[A-Za-z][A-Za-z .'-]*$/.test(raw)) return '';
  const alias = CITY_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  // Lower FIRST, then lift each word's initial — otherwise "NEW DELHI" is passed through shouting
  // and an exact-match filter returns nothing, which is indistinguishable from "no station there".
  return raw.toLowerCase().replace(/(^|[ .'-])([a-z])/g, (_m, sep, c) => sep + c.toUpperCase());
}

/** One row of the CPCB feed, as loosely as it really arrives. */
export interface CpcbRecord {
  city?: unknown;
  station?: unknown;
  state?: unknown;
  last_update?: unknown;
  pollutant_id?: unknown;
  /** The current field name. */
  avg_value?: unknown;
  /** The name the same resource used previously — both are accepted; see `subIndexOf`. */
  pollutant_avg?: unknown;
}

/**
 * The pollutant's sub-index from a row, or null. PURE.
 *
 * ⚠️ BOTH FIELD NAMES ARE ACCEPTED ON PURPOSE, and this is a stated limitation rather than
 * belt-and-braces: the resource has published this column as `pollutant_avg` and as `avg_value` at
 * different times, and data.gov.in cannot be reached from the environment this was written in, so
 * which one is live today was not verifiable here. Reading either is correct under both schemas and
 * costs nothing; hardcoding the wrong one would make the feature return silence for ever, with no
 * error anywhere.
 *
 * "NA" is CPCB's own marker for a pollutant a station did not report, and it must never become 0 —
 * zero is a real, excellent air-quality reading.
 */
export function subIndexOf(record: CpcbRecord): number | null {
  const raw = record.avg_value ?? record.pollutant_avg;
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text || text.toUpperCase() === 'NA') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export interface StationAqi {
  station: string;
  aqi: number;
  /** The pollutant holding the maximum sub-index — CPCB calls this the dominant pollutant. */
  dominant: string;
  /** How many pollutants the station reported. */
  pollutants: number;
  lastUpdate: string;
}

/**
 * One station's AQI by CPCB's own method, or null when the station does not qualify. PURE.
 *
 * Returning null for a station with two pollutants is the honest outcome, not a missed opportunity:
 * CPCB does not publish an index for it either.
 */
export function stationAqi(records: readonly CpcbRecord[]): StationAqi | null {
  const station = String(records[0]?.station ?? '').trim();
  if (!station) return null;

  let best: { value: number; pollutant: string } | null = null;
  const seen = new Set<string>();
  let lastUpdate = '';

  for (const r of records) {
    const pollutant = String(r.pollutant_id ?? '').trim().toUpperCase();
    const value = subIndexOf(r);
    if (!pollutant || value === null) continue;
    seen.add(pollutant);
    if (!best || value > best.value) best = { value, pollutant };
    const stamp = String(r.last_update ?? '').trim();
    if (stamp && !lastUpdate) lastUpdate = stamp;
  }

  if (!best || seen.size < MIN_POLLUTANTS) return null;
  // At least one particulate is mandatory in CPCB's method.
  if (![...seen].some((p) => PARTICULATE.has(p))) return null;

  return { station, aqi: Math.round(best.value), dominant: best.pollutant, pollutants: seen.size, lastUpdate };
}

export interface CityAqi {
  city: string;
  /** The WORST station's index — see `cityAqi` for why this is not an average. */
  aqi: number;
  dominant: string;
  station: string;
  stationCount: number;
  lastUpdate: string;
}

/**
 * A city's air from its stations' rows. PURE.
 *
 * 🔒 THE WORST STATION, NAMED — NEVER AN AVERAGE WE INVENTED. CPCB publishes an index PER STATION.
 * Averaging them would produce a number that appears on no official page, which is exactly the
 * fabricated-figure this codebase forbids everywhere else. The worst station is a real published
 * reading, it is the one that matters to someone deciding whether to go out, and the caller states
 * plainly that it is the highest of N stations.
 */
export function cityAqi(records: readonly CpcbRecord[]): CityAqi | null {
  if (!records.length) return null;

  const byStation = new Map<string, CpcbRecord[]>();
  for (const r of records) {
    const station = String(r.station ?? '').trim();
    if (!station) continue;
    const list = byStation.get(station);
    if (list) list.push(r);
    else byStation.set(station, [r]);
  }

  let worst: StationAqi | null = null;
  let qualified = 0;
  for (const rows of byStation.values()) {
    const s = stationAqi(rows);
    if (!s) continue;
    qualified += 1;
    if (!worst || s.aqi > worst.aqi) worst = s;
  }
  if (!worst) return null;

  const city = String(records.find((r) => String(r.city ?? '').trim())?.city ?? '').trim();
  return {
    city,
    aqi: worst.aqi,
    dominant: worst.dominant,
    station: worst.station,
    stationCount: qualified,
    lastUpdate: worst.lastUpdate,
  };
}

/**
 * CPCB's own bands. PURE — the wording is theirs, so the model repeats the official category rather
 * than inventing an adjective for a number.
 */
export function aqiCategory(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Satisfactory';
  if (aqi <= 200) return 'Moderate';
  if (aqi <= 300) return 'Poor';
  if (aqi <= 400) return 'Very Poor';
  return 'Severe';
}

/** The request URL for one city. PURE, exported so a test can assert the host and the filter. */
export function cpcbCityUrl(city: string, apiKey: string): string {
  return `${CPCB_HOST}/${CPCB_RESOURCE_ID}`
    + `?api-key=${encodeURIComponent(apiKey)}`
    + '&format=json'
    + `&limit=${RECORD_LIMIT}`
    + `&filters[city]=${encodeURIComponent(city)}`;
}

/**
 * The one I/O function: a city's official air quality, or null.
 *
 * `fetchJson` is injected so this module never picks its own timeout or error policy — it inherits
 * the caller's, which is the one every other source in liveDataSources.ts already obeys (fixed
 * timeout, never throws, null on any failure).
 */
export async function fetchCityAirQuality(
  place: string,
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CityAqi | null> {
  const city = cpcbCityQuery(place);
  if (!city) return null;

  // 🔒 THROUGH THE SHARED CLIENT, NOT A PRIVATE FETCH — and this is the whole reason the client
  // exists. A dataset reached by its own bespoke call is a dataset with its own cache policy, its
  // own error handling and its own idea of which parameters are allowed; that is how a registry
  // becomes decoration. Going through `fetchGovResource` means AQI inherits the allowlist, the
  // per-row cache window, the typed failure reasons and the meter for free — and the next dataset
  // is a registry row rather than a new code path.
  //
  // ⚠️ THE CALLER'S `fetchImpl` IS THREADED THROUGH, NOT DROPPED. The first version of this
  // migration kept the old json-shaped seam as an unused parameter "to avoid widening the change".
  // That silently disconnected every injected fetch — the route's as much as the tests' — which is
  // a dead seam, not a small one. A parameter a function ignores is worse than one it does not take.
  const out = await fetchGovResource('cpcb-aqi', { city }, { env, fetchImpl });
  if (!out.ok) return null;
  return cityAqi(out.records as CpcbRecord[]);
}
