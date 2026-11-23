// Garden Match — a playable match-3 screen. A starting point: a later request may change any of it.
export const gardenMatchAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'garden-match-best-v1';
const COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7'];
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

function fresh(): number[] {
  return Array.from({ length: 36 }, () => Math.floor(Math.random() * 5));
}

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [grid, setGrid] = useState<number[]>(fresh);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(16);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function lineClears(g: number[]): number[] {
    const drop = new Set<number>();
    for (let r = 0; r < 6; r++) {
      let run = 1;
      for (let c = 1; c <= 6; c++) {
        if (c < 6 && g[r * 6 + c] === g[r * 6 + c - 1]) run++;
        else { if (run >= 3) for (let k = 0; k < run; k++) drop.add(r * 6 + c - 1 - k); run = 1; }
      }
    }
    for (let c = 0; c < 6; c++) {
      let run = 1;
      for (let r = 1; r <= 6; r++) {
        if (r < 6 && g[r * 6 + c] === g[(r - 1) * 6 + c]) run++;
        else { if (run >= 3) for (let k = 0; k < run; k++) drop.add((r - 1 - k) * 6 + c); run = 1; }
      }
    }
    return [...drop];
  }

  function tap(i: number) {
    if (phase !== 'play' || moves <= 0) return;
    if (picked === null) { setPicked(i); return; }
    const sameRow = Math.floor(picked / 6) === Math.floor(i / 6) && Math.abs(picked - i) === 1;
    const sameCol = picked % 6 === i % 6 && Math.abs(picked - i) === 6;
    if (!sameRow && !sameCol) { setPicked(i); return; }
    const next = grid.slice();
    const swap = next[picked]; next[picked] = next[i]; next[i] = swap;
    const cleared = lineClears(next);
    setPicked(null);
    setMoves((m) => m - 1);
    if (cleared.length === 0) return;
    for (const cell of cleared) next[cell] = Math.floor(Math.random() * 5);
    const gained = cleared.length * 10;
    const nextScore = score + gained;
    setGrid(next);
    setScore(nextScore);
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 700; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.05); } catch { /* optional */ }
    if (nextScore >= level * 80) { setLevel((n) => n + 1); setMoves(16); }
  }

  useEffect(() => {
    if (phase === 'play' && moves === 0 && score < level * 80) {
      setPhase('over');
      setBest((prev) => { const high = Math.max(prev, score); try { localStorage.setItem(BEST, String(high)); } catch { /* ignore */ } return high; });
    }
  }, [moves, phase, score, level]);

  function onKey(e: { key: string }) { if (e.key === 'Enter' && phase !== 'play') { setGrid(fresh()); setScore(0); setMoves(16); setPicked(null); setPhase('play'); } }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      <p className="muted">{moves}</p>
      {phase !== 'play' && <button className="primary" onClick={() => { setGrid(fresh()); setScore(0); setMoves(16); setPicked(null); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
        {grid.map((color, i) => <button key={i} onClick={() => tap(i)} style={{ aspectRatio: '1', borderRadius: 8, background: COLORS[color], outline: picked === i ? '3px solid ' + ACCENT : 'none' }} />)}
      </div>
    </div>
  );
}
`;
