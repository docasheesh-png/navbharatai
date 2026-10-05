/**
 * Q-127: the live-data dispatcher returned at the FIRST source that answered, and because a live answer skips
 * the web search, the rest of a two-part question was dropped — "kanpur me barish hogi kya, aur dollar ka
 * rate kitna hai" got the weather and nothing about the rupee. Every matching source now answers, in a
 * fixed order, side by side.
 */
import { describe, it, expect } from 'vitest';
import { liveDataContext } from '../src/server/lib/liveDataSources';

const NOW = new Date('2026-08-25T10:00:00Z');
const routedFetch = (routes: Record<string, unknown>, hits: string[] = []): typeof fetch =>
  (async (url: string) => {
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) { hits.push(needle); return new Response(JSON.stringify(body), { status: 200 }); }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

const ROUTES = {
  'geocoding-api': { results: [{ name: 'Kanpur', admin1: 'Uttar Pradesh', country: 'India', latitude: 26.46, longitude: 80.32 }] },
  'api.open-meteo.com/v1/forecast': {
    current: { temperature_2m: 31.4, relative_humidity_2m: 78, precipitation: 0.2, wind_speed_10m: 12 },
    daily: { temperature_2m_max: [33, 32], temperature_2m_min: [26, 25], precipitation_probability_max: [80, 40] },
  },
  'open.er-api.com/v6/latest/USD': { rates: { INR: 88.1234 }, time_last_update_utc: 'Mon, 25 Aug 2026 00:00:01 +0000' },
};
const WEATHER_ON = { LIVE_WEATHER_SOURCE: 'on' } as unknown as NodeJS.ProcessEnv;

describe('a two-part question gets both answers', () => {
  it('weather and currency, in one message', async () => {
    const out = await liveDataContext('kanpur me barish hogi kya, aur dollar ka rate kitna hai', { now: NOW, env: WEATHER_ON, fetchImpl: routedFetch(ROUTES) });
    expect(out).toContain('LIVE WEATHER DATA');
    expect(out).toContain('LIVE CURRENCY DATA');
    expect(out.indexOf('LIVE WEATHER DATA')).toBeLessThan(out.indexOf('LIVE CURRENCY DATA')); // fixed order
  });

  it('a one-part question is unchanged — and a source whose shape does not match fetches nothing', async () => {
    const hits: string[] = [];
    const out = await liveDataContext('dollar ka rate kitna hai', { now: NOW, env: WEATHER_ON, fetchImpl: routedFetch(ROUTES, hits) });
    expect(out).toContain('LIVE CURRENCY DATA');
    expect(out).not.toContain('LIVE WEATHER DATA');
    expect(hits).toEqual(['open.er-api.com/v6/latest/USD']);
  });

  it('one source failing never costs the other its answer', async () => {
    const out = await liveDataContext('kanpur me barish hogi kya, aur dollar ka rate kitna hai', {
      now: NOW, env: WEATHER_ON, fetchImpl: routedFetch({ 'open.er-api.com/v6/latest/USD': ROUTES['open.er-api.com/v6/latest/USD'] }),
    });
    expect(out).toContain('LIVE CURRENCY DATA');
    expect(out).not.toContain('LIVE WEATHER DATA');
  });
});
