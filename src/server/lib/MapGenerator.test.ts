import { describe, it, expect } from 'vitest';
import { generateMapIntegration, isMapProvider } from './MapGenerator';

describe('generateMapIntegration — Google Maps', () => {
  const c = generateMapIntegration('googlemaps');

  it('emits a client helper that mounts a map and adds markers via the official loader', () => {
    const client = c.files['src/lib/map.ts'];
    expect(client).toContain("import { Loader } from '@googlemaps/js-api-loader'");
    expect(client).toContain('export async function createMap(container: HTMLElement');
    expect(client).toContain('export async function addMarker(');
    expect(client).toContain("loader.importLibrary('maps')");
    expect(client).toContain('VITE_GOOGLE_MAPS_KEY'); // public browser key
  });

  it('declares the public env key + loader dependency + honest instructions + blank .env.example', () => {
    expect(c.envKeys).toEqual(['VITE_GOOGLE_MAPS_KEY']);
    expect(c.dependencies).toEqual([{ name: '@googlemaps/js-api-loader', version: '^1' }]);
    expect(c.files['.env.example']).toBe('VITE_GOOGLE_MAPS_KEY=\n');
    expect(c.instructions).toContain('never stores');
    expect(c.instructions).toContain('referrer'); // the real protection for a public key
  });
});

describe('generateMapIntegration — Mapbox', () => {
  const c = generateMapIntegration('mapbox');

  it('emits a Mapbox GL helper that imports the required CSS and uses [lng, lat] order', () => {
    const client = c.files['src/lib/map.ts'];
    expect(client).toContain("import mapboxgl from 'mapbox-gl'");
    expect(client).toContain("import 'mapbox-gl/dist/mapbox-gl.css'"); // map is broken without it
    expect(client).toContain('mapboxgl.accessToken =');
    expect(client).toContain('[options.center.lng, options.center.lat]'); // Mapbox is [lng, lat], not [lat, lng]
    expect(client).toContain('export function createMap(container: HTMLElement');
    expect(client).toContain('export function addMarker(');
  });

  it('declares the public token + mapbox-gl dependency + blank .env.example', () => {
    expect(c.envKeys).toEqual(['VITE_MAPBOX_TOKEN']);
    expect(c.dependencies).toEqual([{ name: 'mapbox-gl', version: '^3' }]);
    expect(c.files['.env.example']).toBe('VITE_MAPBOX_TOKEN=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['googlemaps', 'mapbox'] as const) {
      const env = generateMapIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isMapProvider accepts the two supported providers, rejects everything else', () => {
    expect(isMapProvider('googlemaps')).toBe(true);
    expect(isMapProvider('mapbox')).toBe(true);
    expect(isMapProvider('leaflet')).toBe(false);
    expect(isMapProvider(undefined)).toBe(false);
  });
});
