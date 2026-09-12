// AgentV3 — Golden Scaffold apps (India-first, almanac): daily Panchang / Muhurat, and Janam Kundali.
//
// Admin-requested 2026-09-12 ("brahm_muhrats, ya panchang, kundali jaise apps … aap isko real
// professional banana"). Same contract as the other scaffold modules: complete hand-verified App.tsx
// files, CI-proven to parse (esbuild) and compile (in-browser Babel preview), no backticks, no backslash
// escapes, no nested template literals.
//
// 🔒 WHY THESE TWO COMPUTE INSTEAD OF LOOKING UP, and why that was the only honest option. The easy
// version of a panchang app is a table of times somebody typed in for one city and one year. It looks
// identical to a real one on the day it ships and is silently wrong every other day — a "working" screen
// printing invented numbers, which the second absolute rule forbids outright and which a user planning a
// ceremony would actually be harmed by.
//
// So the sunrise, sunset and solar noon come from the standard NOAA solar-position algorithm for the
// chosen latitude and longitude (good to about a minute), every muhurat and kaal is DERIVED from those by
// its documented traditional rule, and the tithi and nakshatra come from the sun and moon longitudes.
// The moon uses the classical abbreviated lunar series, accurate to roughly a fifth of a degree — so the
// app SAYS that, rather than presenting a tithi boundary as exact.
//
// And the kundali stops where honesty requires: the ascendant and the bhava are exact spherical
// trigonometry needing no ephemeris, and the Sun, Moon, Rahu and Ketu are genuinely computed — while
// Mangal through Shani need a planetary ephemeris this offline app does not carry, which the app states
// plainly instead of placing a graha it had to guess.
//
// ⚠️ THE SHARED ASTRONOMY IS DUPLICATED INTO BOTH APPS ON PURPOSE, which is the one place this module
// breaks the repo's own de-duplication instinct. A golden scaffold must be a SELF-CONTAINED App.tsx (the
// registry ships exactly one file per simple scaffold), so a shared module here would have to become a
// file in the generated app — and then the builder, asked to change one app, could edit a file the other
// depends on. The duplication is between two generated apps that never meet, not inside our codebase.

export const panchangAppTsx = `import { useMemo, useState } from 'react';
import ThemeToggle from './theme';

const DEG = Math.PI / 180;
const norm360 = (x: number) => ((x % 360) + 360) % 360;

/** Julian Day at 0h UT of a civil calendar date (Gregorian). */
function julianDay0(y: number, m: number, d: number): number {
  let yy = y;
  let mm = m;
  if (mm <= 2) { yy -= 1; mm += 12; }
  const a = Math.floor(yy / 100);
  const b = Math.floor(a / 4);
  const c = 2 - a + b;
  const e = Math.floor(365.25 * (yy + 4716));
  const f = Math.floor(30.6001 * (mm + 1));
  return c + d + e + f - 1524.5;
}

/** Apparent geocentric position of the sun, plus the equation of time. NOAA solar-position algorithm. */
function sunAt(jd: number) {
  const t = (jd - 2451545) / 36525;
  const l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = norm360(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const ctr = Math.sin(m * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * DEG) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * DEG) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const appLon = l0 + ctr - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const mean = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = mean + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(obliq * DEG) * Math.sin(appLon * DEG)) / DEG;
  const tanHalf = Math.tan((obliq / 2) * DEG);
  const vy = tanHalf * tanHalf;
  const eqTime = 4 * (vy * Math.sin(2 * l0 * DEG) - 2 * ecc * Math.sin(m * DEG)
    + 4 * ecc * vy * Math.sin(m * DEG) * Math.cos(2 * l0 * DEG)
    - 0.5 * vy * vy * Math.sin(4 * l0 * DEG) - 1.25 * ecc * ecc * Math.sin(2 * m * DEG)) / DEG;
  return { lon: norm360(appLon), decl: decl, eqTime: eqTime, obliq: obliq };
}

/** Geocentric ecliptic longitude of the moon — the classical abbreviated series (about 0.2 deg). */
function moonLon(jd: number): number {
  const t = (jd - 2451545) / 36525;
  const lp = 218.3164477 + 481267.88123421 * t;
  const d = 297.8501921 + 445267.1114034 * t;
  const m = 357.5291092 + 35999.0502909 * t;
  const mp = 134.9633964 + 477198.8675055 * t;
  const lon = lp
    + 6.289 * Math.sin(mp * DEG)
    - 1.274 * Math.sin((2 * d - mp) * DEG)
    + 0.658 * Math.sin(2 * d * DEG)
    - 0.186 * Math.sin(m * DEG)
    - 0.059 * Math.sin((2 * mp - 2 * d) * DEG)
    - 0.057 * Math.sin((mp - 2 * d + m) * DEG)
    + 0.053 * Math.sin((mp + 2 * d) * DEG)
    + 0.046 * Math.sin((2 * d - m) * DEG)
    - 0.041 * Math.sin((mp - m) * DEG)
    - 0.035 * Math.sin(d * DEG)
    - 0.031 * Math.sin((mp + m) * DEG);
  return norm360(lon);
}

/** Mean longitude of the ascending lunar node (Rahu). Exact enough to be quoted as given. */
function rahuLon(jd: number): number {
  const t = (jd - 2451545) / 36525;
  return norm360(125.0445479 - 1934.1362891 * t + 0.0020754 * t * t);
}

/** Lahiri ayanamsa: 23 deg 51 min 11 sec at J2000, precessing about 50.29 arc-seconds a year. */
function ayanamsa(jd: number): number {
  return 23.853056 + 0.0139694 * ((jd - 2451545) / 365.2425);
}

const RASHI = [
  'मेष', 'वृषभ', 'मिथुन', 'कर्क', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुंभ', 'मीन',
];
const NAKSHATRA = [
  'अश्विनी', 'भरणी', 'कृत्तिका', 'रोहिणी', 'मृगशिरा', 'आर्द्रा', 'पुनर्वसु', 'पुष्य', 'आश्लेषा',
  'मघा', 'पूर्वा फाल्गुनी', 'उत्तरा फाल्गुनी', 'हस्त', 'चित्रा', 'स्वाती', 'विशाखा', 'अनुराधा', 'ज्येष्ठा',
  'मूल', 'पूर्वाषाढ़ा', 'उत्तराषाढ़ा', 'श्रवण', 'धनिष्ठा', 'शतभिषा', 'पूर्वा भाद्रपदा', 'उत्तरा भाद्रपदा', 'रेवती',
];

/** Where a sidereal longitude falls: rashi, degree in rashi, nakshatra and pada. Pure. */
function placeOf(siderealLon: number) {
  const lon = norm360(siderealLon);
  const nakIndex = Math.floor(lon / (360 / 27));
  const inNak = lon - nakIndex * (360 / 27);
  return {
    lon: lon,
    rashiIndex: Math.floor(lon / 30),
    rashi: RASHI[Math.floor(lon / 30)],
    degInRashi: lon - Math.floor(lon / 30) * 30,
    nakshatra: NAKSHATRA[nakIndex],
    pada: Math.floor(inNak / (360 / 108)) + 1,
  };
}

const CITIES: Array<{ name: string; lat: number; lon: number }> = [
  { name: 'दिल्ली (Delhi)', lat: 28.6139, lon: 77.2090 },
  { name: 'मुंबई (Mumbai)', lat: 19.0760, lon: 72.8777 },
  { name: 'कोलकाता (Kolkata)', lat: 22.5726, lon: 88.3639 },
  { name: 'चेन्नई (Chennai)', lat: 13.0827, lon: 80.2707 },
  { name: 'बेंगलुरु (Bengaluru)', lat: 12.9716, lon: 77.5946 },
  { name: 'हैदराबाद (Hyderabad)', lat: 17.3850, lon: 78.4867 },
  { name: 'अहमदाबाद (Ahmedabad)', lat: 23.0225, lon: 72.5714 },
  { name: 'पुणे (Pune)', lat: 18.5204, lon: 73.8567 },
  { name: 'जयपुर (Jaipur)', lat: 26.9124, lon: 75.7873 },
  { name: 'लखनऊ (Lucknow)', lat: 26.8467, lon: 80.9462 },
  { name: 'वाराणसी (Varanasi)', lat: 25.3176, lon: 82.9739 },
  { name: 'पटना (Patna)', lat: 25.5941, lon: 85.1376 },
  { name: 'भोपाल (Bhopal)', lat: 23.2599, lon: 77.4126 },
  { name: 'चंडीगढ़ (Chandigarh)', lat: 30.7333, lon: 76.7794 },
  { name: 'गुवाहाटी (Guwahati)', lat: 26.1445, lon: 91.7362 },
  { name: 'कोच्चि (Kochi)', lat: 9.9312, lon: 76.2673 },
];
// Every city above is in India, so one offset covers them all. Kept as a named constant rather than a
// literal 5.5 scattered through the maths, because it is the one number a non-India build must change.
const TZ = 5.5;

const TITHI = [
  'प्रतिपदा', 'द्वितीया', 'तृतीया', 'चतुर्थी', 'पंचमी', 'षष्ठी', 'सप्तमी', 'अष्टमी',
  'नवमी', 'दशमी', 'एकादशी', 'द्वादशी', 'त्रयोदशी', 'चतुर्दशी',
];
const WEEKDAYS = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];

// The traditional tables. Each value is WHICH eighth of the daytime that kaal occupies, counting from
// sunrise, indexed by weekday (0 = Sunday). Deterministic rules, not opinions — which is why they can
// be computed rather than looked up.
const RAHU_PART = [8, 2, 7, 5, 6, 4, 3];
const GULIKA_PART = [7, 6, 5, 4, 3, 2, 1];
const YAMA_PART = [5, 4, 3, 2, 1, 7, 6];

const CHOGHADIYA = ['उद्वेग', 'चर', 'लाभ', 'अमृत', 'काल', 'शुभ', 'रोग'];
// Which entry of the cycle the daytime choghadiya starts on, by weekday.
const CHOGHADIYA_START = [0, 3, 6, 2, 5, 1, 4];
const QUALITY: Record<string, string> = {
  'अमृत': 'शुभ', 'शुभ': 'शुभ', 'लाभ': 'शुभ', 'चर': 'मध्यम', 'उद्वेग': 'अशुभ', 'काल': 'अशुभ', 'रोग': 'अशुभ',
};

/** Minutes after local midnight as HH:MM, wrapping safely across a day boundary. */
function hhmm(minutes: number | null): string {
  if (minutes === null || !isFinite(minutes)) return '—';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return String(h).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

/** A minute span as "7 घं 12 मि". Rounds the WHOLE span first — rounding the remainder on its own can
 *  print "60 मि", which is the kind of detail a user notices and nothing else would catch. */
function dayLengthText(minutes: number): string {
  const total = Math.round(minutes);
  return Math.floor(total / 60) + ' घं ' + (total % 60) + ' मि';
}

/** Sunrise, sunset and solar noon for a place and date, in minutes after local midnight. */
function solarDay(y: number, mo: number, d: number, lat: number, lon: number) {
  const jd = julianDay0(y, mo, d) + (12 - TZ) / 24;
  const s = sunAt(jd);
  const noon = 720 - 4 * lon - s.eqTime + TZ * 60;
  const cosH = Math.cos(90.833 * DEG) / (Math.cos(lat * DEG) * Math.cos(s.decl * DEG))
    - Math.tan(lat * DEG) * Math.tan(s.decl * DEG);
  if (cosH > 1 || cosH < -1) {
    // A real polar case: the sun does not rise or set at all. Reported, never faked.
    return { jd: jd, sun: s, noon: noon, sunrise: null as number | null, sunset: null as number | null };
  }
  const h = Math.acos(cosH) / DEG;
  return { jd: jd, sun: s, noon: noon, sunrise: noon - 4 * h, sunset: noon + 4 * h };
}

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function App() {
  const [cityIndex, setCityIndex] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('panchang-city-v1'));
      return Number.isInteger(saved) && saved >= 0 && saved < CITIES.length ? saved : 0;
    } catch { return 0; }
  });
  const [manual, setManual] = useState(false);
  const [latText, setLatText] = useState('28.6139');
  const [lonText, setLonText] = useState('77.2090');
  const [dateISO, setDateISO] = useState(todayISO);

  const pickCity = (i: number) => {
    setCityIndex(i);
    try { localStorage.setItem('panchang-city-v1', String(i)); } catch { /* private mode */ }
  };

  const place = manual
    ? { name: 'मेरा स्थान (custom)', lat: parseFloat(latText) || 0, lon: parseFloat(lonText) || 0 }
    : CITIES[cityIndex];

  const data = useMemo(() => {
    const parts = dateISO.split('-').map((x) => parseInt(x, 10));
    const y = parts[0];
    const mo = parts[1];
    const d = parts[2];
    if (!y || !mo || !d) return null;
    const sd = solarDay(y, mo, d, place.lat, place.lon);
    const weekday = new Date(y, mo - 1, d).getDay();

    // Tithi / nakshatra are read at SUNRISE, which is the moment a panchang is stated for.
    const atSunrise = sd.sunrise === null ? sd.jd : julianDay0(y, mo, d) + (sd.sunrise / 60 - TZ) / 24;
    const sLon = sunAt(atSunrise).lon;
    const mLon = moonLon(atSunrise);
    const ayan = ayanamsa(atSunrise);
    const elong = norm360(mLon - sLon);
    const tithiIndex = Math.floor(elong / 12);
    const paksha = tithiIndex < 15 ? 'शुक्ल' : 'कृष्ण';
    const withinPaksha = tithiIndex % 15;
    const tithiName = withinPaksha === 14
      ? (paksha === 'शुक्ल' ? 'पूर्णिमा' : 'अमावस्या')
      : TITHI[withinPaksha];
    const moonPlace = placeOf(mLon - ayan);
    const sunPlace = placeOf(sLon - ayan);

    if (sd.sunrise === null || sd.sunset === null) {
      return { sd: sd, weekday: weekday, noSunEvent: true, tithiName: tithiName, paksha: paksha,
        moonPlace: moonPlace, sunPlace: sunPlace, ayan: ayan, muhurat: [], kaal: [], chogh: [] };
    }

    const dayLen = sd.sunset - sd.sunrise;
    const eighth = dayLen / 8;
    const muhurta = dayLen / 15;

    const muhurat = [
      { label: 'ब्रह्म मुहूर्त (Brahma Muhurat)', from: sd.sunrise - 96, to: sd.sunrise - 48,
        note: 'सूर्योदय से 96 से 48 मिनट पहले' },
      { label: 'अभिजित मुहूर्त (Abhijit)', from: sd.sunrise + 7 * muhurta, to: sd.sunrise + 8 * muhurta,
        note: 'दिन के 15 मुहूर्तों में से 8वाँ' },
    ];

    const part = (n: number) => ({ from: sd.sunrise + (n - 1) * eighth, to: sd.sunrise + n * eighth });
    const kaal = [
      { label: 'राहु काल (Rahu Kaal)', ...part(RAHU_PART[weekday]) },
      { label: 'गुलिक काल (Gulika)', ...part(GULIKA_PART[weekday]) },
      { label: 'यमगण्ड (Yamaganda)', ...part(YAMA_PART[weekday]) },
    ];

    const chogh = [];
    for (let i = 0; i < 8; i += 1) {
      const name = CHOGHADIYA[(CHOGHADIYA_START[weekday] + i) % 7];
      chogh.push({ name: name, quality: QUALITY[name], from: sd.sunrise + i * eighth, to: sd.sunrise + (i + 1) * eighth });
    }

    return { sd: sd, weekday: weekday, noSunEvent: false, tithiName: tithiName, paksha: paksha,
      moonPlace: moonPlace, sunPlace: sunPlace, ayan: ayan, muhurat: muhurat, kaal: kaal, chogh: chogh };
  }, [dateISO, place.lat, place.lon]);

  const Row = (props: { label: string; value: string; note?: string }) => (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <span>
        {props.label}
        {props.note ? <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{props.note}</span> : null}
      </span>
      <strong style={{ whiteSpace: 'nowrap' }}>{props.value}</strong>
    </div>
  );

  return (
    <div className="container" style={{ maxWidth: 580, paddingTop: 24, paddingBottom: 56 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>पंचांग और मुहूर्त</h1>
        <ThemeToggle />
      </div>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--muted)' }}>
        Daily Panchang — आपके शहर के सूर्योदय से गणना किया हुआ
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label htmlFor="city">स्थान (Place)</label>
          {manual ? (
            <div className="row" style={{ gap: 8 }}>
              <input aria-label="अक्षांश latitude" value={latText} onChange={(e) => setLatText(e.target.value)} placeholder="अक्षांश" />
              <input aria-label="देशांतर longitude" value={lonText} onChange={(e) => setLonText(e.target.value)} placeholder="देशांतर" />
            </div>
          ) : (
            <select id="city" value={String(cityIndex)} onChange={(e) => pickCity(Number(e.target.value))}>
              {CITIES.map((c, i) => <option key={c.name} value={String(i)}>{c.name}</option>)}
            </select>
          )}
        </div>
        <button className="btn-ghost" onClick={() => setManual((v) => !v)} style={{ marginTop: 6 }}>
          {manual ? 'शहर की सूची से चुनें' : 'अक्षांश/देशांतर खुद डालें'}
        </button>
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="date">तारीख़ (Date)</label>
          <input id="date" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
        </div>
      </div>

      {!data ? (
        <div className="nb-empty">एक मान्य तारीख़ चुनें।</div>
      ) : (
        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>सूर्य (Sun) — {WEEKDAYS[data.weekday]}</h2>
            {data.noSunEvent ? (
              <div className="alert">इस अक्षांश पर इस दिन सूर्य उदय या अस्त नहीं होता, इसलिए मुहूर्त की गणना नहीं की जा सकती।</div>
            ) : (
              <div>
                <Row label="सूर्योदय (Sunrise)" value={hhmm(data.sd.sunrise)} />
                <Row label="सूर्यास्त (Sunset)" value={hhmm(data.sd.sunset)} />
                <Row label="मध्याह्न (Solar noon)" value={hhmm(data.sd.noon)} />
                <Row label="दिनमान (Day length)" value={dayLengthText(data.sd.sunset - data.sd.sunrise)} />
              </div>
            )}
          </div>

          {!data.noSunEvent && (
            <div>
              <div className="card" style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: 15, marginTop: 0 }}>शुभ मुहूर्त</h2>
                {data.muhurat.map((m) => (
                  <Row key={m.label} label={m.label} note={m.note} value={hhmm(m.from) + " – " + hhmm(m.to)} />
                ))}
              </div>

              <div className="card" style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: 15, marginTop: 0 }}>अशुभ काल (इन्हें टालें)</h2>
                {data.kaal.map((k) => (
                  <Row key={k.label} label={k.label} value={hhmm(k.from) + " – " + hhmm(k.to)} />
                ))}
              </div>

              <div className="card" style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: 15, marginTop: 0 }}>दिन का चौघड़िया</h2>
                <div className="nb-table-wrap">
                  <table className="nb-table">
                    <thead>
                      <tr><th>चौघड़िया</th><th>समय</th><th>स्वरूप</th></tr>
                    </thead>
                    <tbody>
                      {data.chogh.map((c, i) => (
                        <tr key={String(i)}>
                          <td>{c.name}</td>
                          <td>{hhmm(c.from) + " – " + hhmm(c.to)}</td>
                          <td>
                            <span className={c.quality === 'शुभ' ? 'badge badge-success' : c.quality === 'अशुभ' ? 'badge badge-danger' : 'badge badge-warning'}>
                              {c.quality}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '10px 0 0' }}>
                  यह सूर्योदय से सूर्यास्त तक का चौघड़िया है। रात्रि चौघड़िया जानबूझकर शामिल नहीं है।
                </p>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, marginTop: 0 }}>तिथि और नक्षत्र (सूर्योदय पर)</h2>
            <Row label="तिथि (Tithi)" value={data.paksha + " " + data.tithiName} />
            <Row label="नक्षत्र (Nakshatra)" value={data.moonPlace.nakshatra + " — पाद " + data.moonPlace.pada} />
            <Row label="चंद्र राशि (Moon sign)" value={data.moonPlace.rashi} />
            <Row label="सूर्य राशि (Sun sign)" value={data.sunPlace.rashi} />
            <Row label="अयनांश (Ayanamsa)" value={data.ayan.toFixed(3) + "°"} />
          </div>

          {/* 🔒 The accuracy statement, beside the numbers rather than hidden in an About screen. */}
          <div className="alert" style={{ fontSize: 12 }}>
            सूर्योदय, सूर्यास्त और मध्याह्न मानक खगोलीय सूत्रों से गिने गए हैं (लगभग 1 मिनट तक सही), और
            सभी मुहूर्त तथा काल इन्हीं से निकाले गए हैं — कोई समय पहले से भरा हुआ नहीं है। तिथि और नक्षत्र
            सरलीकृत चंद्र गणना पर आधारित हैं, इसलिए तिथि बदलने के आधे घंटे के आसपास प्रकाशित पंचांग से
            अन्तर हो सकता है। शुद्ध धार्मिक निर्णय के लिए स्थानीय पंचांग से मिला लें।
          </div>
        </div>
      )}
    </div>
  );
}

export default App;`;


/**
 * Janam Kundali — a PRO scaffold, i.e. a compile-proven architecture the paid engine extends.
 *
 * 🔒 WHAT IT REFUSES TO DO. Placing all nine grahas needs a planetary ephemeris, and a table of orbital
 * elements transcribed from memory into a scaffold is untestable from here: a single wrong digit would
 * put a planet in the wrong rashi on every chart this app ever draws, with nothing failing to say so.
 * A wrong kundali is worse than an incomplete one to the person reading it. So this app computes only
 * what can be derived from formulae that are verifiable by hand — the Lagna and bhava (pure spherical
 * trigonometry, no ephemeris), the Sun (about 0.01 degrees), the Moon (about 0.2, and it says so) and
 * the lunar nodes — and it states the gap on the same screen as the table.
 */
export const kundaliAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, Button, Field, Select, Modal, Empty, Badge, StatRow, StatTile } from './lib/ui';
import { useCollection, type Entity } from './lib/store';

const DEG = Math.PI / 180;
const norm360 = (x: number) => ((x % 360) + 360) % 360;

/** Julian Day at 0h UT of a civil calendar date (Gregorian). */
function julianDay0(y: number, m: number, d: number): number {
  let yy = y;
  let mm = m;
  if (mm <= 2) { yy -= 1; mm += 12; }
  const a = Math.floor(yy / 100);
  const b = Math.floor(a / 4);
  const c = 2 - a + b;
  const e = Math.floor(365.25 * (yy + 4716));
  const f = Math.floor(30.6001 * (mm + 1));
  return c + d + e + f - 1524.5;
}

/** Apparent geocentric position of the sun, plus the equation of time. NOAA solar-position algorithm. */
function sunAt(jd: number) {
  const t = (jd - 2451545) / 36525;
  const l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = norm360(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const ctr = Math.sin(m * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * DEG) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * DEG) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const appLon = l0 + ctr - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const mean = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = mean + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(obliq * DEG) * Math.sin(appLon * DEG)) / DEG;
  const tanHalf = Math.tan((obliq / 2) * DEG);
  const vy = tanHalf * tanHalf;
  const eqTime = 4 * (vy * Math.sin(2 * l0 * DEG) - 2 * ecc * Math.sin(m * DEG)
    + 4 * ecc * vy * Math.sin(m * DEG) * Math.cos(2 * l0 * DEG)
    - 0.5 * vy * vy * Math.sin(4 * l0 * DEG) - 1.25 * ecc * ecc * Math.sin(2 * m * DEG)) / DEG;
  return { lon: norm360(appLon), decl: decl, eqTime: eqTime, obliq: obliq };
}

/** Geocentric ecliptic longitude of the moon — the classical abbreviated series (about 0.2 deg). */
function moonLon(jd: number): number {
  const t = (jd - 2451545) / 36525;
  const lp = 218.3164477 + 481267.88123421 * t;
  const d = 297.8501921 + 445267.1114034 * t;
  const m = 357.5291092 + 35999.0502909 * t;
  const mp = 134.9633964 + 477198.8675055 * t;
  const lon = lp
    + 6.289 * Math.sin(mp * DEG)
    - 1.274 * Math.sin((2 * d - mp) * DEG)
    + 0.658 * Math.sin(2 * d * DEG)
    - 0.186 * Math.sin(m * DEG)
    - 0.059 * Math.sin((2 * mp - 2 * d) * DEG)
    - 0.057 * Math.sin((mp - 2 * d + m) * DEG)
    + 0.053 * Math.sin((mp + 2 * d) * DEG)
    + 0.046 * Math.sin((2 * d - m) * DEG)
    - 0.041 * Math.sin((mp - m) * DEG)
    - 0.035 * Math.sin(d * DEG)
    - 0.031 * Math.sin((mp + m) * DEG);
  return norm360(lon);
}

/** Mean longitude of the ascending lunar node (Rahu). Exact enough to be quoted as given. */
function rahuLon(jd: number): number {
  const t = (jd - 2451545) / 36525;
  return norm360(125.0445479 - 1934.1362891 * t + 0.0020754 * t * t);
}

/** Lahiri ayanamsa: 23 deg 51 min 11 sec at J2000, precessing about 50.29 arc-seconds a year. */
function ayanamsa(jd: number): number {
  return 23.853056 + 0.0139694 * ((jd - 2451545) / 365.2425);
}

const RASHI = [
  'मेष', 'वृषभ', 'मिथुन', 'कर्क', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुंभ', 'मीन',
];
const NAKSHATRA = [
  'अश्विनी', 'भरणी', 'कृत्तिका', 'रोहिणी', 'मृगशिरा', 'आर्द्रा', 'पुनर्वसु', 'पुष्य', 'आश्लेषा',
  'मघा', 'पूर्वा फाल्गुनी', 'उत्तरा फाल्गुनी', 'हस्त', 'चित्रा', 'स्वाती', 'विशाखा', 'अनुराधा', 'ज्येष्ठा',
  'मूल', 'पूर्वाषाढ़ा', 'उत्तराषाढ़ा', 'श्रवण', 'धनिष्ठा', 'शतभिषा', 'पूर्वा भाद्रपदा', 'उत्तरा भाद्रपदा', 'रेवती',
];

/** Where a sidereal longitude falls: rashi, degree in rashi, nakshatra and pada. Pure. */
function placeOf(siderealLon: number) {
  const lon = norm360(siderealLon);
  const nakIndex = Math.floor(lon / (360 / 27));
  const inNak = lon - nakIndex * (360 / 27);
  return {
    lon: lon,
    rashiIndex: Math.floor(lon / 30),
    rashi: RASHI[Math.floor(lon / 30)],
    degInRashi: lon - Math.floor(lon / 30) * 30,
    nakshatra: NAKSHATRA[nakIndex],
    pada: Math.floor(inNak / (360 / 108)) + 1,
  };
}

const CITIES: Array<{ name: string; lat: number; lon: number }> = [
  { name: 'दिल्ली (Delhi)', lat: 28.6139, lon: 77.2090 },
  { name: 'मुंबई (Mumbai)', lat: 19.0760, lon: 72.8777 },
  { name: 'कोलकाता (Kolkata)', lat: 22.5726, lon: 88.3639 },
  { name: 'चेन्नई (Chennai)', lat: 13.0827, lon: 80.2707 },
  { name: 'बेंगलुरु (Bengaluru)', lat: 12.9716, lon: 77.5946 },
  { name: 'हैदराबाद (Hyderabad)', lat: 17.3850, lon: 78.4867 },
  { name: 'अहमदाबाद (Ahmedabad)', lat: 23.0225, lon: 72.5714 },
  { name: 'पुणे (Pune)', lat: 18.5204, lon: 73.8567 },
  { name: 'जयपुर (Jaipur)', lat: 26.9124, lon: 75.7873 },
  { name: 'लखनऊ (Lucknow)', lat: 26.8467, lon: 80.9462 },
  { name: 'वाराणसी (Varanasi)', lat: 25.3176, lon: 82.9739 },
  { name: 'पटना (Patna)', lat: 25.5941, lon: 85.1376 },
  { name: 'भोपाल (Bhopal)', lat: 23.2599, lon: 77.4126 },
  { name: 'चंडीगढ़ (Chandigarh)', lat: 30.7333, lon: 76.7794 },
  { name: 'गुवाहाटी (Guwahati)', lat: 26.1445, lon: 91.7362 },
  { name: 'कोच्चि (Kochi)', lat: 9.9312, lon: 76.2673 },
];
// Every city above is in India, so one offset covers them all. Kept as a named constant rather than a
// literal 5.5 scattered through the maths, because it is the one number a non-India build must change.
const TZ = 5.5;

const GRAHA_LABEL: Record<string, string> = {
  sun: 'सूर्य (Sun)', moon: 'चंद्र (Moon)', rahu: 'राहु (Rahu)', ketu: 'केतु (Ketu)',
};

interface Birth extends Entity {
  name: string;
  dob: string;
  tob: string;
  cityIndex: number;
  lat: number;
  lon: number;
  place: string;
}

const SEED: Birth[] = [];

/** Greenwich mean sidereal time in degrees, then the local sidereal time for an east longitude. */
function localSiderealDeg(jdUT: number, eastLon: number): number {
  const t = (jdUT - 2451545) / 36525;
  const gmst = 280.46061837 + 360.98564736629 * (jdUT - 2451545)
    + 0.000387933 * t * t - (t * t * t) / 38710000;
  return norm360(gmst + eastLon);
}

/**
 * The tropical ascendant from the local sidereal time, the obliquity and the latitude. This is exact
 * spherical trigonometry — it needs no ephemeris at all, which is why the Lagna can be stated as a
 * figure while the planets this app cannot compute are stated as missing.
 */
function ascendantDeg(lstDeg: number, latDeg: number, obliqDeg: number): number {
  const th = lstDeg * DEG;
  const eps = obliqDeg * DEG;
  const phi = latDeg * DEG;
  const y = Math.cos(th);
  const x = -(Math.sin(th) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps));
  return norm360(Math.atan2(y, x) / DEG);
}

/** Everything this app can honestly compute for one birth. Pure. */
function chartFor(b: Birth) {
  const dateParts = b.dob.split('-').map((x) => parseInt(x, 10));
  const timeParts = b.tob.split(':').map((x) => parseInt(x, 10));
  const y = dateParts[0];
  const mo = dateParts[1];
  const d = dateParts[2];
  const hh = timeParts[0];
  const mi = timeParts[1];
  if (!y || !mo || !d || !isFinite(hh) || !isFinite(mi)) return null;

  const hours = hh + mi / 60;
  const jdUT = julianDay0(y, mo, d) + (hours - TZ) / 24;
  const s = sunAt(jdUT);
  const ayan = ayanamsa(jdUT);
  const lst = localSiderealDeg(jdUT, b.lon);
  const ascTropical = ascendantDeg(lst, b.lat, s.obliq);
  const lagna = placeOf(ascTropical - ayan);

  const rahu = norm360(rahuLon(jdUT));
  const grahas = [
    { key: 'sun', place: placeOf(s.lon - ayan) },
    { key: 'moon', place: placeOf(moonLon(jdUT) - ayan) },
    { key: 'rahu', place: placeOf(rahu - ayan) },
    { key: 'ketu', place: placeOf(rahu + 180 - ayan) },
  ];

  // Whole-sign bhava, the traditional rashi chart: house 1 IS the Lagna rashi, and each following
  // house is the next rashi. Chosen deliberately over a division-based house system — it is what a
  // North Indian chart shows, and it needs no extra assumption to be correct.
  const houseOf = (rashiIndex: number) => ((rashiIndex - lagna.rashiIndex + 12) % 12) + 1;
  const houses: Array<{ house: number; rashiIndex: number; grahas: string[] }> = [];
  for (let h = 1; h <= 12; h += 1) {
    const rashiIndex = (lagna.rashiIndex + h - 1) % 12;
    houses.push({
      house: h,
      rashiIndex: rashiIndex,
      grahas: grahas.filter((g) => houseOf(g.place.rashiIndex) === h).map((g) => g.key),
    });
  }

  return { jdUT: jdUT, lst: lst, ayan: ayan, lagna: lagna, grahas: grahas, houses: houses };
}

const SHORT: Record<string, string> = { sun: 'सू', moon: 'च', rahu: 'रा', ketu: 'के' };

/** The traditional North Indian diamond chart. Centres are the twelve regions of square + diagonals. */
const HOUSE_POS = [
  { x: 150, y: 70 }, { x: 78, y: 32 }, { x: 32, y: 78 }, { x: 70, y: 150 },
  { x: 32, y: 222 }, { x: 78, y: 268 }, { x: 150, y: 230 }, { x: 222, y: 268 },
  { x: 268, y: 222 }, { x: 230, y: 150 }, { x: 268, y: 78 }, { x: 222, y: 32 },
];

function DiamondChart(props: { houses: Array<{ house: number; rashiIndex: number; grahas: string[] }> }) {
  return (
    <svg viewBox="0 0 300 300" width="100%" style={{ maxWidth: 340, display: 'block', margin: '0 auto' }} role="img" aria-label="जन्म कुंडली चक्र">
      <rect x="1" y="1" width="298" height="298" fill="none" stroke="var(--border)" strokeWidth="2" />
      <line x1="1" y1="1" x2="299" y2="299" stroke="var(--border)" strokeWidth="1.5" />
      <line x1="299" y1="1" x2="1" y2="299" stroke="var(--border)" strokeWidth="1.5" />
      <polygon points="150,1 299,150 150,299 1,150" fill="none" stroke="var(--border)" strokeWidth="1.5" />
      {props.houses.map((h, i) => (
        <g key={String(h.house)}>
          <text x={HOUSE_POS[i].x} y={HOUSE_POS[i].y - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
            {h.rashiIndex + 1}
          </text>
          <text x={HOUSE_POS[i].x} y={HOUSE_POS[i].y + 8} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--accent)">
            {h.grahas.map((g) => SHORT[g]).join(' ')}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function App() {
  const { items: births, add, remove } = useCollection<Birth>('kundali-births-v1', SEED);
  const [screen, setScreen] = useState('chart');
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', dob: '1995-01-01', tob: '06:30', cityIndex: '0', lat: '', lon: '' });

  const active = births.find((b) => b.id === selected) || births[0] || null;
  const chart = useMemo(() => (active ? chartFor(active) : null), [active]);

  const saveBirth = () => {
    const idx = parseInt(form.cityIndex, 10);
    const custom = idx < 0;
    const lat = custom ? parseFloat(form.lat) : CITIES[idx].lat;
    const lon = custom ? parseFloat(form.lon) : CITIES[idx].lon;
    if (!form.name.trim() || !isFinite(lat) || !isFinite(lon)) return;
    // add() mints the id itself, so the saved row is whatever it hands back — never an id made here.
    const created = add({
      name: form.name.trim(),
      dob: form.dob,
      tob: form.tob,
      cityIndex: idx,
      lat: lat,
      lon: lon,
      place: custom ? lat.toFixed(3) + ', ' + lon.toFixed(3) : CITIES[idx].name,
    });
    setSelected(created.id);
    setAdding(false);
    setForm({ name: '', dob: '1995-01-01', tob: '06:30', cityIndex: '0', lat: '', lon: '' });
  };

  const cityOptions = CITIES.map((c, i) => ({ value: String(i), label: c.name }))
    .concat([{ value: '-1', label: 'अक्षांश/देशांतर खुद डालें' }]);

  return (
    <Shell
      brand="जन्म कुंडली"
      nav={[{ id: 'chart', label: 'कुंडली' }, { id: 'people', label: 'जन्म विवरण' }, { id: 'about', label: 'गणना के बारे में' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<Button onClick={() => setAdding(true)}>+ नया</Button>}
    >
      {screen === 'chart' && (
        !active || !chart ? (
          <Card title="कुंडली">
            <Empty>पहले किसी का जन्म विवरण जोड़ें — नाम, जन्म तिथि, जन्म समय और जन्म स्थान।</Empty>
          </Card>
        ) : (
          <div>
            <StatRow>
              <StatTile label="लग्न (Ascendant)" value={chart.lagna.rashi} hint={chart.lagna.degInRashi.toFixed(2) + '° पर'} />
              <StatTile label="लग्न नक्षत्र" value={chart.lagna.nakshatra} hint={'पाद ' + chart.lagna.pada} />
              <StatTile label="अयनांश (Lahiri)" value={chart.ayan.toFixed(3) + '°'} hint="सायन से निरयन" />
              <StatTile label="स्थानीय नक्षत्र काल" value={(chart.lst / 15).toFixed(3) + ' घं'} hint="Local sidereal time" />
            </StatRow>

            <Card title={active.name + ' — उत्तर भारतीय चक्र'}>
              <DiamondChart houses={chart.houses} />
              <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', margin: '10px 0 0' }}>
                हर खंड में ऊपर राशि संख्या और नीचे उस भाव में स्थित ग्रह। सू = सूर्य, च = चंद्र, रा = राहु, के = केतु।
              </p>
            </Card>

            <Card title="ग्रह स्थिति (निरयन / sidereal)">
              <div className="nb-table-wrap">
                <table className="nb-table">
                  <thead>
                    <tr><th>ग्रह</th><th>राशि</th><th>अंश</th><th>नक्षत्र</th><th>पाद</th><th>भाव</th></tr>
                  </thead>
                  <tbody>
                    {chart.grahas.map((g) => (
                      <tr key={g.key}>
                        <td>{GRAHA_LABEL[g.key]}</td>
                        <td>{g.place.rashi}</td>
                        <td>{g.place.degInRashi.toFixed(2)}°</td>
                        <td>{g.place.nakshatra}</td>
                        <td>{g.place.pada}</td>
                        <td>{((g.place.rashiIndex - chart.lagna.rashiIndex + 12) % 12) + 1}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 🔒 The limit, stated beside the table rather than buried — a user must never think a
                  graha is absent because of their birth chart when it is absent because of our maths. */}
              <div className="alert" style={{ marginTop: 14, fontSize: 12 }}>
                इस ऐप में <strong>लग्न, सूर्य, चंद्र, राहु और केतु</strong> की गणना की जाती है। मंगल, बुध,
                गुरु, शुक्र और शनि के लिए ग्रह-पंचांग (planetary ephemeris) चाहिए, जो यह ऑफ़लाइन ऐप साथ
                नहीं रखता — इसलिए उन्हें अनुमान से नहीं दिखाया जाता। जो दिखाया गया है, वह गणना से आया है।
              </div>
            </Card>
          </div>
        )
      )}

      {screen === 'people' && (
        <Card title="जन्म विवरण" actions={<Button onClick={() => setAdding(true)}>+ नया</Button>}>
          {births.length === 0 ? (
            <Empty>अभी कोई जन्म विवरण सहेजा नहीं गया।</Empty>
          ) : (
            <div className="nb-table-wrap">
              <table className="nb-table">
                <thead>
                  <tr><th>नाम</th><th>जन्म तिथि</th><th>समय</th><th>स्थान</th><th /></tr>
                </thead>
                <tbody>
                  {births.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {b.name}{' '}
                        {active && active.id === b.id ? <Badge tone="accent">चुना हुआ</Badge> : null}
                      </td>
                      <td>{b.dob}</td>
                      <td>{b.tob}</td>
                      <td>{b.place}</td>
                      <td>
                        <Button variant="ghost" onClick={() => { setSelected(b.id); setScreen('chart'); }}>कुंडली</Button>{' '}
                        <Button variant="danger" onClick={() => remove(b.id)}>हटाएँ</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {screen === 'about' && (
        <Card title="गणना कैसे होती है">
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            जन्म तिथि और समय से पहले <strong>जूलियन दिन</strong> निकाला जाता है, उससे
            <strong> स्थानीय नक्षत्र काल</strong> (local sidereal time), और उससे जन्म स्थान के अक्षांश पर
            पूर्वी क्षितिज का बिंदु — यही <strong>लग्न</strong> है। यह शुद्ध गोलीय त्रिकोणमिति है, इसमें किसी
            ग्रह-पंचांग की ज़रूरत नहीं, इसलिए लग्न का अंश पूरी तरह गणना से आता है।
          </p>
          <p style={{ lineHeight: 1.8, fontSize: 14 }}>
            सूर्य की स्थिति मानक सौर सूत्रों से (लगभग 0.01° तक सही), चंद्र की स्थिति संक्षिप्त चंद्र श्रेणी से
            (लगभग 0.2° तक), और राहु चंद्र की माध्य पात गति से निकाले जाते हैं। सायन से निरयन के लिए
            <strong> लाहिरी अयनांश</strong> घटाया जाता है। भाव <strong>पूर्ण राशि</strong> पद्धति से हैं —
            लग्न की राशि ही प्रथम भाव है।
          </p>
          <div className="alert" style={{ fontSize: 12 }}>
            चंद्र की 0.2° की सीमा के कारण नक्षत्र या पाद बदलने के बिल्कुल किनारे पर प्रकाशित पंचांग से
            थोड़ा अन्तर हो सकता है। महत्वपूर्ण धार्मिक निर्णय के लिए स्थानीय आचार्य या पंचांग से मिला लें।
          </div>
        </Card>
      )}

      {adding && (
        <Modal title="नया जन्म विवरण" onClose={() => setAdding(false)}>
          <Field label="नाम" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="पूरा नाम" />
          <Field label="जन्म तिथि" type="date" value={form.dob} onChange={(v) => setForm({ ...form, dob: v })} />
          <Field label="जन्म समय (24 घंटे)" type="time" value={form.tob} onChange={(v) => setForm({ ...form, tob: v })} />
          <Select label="जन्म स्थान" value={form.cityIndex} onChange={(v) => setForm({ ...form, cityIndex: v })} options={cityOptions} />
          {form.cityIndex === '-1' && (
            <div>
              <Field label="अक्षांश (latitude)" value={form.lat} onChange={(v) => setForm({ ...form, lat: v })} placeholder="जैसे 26.85" />
              <Field label="देशांतर (longitude)" value={form.lon} onChange={(v) => setForm({ ...form, lon: v })} placeholder="जैसे 80.95" />
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--muted)' }}>
            जन्म समय जितना सही होगा, लग्न उतना ही सही होगा — चार मिनट का अन्तर लग्न को लगभग एक अंश खिसका देता है।
          </p>
          <Button onClick={saveBirth}>सहेजें</Button>
        </Modal>
      )}
    </Shell>
  );
}
`;
