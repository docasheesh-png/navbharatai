import { describe, it, expect } from 'vitest';
import { transformSync } from 'esbuild';
import { STARTER_TEMPLATES, partitionStarters } from '../src/components/agentv3/starterTemplates';
import { GOLDEN_SCAFFOLDS, goldenScaffoldFiles } from '../src/server/AgentV3/goldenScaffolds/registry';

/**
 * The India-first faith and almanac starters (admin 2026-09-12: *"bhagwat geeta in hindi, quran in hindi,
 * brahm_muhrats, ya panchang, kundali jaise apps … aap isko real professional banana"*).
 *
 * 🔴 WHY THIS FILE EVALUATES THE MATHS INSTEAD OF GREPPING FOR IT. The golden-scaffold suite proves every
 * scaffold PARSES and COMPILES. Neither of those can tell a correct sunrise from a plausible one — and a
 * panchang whose times are subtly wrong is the worst possible failure of this feature, because it looks
 * right, nothing errors, and the person reading it is planning something around those minutes. A grep for
 * "Math.acos" would pass just as happily over maths that returned nonsense.
 *
 * So the tests below lift the astronomy straight out of the scaffold string, transpile it, run it, and
 * compare against independently published values for real Indian cities on real dates. That is the only
 * form of this test that could actually fail if the numbers drifted.
 */
const appSourceFor = (id: string): string => {
  const scaffold = GOLDEN_SCAFFOLDS.find((g) => g.id === id);
  expect(scaffold, id + ' has no golden scaffold').toBeTruthy();
  return goldenScaffoldFiles(scaffold!)['src/App.tsx'];
};

/** Transpile and run the pure-TypeScript head of a scaffold, returning the names asked for. */
function evalHead(source: string, endMarker: string, names: string[]): Record<string, any> {
  const head = source.slice(source.indexOf('const DEG = Math.PI / 180;'), source.indexOf(endMarker));
  expect(head.length, 'maths block not found').toBeGreaterThan(500);
  const js = transformSync(head + '\nreturn { ' + names.join(', ') + ' };', { loader: 'ts' }).code;
  // eslint-disable-next-line no-new-func
  return new Function(js)();
}

const IDS = ['panchang', 'geeta', 'quran', 'kundali'] as const;

describe('the four new India-first starters exist end to end', () => {
  it('each is a chip AND a scaffold', () => {
    for (const id of IDS) {
      expect(STARTER_TEMPLATES.map((t) => t.id), id).toContain(id);
      expect(GOLDEN_SCAFFOLDS.map((g) => g.id), id).toContain(id);
    }
  });

  it('the three daily-use ones reach the FREE tier; only the birth chart is pro', () => {
    // A moat a free user never touches is not a moat. The kundali is pro because positional astronomy
    // genuinely needs the paid engine to extend it, not to make it look exclusive.
    const free = partitionStarters(false).tappable.map((t) => t.id);
    for (const id of ['panchang', 'geeta', 'quran']) expect(free, id).toContain(id);
    expect(STARTER_TEMPLATES.find((t) => t.id === 'kundali')!.tier).toBe('pro');
  });
});

describe('the panchang COMPUTES its times — checked against published values, not against itself', () => {
  const api = evalHead(appSourceFor('panchang'), 'function todayISO()', [
    'solarDay', 'sunAt', 'moonLon', 'ayanamsa', 'julianDay0', 'placeOf', 'hhmm', 'CITIES',
  ]);

  // Sunrise and sunset for real places and dates. Tolerance is 3 minutes: the algorithm is good to
  // about one, and published tables round and differ slightly on the refraction constant.
  const CASES: Array<[string, number, number, number, number, number, string, string]> = [
    ['Delhi, summer solstice', 2026, 6, 21, 28.6139, 77.2090, '05:23', '19:21'],
    ['Delhi, winter solstice', 2026, 12, 22, 28.6139, 77.2090, '07:10', '17:29'],
    ['Mumbai, mid-September', 2026, 9, 12, 19.0760, 72.8777, '06:26', '18:44'],
    ['Kolkata, mid-September', 2026, 9, 12, 22.5726, 88.3639, '05:24', '17:44'],
  ];

  const minutesOf = (hhmmStr: string) => {
    const p = hhmmStr.split(':').map((x) => parseInt(x, 10));
    return p[0] * 60 + p[1];
  };

  for (const [label, y, m, d, lat, lon, sunrise, sunset] of CASES) {
    it(label + ': sunrise and sunset land within 3 minutes of published', () => {
      const r = api.solarDay(y, m, d, lat, lon);
      expect(Math.abs(r.sunrise - minutesOf(sunrise)), 'sunrise was ' + api.hhmm(r.sunrise)).toBeLessThanOrEqual(3);
      expect(Math.abs(r.sunset - minutesOf(sunset)), 'sunset was ' + api.hhmm(r.sunset)).toBeLessThanOrEqual(3);
      expect(r.noon).toBeGreaterThan(r.sunrise);
      expect(r.noon).toBeLessThan(r.sunset);
    });
  }

  it('solar noon sits exactly midway between sunrise and sunset', () => {
    // Not a restatement of the formula: it is the one relationship that must hold whatever the date,
    // and it breaks immediately if the hour angle or the equation of time gets a sign wrong.
    for (const [, y, m, d, lat, lon] of CASES) {
      const r = api.solarDay(y, m, d, lat, lon);
      expect(Math.abs((r.sunrise + r.sunset) / 2 - r.noon)).toBeLessThan(0.0001);
    }
  });

  it('the longest day of the year really is around the solstice, for every city it ships', () => {
    for (const c of api.CITIES) {
      const june = api.solarDay(2026, 6, 21, c.lat, c.lon);
      const dec = api.solarDay(2026, 12, 22, c.lat, c.lon);
      expect(june.sunset - june.sunrise, c.name).toBeGreaterThan(dec.sunset - dec.sunrise);
    }
  });

  it('the Lahiri ayanamsa matches the published value for 2026', () => {
    // About 24 degrees 14 minutes. A wrong ayanamsa shifts every rashi and nakshatra in the app.
    const a = api.ayanamsa(api.julianDay0(2026, 9, 12));
    expect(a).toBeGreaterThan(24.18);
    expect(a).toBeLessThan(24.28);
  });

  it('the sun is where it should be at the equinoxes and solstices', () => {
    // Tropical longitude 0 / 90 / 180 / 270 at the four stations. The samples are taken at 12:00 UT and
    // the real moments are hours away, so a degree and a half of slack is the sun's own daily motion —
    // and `apart` wraps properly, because the spring equinox sits just BELOW 360, not just above 0.
    const at = (m: number, d: number) => api.sunAt(api.julianDay0(2026, m, d) + 0.5).lon;
    const apart = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    expect(apart(at(3, 20), 0)).toBeLessThan(1.5);
    expect(apart(at(6, 21), 90)).toBeLessThan(1.5);
    expect(apart(at(9, 23), 180)).toBeLessThan(1.5);
    expect(apart(at(12, 22), 270)).toBeLessThan(1.5);
  });

  it('the moon moves about 13 degrees a day and completes a circuit in about 27.3 days', () => {
    const jd = api.julianDay0(2026, 9, 12);
    const step = ((api.moonLon(jd + 1) - api.moonLon(jd)) + 360) % 360;
    expect(step).toBeGreaterThan(11);
    expect(step).toBeLessThan(15.5);
    expect(Math.abs(((api.moonLon(jd + 27.321582) - api.moonLon(jd)) + 540) % 360 - 180)).toBeLessThan(3);
  });

  it('placeOf splits a longitude into the right rashi, nakshatra and pada', () => {
    expect(api.placeOf(0).rashiIndex).toBe(0);
    expect(api.placeOf(0).pada).toBe(1);
    expect(api.placeOf(29.999).rashiIndex).toBe(0);
    expect(api.placeOf(30).rashiIndex).toBe(1);
    expect(api.placeOf(359.99).rashiIndex).toBe(11);
    // 27 nakshatras of 13 deg 20 min, four padas of 3 deg 20 min each.
    expect(api.placeOf(13.3).nakshatra).toBe(api.placeOf(0).nakshatra);
    expect(api.placeOf(13.4).nakshatra).not.toBe(api.placeOf(0).nakshatra);
    expect(api.placeOf(3.4).pada).toBe(2);
    expect(api.placeOf(10.1).pada).toBe(4);
    // A negative longitude (tropical minus ayanamsa near Aries) must wrap, not fall off the array.
    expect(api.placeOf(-10).rashiIndex).toBe(11);
    expect(api.placeOf(-10).nakshatra).toBeTruthy();
  });

  it('a polar latitude where the sun does not set is REPORTED, never faked', () => {
    const r = api.solarDay(2026, 6, 21, 80, 20);
    expect(r.sunrise).toBeNull();
    expect(r.sunset).toBeNull();
  });

  it('hhmm never renders a negative or out-of-range clock time', () => {
    // Brahma Muhurat is sunrise minus 96 minutes, which goes negative for an early-rising city.
    expect(api.hhmm(-30)).toMatch(/^\d\d:\d\d$/);
    expect(api.hhmm(-30)).toBe('23:30');
    expect(api.hhmm(1500)).toBe('01:00');
    expect(api.hhmm(null)).toBe('—');
  });
});

describe('the panchang derives every muhurat rather than storing one', () => {
  const src = appSourceFor('panchang');

  it('Brahma Muhurat is taken from sunrise, not from a table', () => {
    expect(src).toContain('sd.sunrise - 96');
    expect(src).toContain('sd.sunrise - 48');
  });

  it('Abhijit is the eighth of fifteen muhurtas of the day', () => {
    expect(src).toContain('dayLen / 15');
    expect(src).toContain('sd.sunrise + 7 * muhurta');
  });

  it('Rahu Kaal, Gulika and Yamaganda come from the weekday tables over eighths of the day', () => {
    for (const t of ['RAHU_PART', 'GULIKA_PART', 'YAMA_PART']) expect(src, t).toContain(t);
    expect(src).toContain('dayLen / 8');
  });

  it('the choghadiya cycle rotates by weekday and every slot is graded', () => {
    expect(src).toContain('CHOGHADIYA_START[weekday]');
    expect(src).toContain('QUALITY[name]');
  });

  it('🔒 it states its own accuracy, and that nothing was pre-filled', () => {
    expect(src).toContain('कोई समय पहले से भरा हुआ नहीं है');
    expect(src).toContain('लगभग 1 मिनट तक सही');
    // And says what it does NOT carry, rather than quietly omitting it.
    expect(src).toContain('रात्रि चौघड़िया जानबूझकर शामिल नहीं है');
  });
});

describe('the kundali is honest about the grahas it cannot place', () => {
  const src = appSourceFor('kundali');
  const api = evalHead(src, 'const SHORT:', ['localSiderealDeg', 'ascendantDeg', 'chartFor', 'julianDay0', 'sunAt']);

  it('the local sidereal time matches the textbook value at the J2000 epoch', () => {
    // 1 Jan 2000, 0h UT at Greenwich: 6h 39m 52.3s of sidereal time = 99.9677 degrees.
    expect(Math.abs(api.localSiderealDeg(2451544.5, 0) - 99.9677)).toBeLessThan(0.01);
  });

  it('the ascendant formula is right in the two cases that can be reasoned out by hand', () => {
    // On the equator with zero obliquity the eastern horizon is 90 degrees of right ascension east of
    // whatever is on the meridian — so the answer must be the sidereal time plus ninety, exactly.
    expect(api.ascendantDeg(0, 0, 0)).toBeCloseTo(90, 6);
    expect(api.ascendantDeg(90, 0, 0)).toBeCloseTo(180, 6);
    expect(api.ascendantDeg(180, 0, 0)).toBeCloseTo(270, 6);
  });

  it('the ascendant advances through all twelve rashis over one day', () => {
    // The real property of a Lagna: it cannot stall or jump, it sweeps the whole zodiac every 24 hours.
    const seen = new Set<number>();
    for (let h = 0; h < 24; h += 1) {
      const c = api.chartFor({ name: 'x', dob: '2000-06-15', tob: String(h).padStart(2, '0') + ':00', lat: 28.6139, lon: 77.2090 });
      expect(c, 'hour ' + h).toBeTruthy();
      seen.add(c.lagna.rashiIndex);
    }
    expect(seen.size).toBe(12);
  });

  it('house one IS the Lagna rashi, and the twelve houses are the twelve rashis exactly once', () => {
    const c = api.chartFor({ name: 'x', dob: '1995-03-14', tob: '09:20', lat: 19.0760, lon: 72.8777 });
    expect(c.houses[0].rashiIndex).toBe(c.lagna.rashiIndex);
    expect(new Set(c.houses.map((h: any) => h.rashiIndex)).size).toBe(12);
    expect(c.houses.map((h: any) => h.house)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('Ketu is always exactly opposite Rahu — six rashis apart, every time', () => {
    const c = api.chartFor({ name: 'x', dob: '2010-11-02', tob: '14:45', lat: 13.0827, lon: 80.2707 });
    const rahu = c.grahas.find((g: any) => g.key === 'rahu').place;
    const ketu = c.grahas.find((g: any) => g.key === 'ketu').place;
    expect(Math.abs(((ketu.lon - rahu.lon) + 360) % 360 - 180)).toBeLessThan(0.0001);
  });

  it('a malformed birth record returns null rather than a chart full of NaN', () => {
    expect(api.chartFor({ name: 'x', dob: '', tob: '', lat: 0, lon: 0 })).toBeNull();
    expect(api.chartFor({ name: 'x', dob: 'not-a-date', tob: '10:00', lat: 0, lon: 0 })).toBeNull();
  });

  it('🔒 it places ONLY what it computes, and says so on the same screen as the table', () => {
    // The forbidden version of this app silently invents Mars through Saturn. The honesty note and the
    // absence of those grahas must stay together: either alone is a bug.
    expect(src).toContain('ग्रह-पंचांग (planetary ephemeris)');
    expect(src).toContain('अनुमान से नहीं दिखाया जाता');
    const keys = ["key: 'sun'", "key: 'moon'", "key: 'rahu'", "key: 'ketu'"];
    for (const k of keys) expect(src, k).toContain(k);
    for (const k of ["key: 'mars'", "key: 'mercury'", "key: 'jupiter'", "key: 'venus'", "key: 'saturn'"]) {
      expect(src, k + ' must not be placed without an ephemeris').not.toContain(k);
    }
  });
});

describe('the astronomy is the SAME in both apps', () => {
  it('byte-identical, so a correction to one can never silently miss the other', () => {
    // They are separate generated apps (a scaffold must be self-contained), which is exactly why drift
    // between them would be invisible. This is the assertion that makes the duplication safe.
    const cut = (s: string) => s.slice(s.indexOf('const DEG = Math.PI / 180;'), s.indexOf('const CITIES: Array<'));
    expect(cut(appSourceFor('kundali'))).toBe(cut(appSourceFor('panchang')));
  });

  it('and so is the city list', () => {
    const cut = (s: string) => s.slice(s.indexOf('const CITIES: Array<'), s.indexOf('const TZ = 5.5;'));
    expect(cut(appSourceFor('kundali'))).toBe(cut(appSourceFor('panchang')));
  });
});

describe('the scripture readers state what they hold', () => {
  it('the Gita reader counts its own selection against the full 700', () => {
    const src = appSourceFor('geeta');
    expect(src).toContain('{SHLOKAS.length} चुने हुए श्लोक');
    expect(src).toContain('कुल 700 में से');
    // A chapter genuinely absent from the selection must show an empty state, not be hidden.
    expect(src).toContain('इस चयन में नहीं');
    expect(src).toContain('ऐप वही दिखाता है जो उसके पास सच में है');
  });

  it('the Quran reader counts its surahs against all 114, and carries a Hindi transliteration', () => {
    const src = appSourceFor('quran');
    expect(src).toContain('{SURAHS.length} सूरह');
    expect(src).toContain('कुल 114 में से');
    // The transliteration is the point for a Hindi reader who cannot read the Arabic script.
    expect(src).toMatch(/tr: '/);
    expect(src).toContain('dir="rtl"');
  });

  it('both pick their verse of the day from the DATE, so it is the same for everyone all day', () => {
    for (const id of ['geeta', 'quran']) {
      const src = appSourceFor(id);
      expect(src, id).toContain('Date.UTC(');
      expect(src, id).not.toContain('Math.random');
    }
  });

  it('neither claims a published translation it did not write', () => {
    for (const id of ['geeta', 'quran']) {
      expect(appSourceFor(id), id).toMatch(/इसी ऐप के लिए लिख/);
    }
  });
});
