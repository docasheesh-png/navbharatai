/**
 * INDIA'S OWN AQI, ON A LICENCE THAT COVERS US — and the arithmetic that must not be invented.
 *
 * The licence half of this change is easy to verify (the row moved, the old host is gone; see
 * licenceExposure.test.ts). The half that can go wrong SILENTLY is the number: an AQI computed the
 * wrong way still looks like an AQI, and nobody reading a chat reply can tell. So every rule CPCB
 * publishes is asserted here against records shaped like the real feed:
 *
 *   • the index is the MAXIMUM sub-index, never a mean
 *   • it needs THREE pollutants, one of them particulate — otherwise CPCB publishes nothing, so we must not either
 *   • "NA" is a missing reading, never zero (zero is excellent air)
 *   • a city's figure is a REAL station's, never an average across stations we made up
 *   • no key ⇒ nothing, and above all never a fall back to the source this replaced
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  cpcbApiKey,
  cpcbAqiConfigured,
  cpcbCityQuery,
  subIndexOf,
  stationAqi,
  cityAqi,
  aqiCategory,
  cpcbCityUrl,
  fetchCityAirQuality,
  CPCB_RESOURCE_ID,
} from './cpcbAirQuality';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** A row shaped like the live feed. `avg` is written into BOTH known column names by default. */
function row(station: string, pollutant: string, avg: string | number, extra: Record<string, unknown> = {}) {
  return { city: 'Kanpur', station, pollutant_id: pollutant, avg_value: avg, last_update: '20-09-2026 18:00:00', ...extra };
}

describe('the key', () => {
  it('is trimmed, and whitespace-only reads as UNSET', () => {
    // The BRAVE_API_KEY / ALERT_EMAIL_FROM lesson: a value that is present but unusable must not
    // read as configured, or the console shows a key while every call is refused in silence.
    expect(cpcbApiKey({ DATA_GOV_IN_API_KEY: '  abc  ' } as never)).toBe('abc');
    expect(cpcbApiKey({ DATA_GOV_IN_API_KEY: '   ' } as never)).toBe('');
    expect(cpcbApiKey({} as never)).toBe('');
    expect(cpcbAqiConfigured({ DATA_GOV_IN_API_KEY: 'k' } as never)).toBe(true);
    expect(cpcbAqiConfigured({ DATA_GOV_IN_API_KEY: '\t\n' } as never)).toBe(false);
  });
});

describe('the city we ask for', () => {
  it('title-cases, because the feed stores "Kanpur" and matches exactly', () => {
    expect(cpcbCityQuery('kanpur')).toBe('Kanpur');
    expect(cpcbCityQuery('  NEW DELHI ')).toBe('New Delhi');
    expect(cpcbCityQuery('navi  mumbai')).toBe('Navi Mumbai');
  });

  it('🔒 carries the renames people still type — an exact-match filter turns these into silence', () => {
    expect(cpcbCityQuery('bangalore')).toBe('Bengaluru');
    expect(cpcbCityQuery('Bombay')).toBe('Mumbai');
    expect(cpcbCityQuery('calcutta')).toBe('Kolkata');
    expect(cpcbCityQuery('gurgaon')).toBe('Gurugram');
    expect(cpcbCityQuery('allahabad')).toBe('Prayagraj');
  });

  it('refuses anything that is not a place name, so junk never becomes a request', () => {
    expect(cpcbCityQuery('')).toBe('');
    expect(cpcbCityQuery('   ')).toBe('');
    expect(cpcbCityQuery('Delhi?limit=99999')).toBe('');
    expect(cpcbCityQuery('../../etc/passwd')).toBe('');
    expect(cpcbCityQuery('x'.repeat(41))).toBe('');
  });
});

describe('one reading', () => {
  it('🔒 reads EITHER column name — the resource has published both', () => {
    expect(subIndexOf({ avg_value: '182' })).toBe(182);
    expect(subIndexOf({ pollutant_avg: '182' })).toBe(182);
    expect(subIndexOf({ avg_value: 91, pollutant_avg: '999' })).toBe(91); // the current name wins
  });

  it('🔒 "NA" is MISSING, never 0 — zero is excellent air, not absent air', () => {
    expect(subIndexOf({ avg_value: 'NA' })).toBeNull();
    expect(subIndexOf({ avg_value: 'na' })).toBeNull();
    expect(subIndexOf({ avg_value: '' })).toBeNull();
    expect(subIndexOf({})).toBeNull();
    expect(subIndexOf({ avg_value: null })).toBeNull();
    expect(subIndexOf({ avg_value: 'lots' })).toBeNull();
    expect(subIndexOf({ avg_value: '-5' })).toBeNull();
    // …and a real zero survives.
    expect(subIndexOf({ avg_value: '0' })).toBe(0);
  });
});

describe("one station, by CPCB's own method", () => {
  const full = [
    row('Nehru Nagar, Kanpur - UPPCB', 'PM2.5', '148'),
    row('Nehru Nagar, Kanpur - UPPCB', 'PM10', '211'),
    row('Nehru Nagar, Kanpur - UPPCB', 'NO2', '38'),
    row('Nehru Nagar, Kanpur - UPPCB', 'CO', '52'),
  ];

  it('🔒 is the MAXIMUM sub-index, not a mean — that is the published method', () => {
    const s = stationAqi(full)!;
    expect(s.aqi).toBe(211);          // the max, not (148+211+38+52)/4 = 112
    expect(s.dominant).toBe('PM10');  // the pollutant holding it
    expect(s.pollutants).toBe(4);
  });

  it('🔒 needs THREE pollutants — with two, CPCB publishes nothing and neither do we', () => {
    expect(stationAqi(full.slice(0, 2))).toBeNull();
    expect(stationAqi(full.slice(0, 3))).not.toBeNull();
  });

  it('🔒 needs a PARTICULATE — a gas-only index is a number CPCB never issued', () => {
    const gases = [
      row('S1', 'NO2', '38'), row('S1', 'CO', '52'), row('S1', 'OZONE', '61'), row('S1', 'SO2', '12'),
    ];
    expect(stationAqi(gases)).toBeNull();
    // add one particulate and it qualifies
    expect(stationAqi([...gases, row('S1', 'PM10', '90')])!.aqi).toBe(90);
  });

  it('a pollutant reported as NA does not count toward the three', () => {
    const withNa = [
      row('S1', 'PM2.5', '148'), row('S1', 'PM10', '211'), row('S1', 'NO2', 'NA'),
    ];
    expect(stationAqi(withNa)).toBeNull();
  });

  it('returns null for a row with no station name', () => {
    expect(stationAqi([{ pollutant_id: 'PM10', avg_value: '90' }])).toBeNull();
    expect(stationAqi([])).toBeNull();
  });
});

describe('a city', () => {
  const records = [
    // a qualifying station
    row('Nehru Nagar', 'PM2.5', '148'), row('Nehru Nagar', 'PM10', '180'), row('Nehru Nagar', 'NO2', '38'),
    // a WORSE qualifying station
    row('Kidwai Nagar', 'PM2.5', '260'), row('Kidwai Nagar', 'PM10', '240'), row('Kidwai Nagar', 'CO', '44'),
    // a station that does not qualify — two pollutants
    row('Deputy Padav', 'PM10', '999'), row('Deputy Padav', 'NO2', '20'),
  ];

  it('🔒 reports a REAL station, never an average we invented', () => {
    const c = cityAqi(records)!;
    expect(c.aqi).toBe(260);
    expect(c.station).toBe('Kidwai Nagar');
    expect(c.dominant).toBe('PM2.5');
    expect(c.city).toBe('Kanpur');
  });

  it('🔒 counts only the stations that QUALIFY — the 999 one is excluded, not silently used', () => {
    // Deputy Padav has the highest single number in the feed and must NOT become the city's AQI:
    // with two pollutants CPCB issues no index for it at all.
    const c = cityAqi(records)!;
    expect(c.stationCount).toBe(2);
    expect(c.aqi).not.toBe(999);
  });

  it('returns null when no station qualifies, and when there are no records', () => {
    expect(cityAqi([row('S1', 'PM10', '90'), row('S1', 'NO2', '20')])).toBeNull();
    expect(cityAqi([])).toBeNull();
  });
});

describe("the bands are CPCB's own words", () => {
  it('maps each boundary exactly', () => {
    expect(aqiCategory(50)).toBe('Good');
    expect(aqiCategory(51)).toBe('Satisfactory');
    expect(aqiCategory(100)).toBe('Satisfactory');
    expect(aqiCategory(101)).toBe('Moderate');
    expect(aqiCategory(200)).toBe('Moderate');
    expect(aqiCategory(201)).toBe('Poor');
    expect(aqiCategory(300)).toBe('Poor');
    expect(aqiCategory(301)).toBe('Very Poor');
    expect(aqiCategory(400)).toBe('Very Poor');
    expect(aqiCategory(401)).toBe('Severe');
  });
});

describe('the request', () => {
  it('is the fixed government host and resource, with the city filtered and the key escaped', () => {
    const url = cpcbCityUrl('New Delhi', 'k e y');
    expect(url.startsWith(`https://api.data.gov.in/resource/${CPCB_RESOURCE_ID}?`)).toBe(true);
    // Literal brackets: that is how data.gov.in documents the filter. Percent-encoding them would be
    // a form invented here, against a parser this environment cannot reach to test.
    expect(url).toContain('filters[city]=New%20Delhi');
    expect(url).toContain('api-key=k%20e%20y');
    expect(url).toContain('format=json');
  });
});

describe('fetchCityAirQuality — the one I/O function', () => {
  it('🔒 makes NO request at all without a key', async () => {
    let called = 0;
    const out = await fetchCityAirQuality('Kanpur', async () => { called += 1; return null; }, {} as never);
    expect(out).toBeNull();
    expect(called).toBe(0);
  });

  it('makes no request for an unusable place name', async () => {
    let called = 0;
    const out = await fetchCityAirQuality('', async () => { called += 1; return null; }, { DATA_GOV_IN_API_KEY: 'k' } as never);
    expect(out).toBeNull();
    expect(called).toBe(0);
  });

  it('returns the city figure when the feed answers', async () => {
    const out = await fetchCityAirQuality(
      'kanpur',
      async () => ({ records: [row('S1', 'PM2.5', '148'), row('S1', 'PM10', '211'), row('S1', 'NO2', '38')] }),
      { DATA_GOV_IN_API_KEY: 'k' } as never,
    );
    expect(out!.aqi).toBe(211);
  });

  it('returns null — never throws — on an empty, missing or malformed response', async () => {
    const env = { DATA_GOV_IN_API_KEY: 'k' } as never;
    expect(await fetchCityAirQuality('Kanpur', async () => null, env)).toBeNull();
    expect(await fetchCityAirQuality('Kanpur', async () => ({}), env)).toBeNull();
    expect(await fetchCityAirQuality('Kanpur', async () => ({ records: 'nope' }), env)).toBeNull();
    expect(await fetchCityAirQuality('Kanpur', async () => ({ records: [] }), env)).toBeNull();
  });
});

describe('🔒 the licence half, asserted in the source', () => {
  const src = read('./liveDataSources.ts');

  it('the AQI path no longer touches the non-commercial host', () => {
    expect(src).not.toContain('air-quality-api.open-meteo.com');
  });

  it('🔒 there is NO fallback from CPCB back to the old source', () => {
    // A fallback would silently re-open the exposure this change closes, and nothing on any screen
    // would say so. The AQI block must end at `return ''` when CPCB has no answer.
    const at = src.indexOf('async function aqiBlock');
    const block = src.slice(at, src.indexOf('\n}', at));
    expect(block).toContain('fetchCityAirQuality');
    expect(block).not.toContain('open-meteo');
    expect(block).not.toContain('geocode(');
  });

  it('🔒 attribution is in the block — GODL-India requires it, so it is not decoration', () => {
    const at = src.indexOf('async function aqiBlock');
    const block = src.slice(at, src.indexOf('\n}', at));
    expect(block).toContain('Central Pollution Control Board');
    expect(block).toContain('data.gov.in');
  });
});
