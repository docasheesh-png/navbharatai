// U-4 (verified recipe modules) — interactive-map generator (Google Maps + Mapbox).
//
// Real, working interactive maps generated into the app, Bring-Your-Own-keys (the user pastes their public
// map token into .env; NavBharatAI never stores it). Maps are client-side, so each recipe is a CLIENT helper:
// createMap(container, options) that mounts an interactive map, plus addMarker(...) — the two things every
// map feature needs (delivery tracking, store locators, real-estate, local services). PURE builders; the
// generated code is correct and complete — no TODO stubs (the real-features rule). Unit-tested.
//
// The token is the PUBLIC/browser map key (restrict it by HTTP referrer in the provider console) — it is
// meant to ship to the client, unlike a server secret. Exposed as VITE_* so a Vite app reads it in the
// browser (Next: rename to NEXT_PUBLIC_*).

export type MapProvider = 'googlemaps' | 'mapbox';

export interface MapConfig {
  provider: MapProvider;
  files: Record<string, string>;
  envKeys: string[];
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── Google Maps (via the official JS API loader) ─────────────────────────────────────────────────────────
const GOOGLE_CLIENT = `import { Loader } from '@googlemaps/js-api-loader';

// Bring-Your-Own Google Maps key — Google Cloud Console → APIs & Services → Credentials (enable "Maps
// JavaScript API"). It is a PUBLIC browser key: restrict it by HTTP referrer in the console. In Vite expose
// it as VITE_GOOGLE_MAPS_KEY; in Next as NEXT_PUBLIC_GOOGLE_MAPS_KEY.
const loader = new Loader({ apiKey: import.meta.env?.VITE_GOOGLE_MAPS_KEY as string, version: 'weekly' });

export interface MapOptions {
  center: { lat: number; lng: number };
  zoom?: number;
}

// Mount an interactive Google Map into \`container\`. Resolves with the map instance for further use.
export async function createMap(container: HTMLElement, options: MapOptions): Promise<google.maps.Map> {
  const { Map } = await loader.importLibrary('maps');
  return new Map(container, { center: options.center, zoom: options.zoom ?? 12 });
}

// Drop a marker on the map. Returns the marker so you can move/remove it later.
export async function addMarker(
  map: google.maps.Map,
  position: { lat: number; lng: number },
  title?: string,
): Promise<google.maps.marker.AdvancedMarkerElement> {
  const { AdvancedMarkerElement } = await loader.importLibrary('marker');
  return new AdvancedMarkerElement({ map, position, title });
}
`;

// ── Mapbox (Mapbox GL JS) ────────────────────────────────────────────────────────────────────────────────
const MAPBOX_CLIENT = `import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css'; // the map is invisible/broken without the stylesheet

// Bring-Your-Own Mapbox token — Mapbox account → Access tokens. It is a PUBLIC browser token (scope it to
// your URLs). In Vite expose it as VITE_MAPBOX_TOKEN; in Next as NEXT_PUBLIC_MAPBOX_TOKEN.
mapboxgl.accessToken = import.meta.env?.VITE_MAPBOX_TOKEN as string;

export interface MapOptions {
  center: { lat: number; lng: number };
  zoom?: number;
}

// Mount an interactive Mapbox map into \`container\`. Returns the map instance for further use.
export function createMap(container: HTMLElement, options: MapOptions): mapboxgl.Map {
  return new mapboxgl.Map({
    container,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [options.center.lng, options.center.lat], // Mapbox is [lng, lat]
    zoom: options.zoom ?? 12,
  });
}

// Drop a marker on the map. Returns the marker so you can move/remove it later.
export function addMarker(map: mapboxgl.Map, position: { lat: number; lng: number }, title?: string): mapboxgl.Marker {
  const marker = new mapboxgl.Marker().setLngLat([position.lng, position.lat]);
  if (title) marker.setPopup(new mapboxgl.Popup().setText(title));
  return marker.addTo(map);
}
`;

const GOOGLE_INSTRUCTIONS =
  'Google Maps wired. Enable "Maps JavaScript API" in Google Cloud Console, create a browser key, restrict ' +
  'it by HTTP referrer, and paste it into .env as VITE_GOOGLE_MAPS_KEY — NavBharatAI never stores it. Import ' +
  'createMap/addMarker and mount into a <div> ref. The key is a public browser key by design; the referrer ' +
  'restriction is what protects it.';

const MAPBOX_INSTRUCTIONS =
  'Mapbox wired. Copy a public access token from your Mapbox account, scope it to your URLs, and paste it ' +
  'into .env as VITE_MAPBOX_TOKEN — NavBharatAI never stores it. Import createMap/addMarker and mount into a ' +
  '<div> ref (the mapbox-gl CSS is imported for you). The token is a public browser token by design.';

export function generateMapIntegration(provider: MapProvider): MapConfig {
  if (provider === 'googlemaps') {
    return {
      provider,
      files: {
        'src/lib/map.ts': GOOGLE_CLIENT,
        [ENV_EXAMPLE]: 'VITE_GOOGLE_MAPS_KEY=\n',
      },
      envKeys: ['VITE_GOOGLE_MAPS_KEY'],
      dependencies: [{ name: '@googlemaps/js-api-loader', version: '^1' }],
      instructions: GOOGLE_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'src/lib/map.ts': MAPBOX_CLIENT,
      [ENV_EXAMPLE]: 'VITE_MAPBOX_TOKEN=\n',
    },
    envKeys: ['VITE_MAPBOX_TOKEN'],
    dependencies: [{ name: 'mapbox-gl', version: '^3' }],
    instructions: MAPBOX_INSTRUCTIONS,
  };
}

export function isMapProvider(v: unknown): v is MapProvider {
  return v === 'googlemaps' || v === 'mapbox';
}
