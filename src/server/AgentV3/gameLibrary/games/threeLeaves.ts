// Three Leaves — a playable three-card hand. Play-coins only, never real money. A starting point: a later request may change any of it.
export const threeLeavesAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'three-leaves-best-v1';
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', deal: 'Deal', coins: 'Play coins', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', deal: 'बाँटो', coins: 'खेल के सिक्के', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

function hand(): number[] {
  return [0, 1, 2].map(() => Math.floor(Math.random() * 13));
}
function scoreHand(cards: number[]): number {
  const sorted = [...cards].sort((a, b) => a - b);
  const same = sorted[0] === sorted[1] || sorted[1] === sorted[2] || sorted[0] === sorted[2];
  const trail = sorted[0] === sorted[2];
  return (trail ? 100 : same ? 40 : 0) + Math.max(...sorted);
}

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [coins, setCoins] = useState(20);
  const [level, setLevel] = useState(1);
  const [yours, setYours] = useState<number[]>([]);
  const [theirs, setTheirs] = useState<number[]>([]);
  const [best, setBest] = useState(20);
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function deal() {
    if (phase !== 'play' || coins <= 0) return;
    const mine = hand();
    const opp = hand();
    setYours(mine);
    setTheirs(opp);
    const win = scoreHand(mine) >= scoreHand(opp);
    const next = coins + (win ? 2 : -2);
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = win ? 640 : 220; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.06); } catch { /* optional */ }
    setCoins(next);
    setBest((prev) => { const high = Math.max(prev, next); try { localStorage.setItem(BEST, String(high)); } catch { /* ignore */ } return high; });
    if (next >= 20 + level * 8) { setLevel((n) => n + 1); setCoins(20); }
    if (next <= 0) setPhase('over');
  }

  function onKey(e: { key: string }) { if (e.key === ' ' || e.key === 'Enter') deal(); }
  const show = (cards: number[]) => cards.map((n) => RANKS[n]).join(' ');

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {coins}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      <p className="muted">{t.coins}</p>
      {phase !== 'play' && <button className="primary" onClick={() => { setCoins(20); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      {phase === 'play' && (
        <div className="card" style={{ padding: 16, background: ACCENT, color: '#fff' }}>
          <p>{show(yours) || '—'}</p>
          <p>{show(theirs) || '—'}</p>
          <button className="primary" onClick={deal}>{t.deal}</button>
        </div>
      )}
    </div>
  );
}
`;
