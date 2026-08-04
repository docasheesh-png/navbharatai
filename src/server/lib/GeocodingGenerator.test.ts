import { describe, it, expect } from 'vitest';
import { generateGeocodingIntegration, isGeocodingProvider } from './GeocodingGenerator';

describe('generateGeocodingIntegration — Google', () => {
  const c = generateGeocodingIntegration('google');

  it('emits a server-only geocode + reverseGeocode via the Geocoding API', () => {
    const server = c.files['server/lib/geocoding.ts'];
    expect(server).toContain('export async function geocode(address: string)');
    expect(server).toContain('export async function reverseGeocode(lat: number, lng: number)');
    expect(server).toContain('maps.googleapis.com/maps/api/geocode/json?address=');
    expect(server).toContain('latlng='); // reverse
    expect(server).toContain('GOOGLE_GEOCODING_API_KEY');
    expect(c.files['src/lib/geocoding.ts']).toBeUndefined(); // key is server-side, no client file
  });

  it('needs no npm dependency (REST via fetch), declares the key + blank .env.example', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['GOOGLE_GEOCODING_API_KEY']);
    expect(c.files['.env.example']).toBe('GOOGLE_GEOCODING_API_KEY=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generateGeocodingIntegration — Mapbox', () => {
  const c = generateGeocodingIntegration('mapbox');

  it('emits geocode/reverseGeocode and correctly handles the [lng, lat] order', () => {
    const server = c.files['server/lib/geocoding.ts'];
    expect(server).toContain('api.mapbox.com/geocoding/v5/mapbox.places/');
    expect(server).toContain('{ lat: center[1], lng: center[0] }'); // [lng, lat] → {lat, lng}
    expect(server).toContain("data?.features?.[0]?.place_name"); // reverse
    expect(server).toContain('MAPBOX_GEOCODING_TOKEN');
    expect(c.envKeys).toEqual(['MAPBOX_GEOCODING_TOKEN']);
    expect(c.dependency).toBeUndefined();
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['google', 'mapbox'] as const) {
      const env = generateGeocodingIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isGeocodingProvider accepts the two supported providers, rejects everything else', () => {
    expect(isGeocodingProvider('google')).toBe(true);
    expect(isGeocodingProvider('mapbox')).toBe(true);
    expect(isGeocodingProvider('here')).toBe(false);
    expect(isGeocodingProvider(undefined)).toBe(false);
  });
});
