// Coin Wheel — the library prize wheel for PLAY COINS ONLY: slices drawn from the odds table, the result picked first and
// the spin eased onto it, a ticking pointer, the chance of every slice shown, history and a refill.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const coinWheelAppTsx = `// __TITLE__ — spin the wheel with pretend play coins. PLAY COINS ONLY: never real money, nothing to pay in and no prize.
// Our own code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS (coins, stakes),
// the SEGMENTS (what each slice pays and how many slices), the LOOKS, the COPY. Ideas studied (no code taken): a wheel drawn
// from its own slices so the picture always matches the odds, the result picked first and the spin eased to land on it, a
// ticking pointer, the real chance of each slice shown, a spin history, and a free refill when the coins run out.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'coin-wheel-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  startCoins: 100,
  stakes: [5, 10, 25],
  spinSeconds: 3.2,
  turns: 4,                // full turns before it settles
  refill: 50,              // free play coins when you run out
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Coins', best: 'Most coins', stake: 'Stake', spin: 'Spin',
    refill: 'Refill play coins', chance: 'Chance', pays: 'Pays', last: 'Last spins', note: 'Play coins only — no real money', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'सिक्के', best: 'सबसे ज़्यादा', stake: 'दाँव', spin: 'घुमाओ',
    refill: 'खेल के सिक्के फिर भरो', chance: 'संभावना', pays: 'मिलता', last: 'पिछले घुमाव', note: 'सिर्फ़ खेल के सिक्के — असली पैसा नहीं', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── SEGMENTS — each slice pays stake × times; the wheel is drawn from this list, so the picture shows the real odds ──
export const SEGMENTS: { times: number; colour: string }[] = [
  { times: 0, colour: '#475569' }, { times: 2, colour: '#16a34a' }, { times: 0, colour: '#475569' }, { times: 1, colour: '#0ea5e9' },
  { times: 0, colour: '#475569' }, { times: 3, colour: '#f59e0b' }, { times: 0, colour: '#475569' }, { times: 1, colour: '#0ea5e9' },
  { times: 0, colour: '#475569' }, { times: 2, colour: '#16a34a' }, { times: 0, colour: '#475569' }, { times: 10, colour: '#dc2626' },
];

// ── RULES — pure ────────────────────────────────────────────────────────────
export const pickSegment = (r: () => number = Math.random) => Math.floor(r() * SEGMENTS.length) % SEGMENTS.length;
export const payout = (stake: number, index: number) => stake * SEGMENTS[index].times;

/** The chance of each "times" value, from the slices themselves. */
export function chances(): { times: number; chance: number }[] {
  const by = new Map<number, number>();
  for (const s of SEGMENTS) by.set(s.times, (by.get(s.times) || 0) + 1);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([times, n]) => ({ times, chance: n / SEGMENTS.length }));
}

/** What a spin gives back on average for each coin staked. */
export const averageReturn = () => SEGMENTS.reduce((sum, s) => sum + s.times, 0) / SEGMENTS.length;

/** The wheel angle (radians, clockwise) that puts slice 'index' under the pointer at the top, after whole turns. */
export function landingAngle(index: number, from: number, turns = OPTIONS.turns): number {
  const slice = (Math.PI * 2) / SEGMENTS.length;
  const target = -(index + 0.5) * slice;                     // slice centre to the top
  const base = from + turns * Math.PI * 2;
  const k = Math.ceil((base - target) / (Math.PI * 2));
  return target + k * Math.PI * 2;
}

/** Which slice is under the pointer at this wheel angle. */
export function sliceAt(angle: number): number {
  const slice = (Math.PI * 2) / SEGMENTS.length;
  const a = ((-angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor(a / slice) % SEGMENTS.length;
}

export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function beep(freq: number, len = 0.03) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [coins, setCoins] = useState(OPTIONS.startCoins);
  const [best, setBest] = useState(0);
  const [stake, setStake] = useState(OPTIONS.stakes[0]);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const t = COPY[lang];
  const raf = useRef(0);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
    return () => cancelAnimationFrame(raf.current);
  }, []);

  function spin() {
    if (spinning || coins < stake) return;
    const index = pickSegment(), from = angle, to = landingAngle(index, from), began = performance.now();
    setSpinning(true); setCoins(coins - stake);
    let lastSlice = sliceAt(from);
    const step = (now: number) => {
      const p = (now - began) / (OPTIONS.spinSeconds * 1000), a = from + (to - from) * easeOut(p);
      setAngle(a);
      const s = sliceAt(a); if (s !== lastSlice) { lastSlice = s; beep(1500); }
      if (p < 1) { raf.current = requestAnimationFrame(step); return; }
      const won = payout(stake, index);
      setSpinning(false); setHistory((h) => [SEGMENTS[index].times, ...h].slice(0, 8));
      setCoins((c) => {
        const n = c + won;
        setBest((prev) => { const b = Math.max(prev, n); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
        if (n < Math.min(...OPTIONS.stakes)) setPhase('over');
        return n;
      });
      beep(won > stake ? 990 : won ? 660 : 220, 0.2);
    };
    raf.current = requestAnimationFrame(step);
  }

  const R = 130, slice = 360 / SEGMENTS.length;
  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <p style={{ fontSize: 13, opacity: 0.8, margin: '4px 0' }}>{t.note}</p>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {coins}</span>
        <span className="badge">{t.best} {best}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          {phase === 'over' && <p>{t.over}</p>}
          <button className="primary" onClick={() => { setCoins(phase === 'over' ? OPTIONS.refill : OPTIONS.startCoins); setPhase('play'); }}>
            {phase === 'over' ? t.again + ' — ' + t.refill : t.play}</button>
        </div>
      )}
      <svg viewBox="-150 -160 300 310" style={{ width: '100%', maxWidth: 320, display: 'block', margin: '0 auto' }}>
        <g transform={'rotate(' + (angle * 180) / Math.PI + ')'}>
          {SEGMENTS.map((s, i) => {
            const a0 = ((i * slice - 90) * Math.PI) / 180, a1 = (((i + 1) * slice - 90) * Math.PI) / 180, mid = (a0 + a1) / 2;
            const path = 'M0 0 L' + R * Math.cos(a0) + ' ' + R * Math.sin(a0) + ' A' + R + ' ' + R + ' 0 0 1 ' + R * Math.cos(a1) + ' ' + R * Math.sin(a1) + ' Z';
            return (
              <g key={i}>
                <path d={path} fill={s.colour} stroke="#fff" strokeWidth={2} />
                <text x={R * 0.7 * Math.cos(mid)} y={R * 0.7 * Math.sin(mid) + 5} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={700}>×{s.times}</text>
              </g>
            );
          })}
          <circle r={16} fill={ACCENT} />
        </g>
        <path d="M-10 -150 L10 -150 L0 -128 Z" fill="#fbbf24" stroke="#000" />
      </svg>
      {phase === 'play' && (
        <>
          <div className="row" style={{ display: 'flex', gap: 8, margin: '10px 0', alignItems: 'center' }}>
            <span>{t.stake}</span>
            {OPTIONS.stakes.map((s) => <button key={s} className="badge" disabled={spinning || s > coins} onClick={() => setStake(s)}
              style={{ outline: s === stake ? '2px solid ' + ACCENT : 'none' }}>{s}</button>)}
            <button className="primary" disabled={spinning || coins < stake} onClick={spin} style={{ marginLeft: 'auto' }}>{t.spin}</button>
          </div>
          <div style={{ fontSize: 13 }}>
            {chances().map((c) => <span key={c.times} style={{ marginRight: 10 }}>×{c.times}: {Math.round(c.chance * 100)}%</span>)}
          </div>
          {history.length > 0 && <p style={{ fontSize: 13 }}>{t.last}: {history.map((h) => '×' + h).join(' ')}</p>}
        </>
      )}
    </div>
  );
}
`;
