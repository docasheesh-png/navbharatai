// Ladder Path — a playable snakes-and-ladders screen on the board rules. A starting point: a later request may change any of it.
export const ladderPathAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'ladder-path-best-v1';
const JUMPS: Record<number, number> = { 3: 12, 8: 20, 16: 4, 22: 9, 28: 40, 36: 18, 45: 30, 51: 62, 58: 41, 70: 88, 75: 55, 92: 73, 96: 84 };
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', roll: 'Roll', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', roll: 'पासा', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [you, setYou] = useState(1);
  const [rival, setRival] = useState(1);
  const [die, setDie] = useState(1);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(1);
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function land(from: number, roll: number) {
    let next = from + roll;
    if (next > 100) return from;
    return JUMPS[next] ?? next;
  }

  function finish(won: boolean) {
    setPhase('over');
    if (!won) return;
    setBest((prev) => { const next = Math.max(prev, level); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 520; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08); } catch { /* optional */ }
  }

  function roll() {
    if (phase !== 'play') return;
    const face = 1 + Math.floor(Math.random() * 6);
    setDie(face);
    const mine = land(you, face);
    setYou(mine);
    if (mine === 100) { finish(true); return; }
    const theirs = land(rival, 1 + Math.floor(Math.random() * 6));
    setRival(theirs);
    if (theirs === 100) finish(false);
  }

  function onKey(e: { key: string }) { if (e.key === ' ' || e.key === 'Enter') roll(); }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {you}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={() => { setYou(1); setRival(1); if (phase === 'over') setLevel((n) => n + 1); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3 }}>
        {Array.from({ length: 100 }, (_, n) => {
          const sq = 100 - n;
          const bg = sq === you ? ACCENT : sq === rival ? '#f59e0b' : JUMPS[sq] ? '#d1fae5' : '#e5e7eb';
          return <div key={sq} style={{ aspectRatio: '1', fontSize: 9, display: 'grid', placeItems: 'center', background: bg, borderRadius: 4 }}>{sq}</div>;
        })}
      </div>
      {phase === 'play' && <button className="primary" style={{ marginTop: 12 }} onClick={roll}>{t.roll} ({die})</button>}
    </div>
  );
}
`;
