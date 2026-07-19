// U-4 (verified recipe modules) — geocoding generator (Google + Mapbox).
//
// Real, working geocoding generated into the app, Bring-Your-Own-keys (the user pastes their provider key
// into .env; NavBharatAI never stores it). Geocoding is address ⇄ coordinates conversion — the backend
// counterpart to the map recipe — behind delivery ("where is this address?"), store locators, address
// autocomplete/validation and "nearest branch" features. Each recipe is a SERVER helper (the key is a secret
// and must never reach the browser): geocode(address) → { lat, lng } and reverseGeocode(lat, lng) → address.
// Both providers are plain REST APIs called with the built-in fetch, so NO npm dependency is needed. PURE
// builders; the generated code is correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export type GeocodingProvider = 'google' | 'mapbox';

export interface GeocodingConfig {
  provider: GeocodingProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Both providers use the global fetch against a REST API — no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Google Geocoding API ─────────────────────────────────────────────────────────────────────────────────
const GOOGLE_SERVER = `// Bring-Your-Own Google key — Google Cloud Console → enable "Geocoding API", create a SERVER key (restrict
// it by IP, not referrer — this is called from your backend). Pasted into .env as GOOGLE_GEOCODING_API_KEY.
const KEY = process.env.GOOGLE_GEOCODING_API_KEY as string;

export interface LatLng { lat: number; lng: number; }

// Address → coordinates. Returns null when the address can't be found.
export async function geocode(address: string): Promise<LatLng | null> {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(address) + '&key=' + KEY;
  const r = await fetch(url);
  const data = await r.json();
  const loc = data?.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

// Coordinates → a human-readable address. Returns null when nothing matches.
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + lng + '&key=' + KEY;
  const r = await fetch(url);
  const data = await r.json();
  return data?.results?.[0]?.formatted_address ?? null;
}
`;

// ── Mapbox Geocoding API ─────────────────────────────────────────────────────────────────────────────────
const MAPBOX_SERVER = `// Bring-Your-Own Mapbox token — Mapbox account → Access tokens. Pasted into .env as MAPBOX_GEOCODING_TOKEN.
// NOTE: Mapbox returns coordinates as [longitude, latitude] — the opposite order to most APIs.
const TOKEN = process.env.MAPBOX_GEOCODING_TOKEN as string;

export interface LatLng { lat: number; lng: number; }

// Address → coordinates. Returns null when the address can't be found.
export async function geocode(address: string): Promise<LatLng | null> {
  const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(address) + '.json?limit=1&access_token=' + TOKEN;
  const r = await fetch(url);
  const data = await r.json();
  const center = data?.features?.[0]?.center; // [lng, lat]
  return Array.isArray(center) ? { lat: center[1], lng: center[0] } : null;
}

// Coordinates → a human-readable place name. Returns null when nothing matches.
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + lng + ',' + lat + '.json?limit=1&access_token=' + TOKEN;
  const r = await fetch(url);
  const data = await r.json();
  return data?.features?.[0]?.place_name ?? null;
}
`;

const GOOGLE_INSTRUCTIONS =
  'Google geocoding wired. Enable "Geocoding API" in Google Cloud Console, create a SERVER key (restrict by ' +
  'IP), and paste it into .env as GOOGLE_GEOCODING_API_KEY — NavBharatAI never stores it. Import geocode(' +
  'address) / reverseGeocode(lat, lng) in server code. The key stays server-side, so call geocoding from your ' +
  'backend, never the browser.';

const MAPBOX_INSTRUCTIONS =
  'Mapbox geocoding wired. Paste a Mapbox token into .env as MAPBOX_GEOCODING_TOKEN — NavBharatAI never ' +
  'stores it. Import geocode(address) / reverseGeocode(lat, lng) in server code. Mapbox returns [lng, lat] ' +
  '(handled for you). Call geocoding from your backend so the token is not exposed in the browser.';

export function generateGeocodingIntegration(provider: GeocodingProvider): GeocodingConfig {
  if (provider === 'google') {
    return {
      provider,
      files: {
        'server/lib/geocoding.ts': GOOGLE_SERVER,
        [ENV_EXAMPLE]: 'GOOGLE_GEOCODING_API_KEY=\n',
      },
      envKeys: ['GOOGLE_GEOCODING_API_KEY'],
      instructions: GOOGLE_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/geocoding.ts': MAPBOX_SERVER,
      [ENV_EXAMPLE]: 'MAPBOX_GEOCODING_TOKEN=\n',
    },
    envKeys: ['MAPBOX_GEOCODING_TOKEN'],
    instructions: MAPBOX_INSTRUCTIONS,
  };
}

export function isGeocodingProvider(v: unknown): v is GeocodingProvider {
  return v === 'google' || v === 'mapbox';
}
