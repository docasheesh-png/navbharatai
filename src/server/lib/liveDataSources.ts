// liveDataSources — KEY-FREE real live data for the chat surfaces (admin 2026-08-25: "sirf live train
// hi nahi — bus, flights, movie, show, jo jo hote hai sab").
//
// transitLive.ts holds the env-keyed feeds (train/PNR/flight — those genuinely need a paid-market
// key). THIS module holds everything that has a REAL, free, no-key data source, so it works for every
// user from the moment it merges:
//
//   • Weather + rain ("mausam", "barish hogi kya")  — Open-Meteo forecast + its geocoder.
//   • Air quality ("AQI", "pollution")              — Open-Meteo air-quality.
//   • Currency ("dollar ka rate")                   — open.er-api.com daily rates.
//   • PIN code ("208001 kaha ka hai")               — India Post data via api.postalpincode.in.
//   • Movies now playing ("kaun si movie lagi hai") — TMDB, ONLY when TMDB_API_KEY is set (no free
//     no-key source exists; without the key it degrades to web search, never an invented listing).
//
// What is deliberately NOT here, said plainly rather than faked: live BUS position (no reliable
// pan-India feed exists), cinema SHOWTIMES for a specific hall (no public API — search path), and
// gold/petrol rates (no dependable free feed — search path answers those well).
//
// Every source: fixed hosts (no SSRF surface), its own timeout, never throws, '' on any failure so
// the caller's web-search fallback answers instead. No vendor/API name ever enters the model-facing
// block (White-Label Law) — the user experiences NavBharatAI knowing the answer.
//
// ⚠️ LICENSING ITEM, recorded not hidden (same class as the VirusTotal note in CLAUDE.md): Open-Meteo's
// no-key tier is licensed for NON-COMMERCIAL use. Fine for launch-scale testing; before heavy real
// traffic the admin either buys Open-Meteo's commercial plan or we switch this source to a keyed
// provider. The code isolates the choice to ONE builder function per source, so a swap is one edit.

import { liveTransitContext } from './transitLive';

const SOURCE_TIMEOUT_MS = 5_000;

async function fetchJson(url: string, fetchImpl: typeof fetch, timeoutMs = SOURCE_TIMEOUT_MS, headers?: Record<string, string>): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, ...(headers ? { headers } : {}) });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Place extraction (weather/AQI need a WHERE) ────────────────────────────────────────────────────

const PLACE_WORD = String.raw`([A-Za-zऀ-ॿ]{3,}(?:\s+[A-Za-zऀ-ॿ]{2,})?)`;
/** Words that sit next to a place word but are not places. */
const NOT_A_PLACE = /^(?:aaj|kal|abhi|city|sheher|shahar|shehar|yahan|wahan|mere|hamare|apne|india|weather|mausam|barish|baarish|aqi|pollution|температура|temperature|forecast|report|kaisa|kaisi|kya|hai|hoga|hogi|me|mein|ka|ki|ke|in|at|of|the|today|tomorrow|tonight)$/i;

/**
 * The place a weather/AQI question is about, or '' when none is named. PURE.
 *
 * '' is a real answer, not a failure: the recency directive already tells the model to ASK the user's
 * city when a location-dependent question names none — guessing a city and geocoding it would answer
 * confidently for somewhere the user is not.
 */
export function extractPlace(message: string): string {
  const m = String(message ?? '');
  const candidates = [
    // "<place> me/ka mausam", "<place> ki hawa"
    new RegExp(String.raw`${PLACE_WORD}\s+(?:me|mein|ka|ki|ke)\s+(?:mausam|weather|barish|baarish|aqi|air|hawa|pollution|temperature|tapman)`, 'i'),
    // "weather in <place>", "mausam of <place>", "barish in <place>"
    new RegExp(String.raw`(?:mausam|weather|barish|baarish|aqi|air\s+quality|pollution|temperature|forecast)\s+(?:in|at|of|for)\s+${PLACE_WORD}`, 'i'),
    // "<place> weather" / "<place> aqi"
    new RegExp(String.raw`${PLACE_WORD}\s+(?:weather|aqi|forecast)\b`, 'i'),
  ];
  for (const re of candidates) {
    const hit = m.match(re);
    // A two-word capture can drag a filler along ("Mumbai today") — trim non-place words off both ends.
    const words = (hit?.[1]?.trim() ?? '').split(/\s+/).filter(Boolean);
    while (words.length && NOT_A_PLACE.test(words[words.length - 1])) words.pop();
    while (words.length && NOT_A_PLACE.test(words[0])) words.shift();
    const place = words.join(' ');
    if (place) return place;
  }
  return '';
}

const WEATHER_SIGNAL = /\b(?:mausam|weather|barish|baarish|temperature|tapman|forecast|garmi|sardi|humidity)\b/i;
const AQI_SIGNAL = /\b(?:aqi|air\s+quality|pollution|hawa\s+(?:kaisi|kharab|saaf))\b/i;

/** Geocode a place name → {lat, lon, label} or null. Fixed host; never throws. */
async function geocode(place: string, fetchImpl: typeof fetch): Promise<{ lat: number; lon: number; label: string } | null> {
  const data = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
    fetchImpl,
  );
  const r = data?.results?.[0];
  if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return null;
  const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
  return { lat: r.latitude, lon: r.longitude, label };
}

async function weatherBlock(message: string, fetchImpl: typeof fetch, now: Date): Promise<string> {
  if (!WEATHER_SIGNAL.test(message)) return '';
  const place = extractPlace(message);
  if (!place) return ''; // no place named → the directive makes the model ask, honestly
  const geo = await geocode(place, fetchImpl);
  if (!geo) return '';
  const data = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}`
      + `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2&timezone=auto`,
    fetchImpl,
  );
  const cur = data?.current;
  if (!cur || typeof cur.temperature_2m !== 'number') return '';
  const daily = data?.daily ?? {};
  const lines = [
    `Place: ${geo.label}`,
    `Now: ${cur.temperature_2m}°C, humidity ${cur.relative_humidity_2m ?? '?'}%, wind ${cur.wind_speed_10m ?? '?'} km/h, precipitation ${cur.precipitation ?? 0} mm`,
    `Today: max ${daily.temperature_2m_max?.[0] ?? '?'}°C / min ${daily.temperature_2m_min?.[0] ?? '?'}°C, rain chance ${daily.precipitation_probability_max?.[0] ?? '?'}%`,
    `Tomorrow: max ${daily.temperature_2m_max?.[1] ?? '?'}°C / min ${daily.temperature_2m_min?.[1] ?? '?'}°C, rain chance ${daily.precipitation_probability_max?.[1] ?? '?'}%`,
  ];
  return liveBlock('LIVE WEATHER DATA', lines.join('\n'), now,
    'For official Indian forecasts and warnings: mausam.imd.gov.in (IMD).');
}

async function aqiBlock(message: string, fetchImpl: typeof fetch, now: Date): Promise<string> {
  if (!AQI_SIGNAL.test(message)) return '';
  const place = extractPlace(message);
  if (!place) return '';
  const geo = await geocode(place, fetchImpl);
  if (!geo) return '';
  const data = await fetchJson(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${geo.lat}&longitude=${geo.lon}`
      + `&current=pm2_5,pm10,us_aqi&timezone=auto`,
    fetchImpl,
  );
  const cur = data?.current;
  if (!cur || typeof cur.us_aqi !== 'number') return '';
  const lines = [
    `Place: ${geo.label}`,
    `Air quality index (US AQI): ${cur.us_aqi}`,
    `PM2.5: ${cur.pm2_5 ?? '?'} µg/m³, PM10: ${cur.pm10 ?? '?'} µg/m³`,
  ];
  return liveBlock('LIVE AIR QUALITY DATA', lines.join('\n'), now,
    'For official Indian AQI: the CPCB app/site (app.cpcbccr.com).');
}

// ── Currency ───────────────────────────────────────────────────────────────────────────────────────

const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/\b(?:dollar|usd)\b/i, 'USD'], [/\b(?:euro|eur)\b/i, 'EUR'], [/\b(?:pound|gbp)\b/i, 'GBP'],
  [/\b(?:yen|jpy)\b/i, 'JPY'], [/\b(?:dirham|aed)\b/i, 'AED'], [/\b(?:riyal|sar)\b/i, 'SAR'],
  [/\b(?:dinar|kwd)\b/i, 'KWD'], [/\baud\b/i, 'AUD'], [/\bcad\b/i, 'CAD'], [/\b(?:yuan|cny)\b/i, 'CNY'],
];
const RATE_SIGNAL = /\b(?:rate|bhav|price|kitn[ae]|kitna|value|exchange|convert|rupay?e|rupee|inr|me\s+kitne)\b/i;

/** Which currency's INR rate is being asked, or ''. PURE. */
export function detectCurrency(message: string): string {
  const m = String(message ?? '');
  if (!RATE_SIGNAL.test(m)) return '';
  for (const [re, code] of CURRENCY_WORDS) if (re.test(m)) return code;
  return '';
}

async function currencyBlock(message: string, fetchImpl: typeof fetch, now: Date): Promise<string> {
  const code = detectCurrency(message);
  if (!code) return '';
  const data = await fetchJson(`https://open.er-api.com/v6/latest/${code}`, fetchImpl);
  const inr = data?.rates?.INR;
  if (typeof inr !== 'number' || !(inr > 0)) return '';
  const updated = typeof data?.time_last_update_utc === 'string' ? ` (rates updated: ${data.time_last_update_utc})` : '';
  return liveBlock('LIVE CURRENCY DATA', `1 ${code} = ₹${inr.toFixed(2)} INR${updated}`, now,
    'These are daily reference rates; a bank/exchange will quote slightly different buy/sell rates.');
}

// ── PIN code ───────────────────────────────────────────────────────────────────────────────────────

/** The 6-digit Indian PIN being asked about, or ''. PURE. */
export function detectPincode(message: string): string {
  const m = String(message ?? '');
  if (!/\bpin\s*code\b/i.test(m)) return '';
  const hit = m.match(/\b([1-9]\d{5})\b/);
  return hit ? hit[1] : '';
}

async function pincodeBlock(message: string, fetchImpl: typeof fetch, now: Date): Promise<string> {
  const pin = detectPincode(message);
  if (!pin) return '';
  const data = await fetchJson(`https://api.postalpincode.in/pincode/${pin}`, fetchImpl);
  const entry = Array.isArray(data) ? data[0] : null;
  const offices = entry?.PostOffice;
  if (entry?.Status !== 'Success' || !Array.isArray(offices) || offices.length === 0) return '';
  const head = offices[0];
  const names = offices.slice(0, 6).map((o: any) => o?.Name).filter(Boolean).join(', ');
  const lines = [
    `PIN ${pin}: ${head?.District ?? '?'} district, ${head?.State ?? '?'}`,
    `Post offices: ${names}${offices.length > 6 ? `, +${offices.length - 6} more` : ''}`,
  ];
  return liveBlock('PIN CODE DATA', lines.join('\n'), now, '');
}

// ── Movies now playing (env-gated: TMDB_API_KEY) ───────────────────────────────────────────────────

const MOVIE_SIGNAL = /(?:kaun\s*si\s+(?:movie|film|picture)|(?:new|latest|nayi|naya)\s+(?:movie|film)|now\s+playing|(?:movie|film)s?\s+(?:released|lagi|aayi|chal\s+rahi|in\s+theatres?|in\s+cinemas?)|abhi\s+(?:kaun\s*si|kya)\s+(?:movie|film))/i;

async function moviesBlock(message: string, fetchImpl: typeof fetch, now: Date, env: NodeJS.ProcessEnv): Promise<string> {
  if (!MOVIE_SIGNAL.test(message)) return '';
  const key = String(env.TMDB_API_KEY ?? '').trim();
  if (!key) return ''; // no key ⇒ web search answers; a listing is never invented
  const data = await fetchJson(
    `https://api.themoviedb.org/3/movie/now_playing?api_key=${encodeURIComponent(key)}&region=IN&language=en-IN&page=1`,
    fetchImpl,
  );
  const list = Array.isArray(data?.results) ? data.results.slice(0, 10) : [];
  if (list.length === 0) return '';
  const lines = list.map((f: any, i: number) => `${i + 1}. ${f?.title ?? '?'}${f?.release_date ? ` (released ${f.release_date})` : ''}`);
  return liveBlock('MOVIES NOW PLAYING IN INDIA', lines.join('\n'), now,
    'For showtimes at a specific cinema, the user should check their local booking app — hall-wise timings are not in this data.');
}

// ── The block wrapper + the one dispatcher ─────────────────────────────────────────────────────────

function liveBlock(title: string, body: string, now: Date, note: string): string {
  return `${title} (fetched just now, ${now.toISOString()}):
${body}

Use this CURRENT data as your PRIMARY source — answer plainly in the user's language. If it doesn't cover what was asked, say so honestly.${note ? ` ${note}` : ''} Do not mention the data feed or that a lookup ran unless the user asks.`;
}

export interface LiveDataOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: Date;
}

/**
 * ONE dispatcher for every live source: the first source whose shape matches the message answers, and
 * '' means "nothing live applies — let the web search answer". Transit (env-keyed) is tried first
 * because a train/PNR/flight number is the most specific shape a message can have.
 */
export async function liveDataContext(message: string, opts: LiveDataOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const transit = await liveTransitContext(message, { env, fetchImpl, now }).catch(() => '');
  if (transit) return transit;
  for (const source of [weatherBlock, aqiBlock, currencyBlock, pincodeBlock]) {
    const block = await source(message, fetchImpl, now).catch(() => '');
    if (block) return block;
  }
  return moviesBlock(message, fetchImpl, now, env).catch(() => '');
}
