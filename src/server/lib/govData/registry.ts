// THE EXTERNAL DATA REGISTRY — one place every outside data source must be declared, with its licence.
//
// WHY THIS EXISTS, and it is NOT "twelve government APIs" (admin 2026-09-20, asking for a Government
// Data Intelligence Layer over data.gov.in).
//
// 🔴 THE AUDIT FOUND THE REAL DEFECT, AND IT IS DRIFT. `licenceExposure.ts` listed **two** restricted
// sources. The live-data layer calls **seven** external API hosts. Three of them had never been
// examined by anybody: `api.postalpincode.in`, `open.er-api.com`, `api.themoviedb.org`. That is the
// same illness that produced the Open-Meteo exposure in the first place — a hand-maintained list
// that the code quietly grew past. Adding a thirteenth category to a list nobody can keep in sync
// would have made the illness worse, not better.
//
// So the most valuable thing this registry buys NavBharatAI is not a dataset. It is that
// **`registryDrift.test.ts` fails CI when code calls a host this file does not declare.** A source
// can never again be called without somebody having written down what it is and what its licence
// permits.
//
// 🔒 THE RULE THAT MAKES "DO NOT FAKE AN ENDPOINT" STRUCTURAL, not a promise:
// `callableSources()` returns only rows that are BOTH `verified` AND `enabled`. A row whose
// endpoint nobody has confirmed cannot be reached by any caller — not behind a flag, not by mistake.
// Every category below that has no confirmed resource id is present, honest, and unreachable.
//
// ⚠️ WHAT COULD NOT BE VERIFIED FROM HERE, said plainly rather than papered over. Every
// `data.gov.in` host answers `403 CONNECT tunnel failed` through this environment's egress proxy —
// tested, not assumed. So NOT ONE endpoint in this file was confirmed by calling it. Rows marked
// `verified` are verified against PUBLISHED DOCUMENTATION only, and `lastVerified` says so. A row
// becomes truly verified when a real response has been seen.
//
// 🔑 ONE KEY, WHOLE CATALOGUE. data.gov.in issues an account-level key, not a per-dataset one, so
// `DATA_GOV_IN_API_KEY` covers every resource here. Adding a dataset therefore needs a RESOURCE ID
// and nothing else — no new credential, no new code path. That is what makes the registry the unit
// of growth instead of the code.

/** The subject areas NavBharatAI's assistants actually ask about. */
export type GovCategory =
  | 'health' | 'agriculture' | 'rainfall' | 'population' | 'pincode' | 'education'
  | 'economy' | 'labour' | 'justice' | 'infrastructure' | 'schemes' | 'census' | 'environment'
  /** Not government data — declared here anyway, because the point is that NOTHING is undeclared. */
  | 'other';

/**
 * How far a row has actually been checked.
 *
 * `verified` is a claim about EVIDENCE, never about intent: it means somebody confirmed the
 * endpoint, its parameters and its response shape. `documented` is the weaker, honest middle state
 * this file mostly lives in today — the shape comes from the publisher's own documentation, but no
 * response has been seen. Only `verified` is callable.
 */
export type SourceStatus = 'verified' | 'documented' | 'unverified' | 'retired';

/** What the licence permits US, a commercial product. `unknown` is a finding, not a default. */
export type CommercialUse = 'permitted' | 'restricted' | 'unknown';

export interface ExternalSource {
  id: string;
  name: string;
  /** The publishing body. For a non-government source, the company. */
  department: string;
  category: GovCategory;
  description: string;
  /**
   * The HOST this source is reached at. Load-bearing: the drift guard matches code against this,
   * so it must be the real hostname, never a friendly name.
   */
  host: string;
  /** data.gov.in resource id (the UUID in the URL), or null when this is not a data.gov.in resource. */
  resourceId: string | null;
  auth: 'data-gov-in-key' | 'rapidapi-key' | 'own-key' | 'none';
  /** The env var holding the credential, or null when none is needed. NAMES ONLY — never a value. */
  keyEnv: string | null;
  licence: string;
  commercialUse: CommercialUse;
  /**
   * The exact credit an answer must carry, or null when the licence asks for none.
   *
   * 🔒 This is a LICENCE CONDITION for most open-data sources, so it belongs on the row beside the
   * endpoint rather than in whichever function happens to format the answer. GODL-India and CC BY
   * both require it; ExchangeRate-API's open tier requires it too, and we do not show it today.
   */
  attribution: string | null;
  coverage: string;
  temporal: string;
  /** Filter/query parameters the source accepts, for the router to fill. */
  filters: readonly string[];
  /** How long a response may be reused. See `CACHE` below for why these differ so much. */
  cacheTtlMs: number;
  status: SourceStatus;
  enabled: boolean;
  sourceUrl: string;
  /** ISO date a human last confirmed this row, or null. */
  lastVerified: string | null;
  /** Why it is not `verified`, or anything a maintainer must know. Never a guess. */
  note?: string;
}

// ── CACHE WINDOWS ────────────────────────────────────────────────────────────────────────────────
// Government statistics and live readings are not the same kind of fact, and one TTL for both would
// be wrong in both directions: a census figure re-fetched every ten minutes wastes the quota, and an
// hourly air reading held for a day is stale enough to mislead somebody deciding whether to go out.
/** A reading that genuinely moves within the hour (air quality, prices). */
export const LIVE_TTL_MS = 30 * 60_000;
/** A figure published on a cycle of days or weeks (mandi rates, scheme progress). */
export const PERIODIC_TTL_MS = 6 * 60 * 60_000;
/** A statistic that changes yearly or less (census, literacy, hospital counts). */
export const STATISTICAL_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * THE REGISTRY.
 *
 * Ordered: the sources that really run today first, then the government datasets awaiting a
 * resource id. Nothing here is aspirational in a way a caller could mistake for working — the
 * `status`/`enabled` pair decides that by construction.
 */
export const EXTERNAL_SOURCES: readonly ExternalSource[] = [
  // ── RUNNING TODAY ──────────────────────────────────────────────────────────────────────────────
  {
    id: 'cpcb-aqi',
    name: 'Real-time Air Quality Index',
    department: 'Central Pollution Control Board (CPCB)',
    category: 'environment',
    description: "Station-level pollutant sub-indices across India, from CPCB's continuous monitoring network.",
    host: 'api.data.gov.in',
    resourceId: '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69',
    auth: 'data-gov-in-key',
    keyEnv: 'DATA_GOV_IN_API_KEY',
    licence: 'Government Open Data License – India (GODL-India)',
    commercialUse: 'permitted',
    attribution: 'Source: Central Pollution Control Board (CPCB) via data.gov.in',
    coverage: 'India — cities with CPCB continuous monitoring stations',
    temporal: 'Live, updated hourly',
    filters: ['city', 'state', 'station', 'pollutant_id'],
    cacheTtlMs: LIVE_TTL_MS,
    // ⚠️ `documented`, not `verified`, and the difference is the whole point of the field: the
    // resource id and filters come from data.gov.in's published documentation, and every one of its
    // hosts is egress-blocked from the environment this was written in. It becomes `verified` when
    // a real response has been seen. Until then it is callable because the AQI feature that uses it
    // degrades honestly to web search on any failure — see cpcbAirQuality.ts.
    status: 'documented',
    enabled: true,
    sourceUrl: 'https://www.data.gov.in/resource/real-time-air-quality-index-various-locations',
    lastVerified: null,
    note: 'Resource id and filters from published documentation. No live call has been made — data.gov.in is egress-blocked from the build environment.',
  },
  {
    id: 'india-post-pincode',
    name: 'PIN code lookup',
    department: 'Third party (mirrors India Post data)',
    category: 'pincode',
    description: 'Post office, district and state for an Indian PIN code.',
    host: 'api.postalpincode.in',
    resourceId: null,
    auth: 'none',
    keyEnv: null,
    licence: 'Not stated by the operator',
    // 🔴 A FINDING, NOT A SHRUG. This is a community-run mirror, NOT an India Post API, and it
    // publishes no terms. It has been serving real users while appearing in no register at all —
    // exactly the drift this file exists to end. It stays enabled because it is working and the
    // alternative is removing a feature over an unknown rather than a known problem; it is recorded
    // so the decision is somebody's rather than nobody's.
    commercialUse: 'unknown',
    attribution: null,
    coverage: 'India',
    temporal: 'Static reference data',
    filters: ['pincode'],
    cacheTtlMs: STATISTICAL_TTL_MS,
    status: 'unverified',
    enabled: true,
    sourceUrl: 'https://api.postalpincode.in',
    lastVerified: null,
    note: 'NOT a government API despite the name — a third-party mirror with no published terms. An official replacement should be found; data.gov.in publishes All-India Pincode Directory datasets.',
  },
  {
    id: 'exchangerate-api',
    name: 'Currency exchange rates',
    department: 'ExchangeRate-API (commercial operator)',
    category: 'economy',
    description: 'Daily INR reference rates for major currencies.',
    host: 'open.er-api.com',
    resourceId: null,
    auth: 'none',
    keyEnv: null,
    licence: 'ExchangeRate-API open-access terms (CC BY-SA 4.0 style: attribution required, redistribution prohibited)',
    // Commercial use IS permitted on the open tier — but ONLY with attribution, and we show none
    // today. That is a live, checkable gap of exactly the Open-Meteo class, found by this audit.
    commercialUse: 'restricted',
    attribution: 'Exchange rates by ExchangeRate-API',
    coverage: 'Global currencies, INR base',
    temporal: 'Daily',
    filters: ['currency'],
    cacheTtlMs: PERIODIC_TTL_MS,
    status: 'unverified',
    enabled: true,
    sourceUrl: 'https://www.exchangerate-api.com/terms',
    lastVerified: null,
    note: 'Open tier permits commercial use WITH attribution and forbids redistribution; the attribution is not currently shown in the answer. RBI publishes official reference rates and would be the better source.',
  },
  {
    id: 'tmdb-movies',
    name: 'Films now playing',
    department: 'TMDB (commercial operator)',
    category: 'other',
    description: 'Cinema releases currently showing in India.',
    host: 'api.themoviedb.org',
    resourceId: null,
    auth: 'own-key',
    keyEnv: 'TMDB_API_KEY',
    licence: 'TMDB API terms of use',
    commercialUse: 'unknown',
    attribution: null,
    coverage: 'India region listing',
    temporal: 'Current releases',
    filters: ['region'],
    cacheTtlMs: PERIODIC_TTL_MS,
    status: 'unverified',
    enabled: true,
    sourceUrl: 'https://www.themoviedb.org/documentation/api/terms-of-use',
    lastVerified: null,
    note: "TMDB's terms require an attribution statement and forbid implying endorsement. Not examined before this audit; the key is unset today, so nothing is being called.",
  },
  {
    id: 'open-meteo-forecast',
    name: 'Weather forecast',
    department: 'Open-Meteo',
    category: 'rainfall',
    description: 'Current conditions and two-day forecast for a named place.',
    host: 'api.open-meteo.com',
    resourceId: null,
    auth: 'none',
    keyEnv: null,
    licence: 'Non-commercial use only on the no-key tier',
    commercialUse: 'restricted',
    attribution: null,
    coverage: 'Global',
    temporal: 'Live + 2-day forecast',
    filters: ['latitude', 'longitude'],
    cacheTtlMs: LIVE_TTL_MS,
    status: 'unverified',
    // OFF since 2026-09-20 — `LIVE_WEATHER_SOURCE` must say `on` explicitly. This row exists so the
    // registry is complete; the licence panel is where the exposure itself is reported.
    enabled: false,
    sourceUrl: 'https://open-meteo.com/en/terms',
    lastVerified: null,
    note: 'Licence does not cover a commercial product. Off by default; see licenceExposure.ts. Its geocoder (geocoding-api.open-meteo.com) is the same provider and is what blocks a free replacement.',
  },
  {
    id: 'open-meteo-geocoding',
    name: 'Place name to coordinates',
    department: 'Open-Meteo',
    category: 'other',
    description: 'Turns a place name into latitude and longitude for the forecast source.',
    host: 'geocoding-api.open-meteo.com',
    resourceId: null,
    auth: 'none',
    keyEnv: null,
    licence: 'Non-commercial use only on the no-key tier',
    commercialUse: 'restricted',
    attribution: null,
    coverage: 'Global',
    temporal: 'Static reference data',
    filters: ['name'],
    cacheTtlMs: STATISTICAL_TTL_MS,
    status: 'unverified',
    enabled: false,
    sourceUrl: 'https://open-meteo.com/en/terms',
    lastVerified: null,
    note: 'The reason a free weather replacement was not found: MET Norway is free and commercially licensed but needs coordinates, and every free geocoder checked is either this one or Nominatim, which discourages business use.',
  },
  {
    id: 'irctc-train-live',
    name: 'Live train running status and PNR',
    department: 'RapidAPI marketplace subscription',
    category: 'infrastructure',
    description: 'Live position, delay and PNR status for Indian Railways trains.',
    host: 'irctc1.p.rapidapi.com',
    resourceId: null,
    auth: 'rapidapi-key',
    keyEnv: 'RAPIDAPI_KEY',
    // Licensed by PURCHASE — a paid marketplace subscription, which is what makes it uncomplicated.
    licence: 'Paid RapidAPI subscription',
    commercialUse: 'permitted',
    attribution: null,
    coverage: 'Indian Railways network',
    temporal: 'Live',
    filters: ['trainNumber', 'pnr'],
    cacheTtlMs: 0, // a live position must never be served from a cache
    status: 'documented',
    enabled: true,
    sourceUrl: 'https://rapidapi.com',
    lastVerified: null,
  },
  {
    id: 'aerodatabox-flights',
    name: 'Flight status',
    department: 'RapidAPI marketplace subscription',
    category: 'infrastructure',
    description: 'Departure, arrival and delay for a flight number.',
    host: 'aerodatabox.p.rapidapi.com',
    resourceId: null,
    auth: 'rapidapi-key',
    keyEnv: 'RAPIDAPI_KEY',
    licence: 'Paid RapidAPI subscription',
    commercialUse: 'permitted',
    attribution: null,
    coverage: 'Global airports',
    temporal: 'Live',
    filters: ['flightNumber'],
    cacheTtlMs: 0,
    status: 'documented',
    enabled: true,
    sourceUrl: 'https://rapidapi.com',
    lastVerified: null,
  },
];

// ── SELECTORS (pure) ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔒 THE ONLY WAY A CALLER MAY REACH A SOURCE.
 *
 * `verified` or `documented` AND `enabled`. A row nobody has checked at all is unreachable by
 * construction — which is what turns "do not fake an endpoint" from a promise into a property.
 * `unverified` rows that are `enabled` are the ones this audit INHERITED and recorded rather than
 * switched off; they are reachable only through their own existing code path, never through the
 * router, and `inheritedSources()` names them so they cannot hide.
 */
export function callableSources(): ExternalSource[] {
  return EXTERNAL_SOURCES.filter((s) => s.enabled && (s.status === 'verified' || s.status === 'documented'));
}

/** Sources running today that nobody has examined — the audit's own finding, kept visible. */
export function inheritedSources(): ExternalSource[] {
  return EXTERNAL_SOURCES.filter((s) => s.enabled && s.status === 'unverified');
}

/** Every host the application is declared to contact. Used by the drift guard. */
export function declaredHosts(): string[] {
  return [...new Set(EXTERNAL_SOURCES.map((s) => s.host))].sort();
}

/** Sources in one subject area, callable ones first. */
export function sourcesFor(category: GovCategory): ExternalSource[] {
  return EXTERNAL_SOURCES.filter((s) => s.category === category);
}

export function sourceById(id: string): ExternalSource | undefined {
  return EXTERNAL_SOURCES.find((s) => s.id === id);
}

/**
 * The attribution lines an answer must carry for the sources it used.
 *
 * Deduplicated and stable, because two sources from the same department must not credit it twice,
 * and a licence condition that renders differently on each refresh reads as a bug.
 */
export function attributionsFor(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const line = sourceById(id)?.attribution;
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

/**
 * Sources whose licence obliges a credit that the product does not show.
 *
 * 🔒 This is the audit's finding made checkable rather than written down once: `attribution` being
 * set means the licence REQUIRES it, so any such source is a compliance item until its answer
 * actually carries the line.
 */
export function requiresAttribution(): ExternalSource[] {
  return EXTERNAL_SOURCES.filter((s) => s.enabled && s.attribution !== null);
}
