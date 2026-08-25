import { describe, it, expect } from 'vitest';
import { extractPlace, detectCurrency, detectPincode, liveDataContext } from './liveDataSources';

const NOW = new Date('2026-08-25T10:00:00Z');

/** A fetch stub routed by URL substring — each live source calls a fixed host, so routing is exact. */
const routedFetch = (routes: Record<string, unknown>): typeof fetch =>
  (async (url: string) => {
    for (const [needle, body] of Object.entries(routes)) {
      if (String(url).includes(needle)) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

const GEO = { results: [{ name: 'Kanpur', admin1: 'Uttar Pradesh', country: 'India', latitude: 26.46, longitude: 80.32 }] };

describe('extractPlace — the WHERE of a weather/AQI question', () => {
  it('finds the place in Hinglish and English shapes', () => {
    expect(extractPlace('kanpur me barish hogi kya')).toBe('kanpur');
    expect(extractPlace('delhi ka mausam kaisa hai')).toBe('delhi');
    expect(extractPlace('weather in Mumbai today')).toBe('Mumbai');
    expect(extractPlace('Lucknow weather')).toBe('Lucknow');
  });

  it("returns '' when no place is named — the model must ASK, never guess", () => {
    expect(extractPlace('aaj barish hogi kya')).toBe('');
    expect(extractPlace('mausam kaisa hai')).toBe('');
    expect(extractPlace('kal weather kaisa rahega')).toBe('');
  });
});

describe('detectCurrency / detectPincode — pure shapes', () => {
  it('currency needs BOTH a currency word and a rate word', () => {
    expect(detectCurrency('dollar ka rate kitna hai')).toBe('USD');
    expect(detectCurrency('euro me kitne rupaye hai')).toBe('EUR');
    expect(detectCurrency('the dollar is strong these days')).toBe('');
    expect(detectCurrency('petrol ka rate kya hai')).toBe('');
  });

  it('PIN code needs the words and six digits starting 1-9', () => {
    expect(detectPincode('208001 kaha ka pin code hai')).toBe('208001');
    expect(detectPincode('pin code 110001 kiska hai')).toBe('110001');
    expect(detectPincode('mera pin code bhool gaya')).toBe('');
    expect(detectPincode('208001 kaha hai')).toBe('');
  });
});

describe('liveDataContext — weather', () => {
  it('answers a placed weather question with real forecast numbers', async () => {
    const out = await liveDataContext('kanpur me barish hogi kya', {
      now: NOW,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({
        'geocoding-api': GEO,
        'api.open-meteo.com/v1/forecast': {
          current: { temperature_2m: 31.4, relative_humidity_2m: 78, precipitation: 0.2, wind_speed_10m: 12 },
          daily: { temperature_2m_max: [33, 32], temperature_2m_min: [26, 25], precipitation_probability_max: [80, 40] },
        },
      }),
    });
    expect(out).toContain('LIVE WEATHER DATA');
    expect(out).toContain('Kanpur, Uttar Pradesh, India');
    expect(out).toContain('31.4°C');
    expect(out).toContain('rain chance 80%');
    expect(out).toContain('mausam.imd.gov.in');
    // White-Label: the data supplier is never named in the model-facing block.
    expect(out).not.toMatch(/open-meteo/i);
  });

  it("no place named ⇒ '' with NO network — the directive makes the model ask the city", async () => {
    let called = false;
    const out = await liveDataContext('aaj barish hogi kya', {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch,
    });
    expect(out).toBe('');
    expect(called).toBe(false);
  });

  it("an unknown place or a dead forecast API ⇒ '' — search answers instead", async () => {
    expect(await liveDataContext('xyzzyplace me barish hogi kya', {
      env: {} as NodeJS.ProcessEnv, fetchImpl: routedFetch({ 'geocoding-api': { results: [] } }),
    })).toBe('');
    expect(await liveDataContext('kanpur me barish hogi kya', {
      env: {} as NodeJS.ProcessEnv, fetchImpl: routedFetch({ 'geocoding-api': GEO }),
    })).toBe('');
  });
});

describe('liveDataContext — air quality', () => {
  it('answers a placed AQI question from real current readings', async () => {
    const out = await liveDataContext('delhi ki air quality kaisi hai aaj', {
      now: NOW,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({
        'geocoding-api': { results: [{ name: 'Delhi', country: 'India', latitude: 28.6, longitude: 77.2 }] },
        'air-quality-api': { current: { pm2_5: 142.5, pm10: 210, us_aqi: 196 } },
      }),
    });
    expect(out).toContain('LIVE AIR QUALITY DATA');
    expect(out).toContain('196');
    expect(out).toContain('PM2.5: 142.5');
  });
});

describe('liveDataContext — currency', () => {
  it('answers "dollar ka rate" with the real INR rate', async () => {
    const out = await liveDataContext('dollar ka rate kitna hai', {
      now: NOW,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({ 'open.er-api.com/v6/latest/USD': { rates: { INR: 88.1234 }, time_last_update_utc: 'Mon, 25 Aug 2026 00:00:01 +0000' } }),
    });
    expect(out).toContain('LIVE CURRENCY DATA');
    expect(out).toContain('1 USD = ₹88.12 INR');
    expect(out).toContain('buy/sell');
  });

  it("a rate the API cannot give ⇒ '' — never an invented number", async () => {
    const out = await liveDataContext('dollar ka rate kitna hai', {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({ 'open.er-api.com': { rates: {} } }),
    });
    expect(out).toBe('');
  });
});

describe('liveDataContext — PIN code', () => {
  it('answers a PIN question from the postal data', async () => {
    const out = await liveDataContext('208001 kaha ka pin code hai', {
      now: NOW,
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({
        'api.postalpincode.in/pincode/208001': [{ Status: 'Success', PostOffice: [
          { Name: 'Kanpur H.O', District: 'Kanpur Nagar', State: 'Uttar Pradesh' },
          { Name: 'Collectorganj', District: 'Kanpur Nagar', State: 'Uttar Pradesh' },
        ] }],
      }),
    });
    expect(out).toContain('PIN CODE DATA');
    expect(out).toContain('Kanpur Nagar district, Uttar Pradesh');
    expect(out).toContain('Kanpur H.O');
  });
});

describe('liveDataContext — movies (env-gated: TMDB_API_KEY)', () => {
  const TMDB = { results: [{ title: 'Sample Film', release_date: '2026-08-15' }, { title: 'Second Film', release_date: '2026-08-22' }] };

  it('lists now-playing films when the key is set', async () => {
    const out = await liveDataContext('kaun si movie lagi hai abhi', {
      now: NOW,
      env: { TMDB_API_KEY: 'K' } as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({ 'api.themoviedb.org/3/movie/now_playing': TMDB }),
    });
    expect(out).toContain('MOVIES NOW PLAYING IN INDIA');
    expect(out).toContain('1. Sample Film (released 2026-08-15)');
    expect(out).toContain('local booking app');
    expect(out).not.toMatch(/tmdb|themoviedb/i);
  });

  it("no key ⇒ '' with NO network — web search answers, a listing is never invented", async () => {
    let called = false;
    const out = await liveDataContext('kaun si movie lagi hai abhi', {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch,
    });
    expect(out).toBe('');
    expect(called).toBe(false);
  });
});

describe('liveDataContext — dispatch order and the honest empty', () => {
  it('a train question goes to the transit feed, not weather (most specific shape first)', async () => {
    const out = await liveDataContext('train 12301 kaha hai', {
      now: NOW,
      env: { RAPIDAPI_KEY: 'K' } as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({ 'irctc1.p.rapidapi.com': { position: 'Departed Etawah' } }),
    });
    expect(out).toContain('LIVE TRANSIT DATA');
  });

  it("a message no live source matches ⇒ '' (the web search path answers)", async () => {
    expect(await liveDataContext('petrol ka rate kya hai', {
      env: {} as NodeJS.ProcessEnv,
      fetchImpl: routedFetch({}),
    })).toBe('');
  });
});
