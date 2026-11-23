// Coin Dice — the library two-dice game for PLAY COINS ONLY: high / low / seven / doubles with the true chance from all
// 36 rolls shown and pay that follows it, tumbling dice, a totals chart and a refill.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const coinDiceAppTsx = `// __TITLE__ — roll two dice with pretend play coins: call high, low, seven or doubles before the roll. PLAY COINS ONLY:
// never real money, nothing to pay in and no prize. Our own code. Every part is a named block below, so any of it can be
// changed by asking: the OPTIONS (coins, stakes), the CALLS (what each call needs and pays), the LOOKS, the COPY. Ideas
// studied (no code taken): the true chance of every call counted from all 36 rolls and shown before you choose, pay that
// follows the chance, dice that tumble before they settle, a roll history with a running count of totals, and a refill.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'coin-dice-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  startCoins: 100,
  stakes: [5, 10, 25],
  tumbles: 10,             // face changes before the dice settle
  refill: 50,
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Coins', best: 'Most coins', stake: 'Stake', roll: 'Roll',
    refill: 'Refill play coins', chance: 'chance', pays: 'pays', won: 'You win', lost: 'No luck', note: 'Play coins only — no real money',
    lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'सिक्के', best: 'सबसे ज़्यादा', stake: 'दाँव', roll: 'फेंको',
    refill: 'खेल के सिक्के फिर भरो', chance: 'संभावना', pays: 'मिलता', won: 'आप जीते', lost: 'इस बार नहीं', note: 'सिर्फ़ खेल के सिक्के — असली पैसा नहीं',
    lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── CALLS — what each needs, and what it pays (stake × times, stake included) ──
export const CALLS = {
  low: { en: 'Low (2–6)', hi: 'छोटा (2–6)', wins: (a: number, b: number) => a + b <= 6, times: 2.4 },
  seven: { en: 'Seven', hi: 'सात', wins: (a: number, b: number) => a + b === 7, times: 5.5 },
  high: { en: 'High (8–12)', hi: 'बड़ा (8–12)', wins: (a: number, b: number) => a + b >= 8, times: 2.4 },
  doubles: { en: 'Doubles', hi: 'जोड़ी', wins: (a: number, b: number) => a === b, times: 5.5 },
};
export type Call = keyof typeof CALLS;

// ── RULES — pure ────────────────────────────────────────────────────────────
export const die = (r: () => number = Math.random) => 1 + (Math.floor(r() * 6) % 6);

/** The true chance of a call, counted over all 36 ways two dice can land. */
export function chanceOf(call: Call): number {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (CALLS[call].wins(a, b)) n++;
  return n / 36;
}

/** Coins back for a roll: stake × times on a win, nothing on a loss. */
export const settle = (call: Call, stake: number, a: number, b: number) => (CALLS[call].wins(a, b) ? Math.round(stake * CALLS[call].times) : 0);

/** How often each total (2–12) has come up. */
export function tally(rolls: [number, number][]): number[] {
  const out = Array(13).fill(0);
  for (const [a, b] of rolls) out[a + b]++;
  return out;
}

function beep(freq: number, len = 0.04) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const PIPS: Record<number, [number, number][]> = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] };
function Die({ n, spin }: { n: number; spin: boolean }) {
  return (
    <svg viewBox="0 0 60 60" width={72} height={72} style={{ transform: spin ? 'rotate(' + n * 37 + 'deg)' : 'none', transition: 'transform .08s' }}>
      <rect x={2} y={2} width={56} height={56} rx={10} fill="#f8fafc" stroke="#0f172a" strokeWidth={2} />
      {PIPS[n].map(([x, y], i) => <circle key={i} cx={14 + x * 16} cy={14 + y * 16} r={5} fill={n === 1 ? '#dc2626' : '#0f172a'} />)}
    </svg>
  );
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [coins, setCoins] = useState(OPTIONS.startCoins);
  const [best, setBest] = useState(0);
  const [stake, setStake] = useState(OPTIONS.stakes[0]);
  const [call, setCall] = useState<Call>('high');
  const [dice, setDice] = useState<[number, number]>([3, 4]);
  const [rolling, setRolling] = useState(false);
  const [rolls, setRolls] = useState<[number, number][]>([]);
  const [result, setResult] = useState('');
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function roll() {
    if (rolling || coins < stake) return;
    setRolling(true); setResult(''); setCoins(coins - stake);
    const a = die(), b = die();
    for (let k = 0; k < OPTIONS.tumbles; k++) setTimeout(() => { setDice([die(), die()]); beep(300 + k * 40, 0.02); }, k * 70);
    setTimeout(() => {
      const back = settle(call, stake, a, b);
      setDice([a, b]); setRolling(false); setRolls((r) => [[a, b] as [number, number], ...r].slice(0, 60));
      setResult(back ? t.won + ' ' + back : t.lost); beep(back ? 990 : 200, 0.2);
      setCoins((c) => {
        const n = c + back;
        setBest((prev) => { const bst = Math.max(prev, n); try { localStorage.setItem(BEST, String(bst)); } catch { /* ignore */ } return bst; });
        if (n < Math.min(...OPTIONS.stakes)) setPhase('over');
        return n;
      });
    }, OPTIONS.tumbles * 70 + 60);
  }

  const counts = tally(rolls), most = Math.max(1, ...counts);
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
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', margin: '12px 0' }}>
        <Die n={dice[0]} spin={rolling} /><Die n={dice[1]} spin={rolling} />
      </div>
      {result && <p style={{ textAlign: 'center', fontWeight: 700 }}>{result} · {dice[0] + dice[1]}</p>}
      {phase === 'play' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(Object.keys(CALLS) as Call[]).map((c) => (
              <button key={c} className="badge" disabled={rolling} onClick={() => setCall(c)}
                style={{ padding: 8, outline: c === call ? '2px solid ' + ACCENT : 'none' }}>
                <b>{CALLS[c][lang]}</b><br />{t.chance} {Math.round(chanceOf(c) * 100)}% · {t.pays} ×{CALLS[c].times}
              </button>
            ))}
          </div>
          <div className="row" style={{ display: 'flex', gap: 8, margin: '10px 0', alignItems: 'center' }}>
            <span>{t.stake}</span>
            {OPTIONS.stakes.map((s) => <button key={s} className="badge" disabled={rolling || s > coins} onClick={() => setStake(s)}
              style={{ outline: s === stake ? '2px solid ' + ACCENT : 'none' }}>{s}</button>)}
            <button className="primary" disabled={rolling || coins < stake} onClick={roll} style={{ marginLeft: 'auto' }}>{t.roll}</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 50 }}>
            {counts.slice(2).map((n, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10 }}>
                <div style={{ height: (40 * n) / most, background: ACCENT, borderRadius: 2 }} />{i + 2}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
`;
