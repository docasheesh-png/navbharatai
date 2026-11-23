// Stack Tiles — an original merge-tile puzzle. A starting point: a later request may change any of it.
export const stackTilesAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'stack-tiles-best-v1';
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;
type Grid = number[];

function slide(row: number[]): { row: number[]; gained: number } {
  const kept = row.filter((n) => n);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < kept.length; i++) {
    if (i + 1 < kept.length && kept[i] === kept[i + 1]) { out.push(kept[i] * 2); gained += kept[i] * 2; i++; }
    else out.push(kept[i]);
  }
  while (out.length < 4) out.push(0);
  return { row: out, gained };
}

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [grid, setGrid] = useState<Grid>(Array(16).fill(0));
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const level = 1 + Math.floor(score / 200);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function beep() {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 540; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.05);
    } catch { /* optional */ }
  }

  function spawn(g: Grid): Grid {
    const empty = g.map((n, i) => n === 0 ? i : -1).filter((i) => i >= 0);
    if (!empty.length) return g;
    const next = g.slice();
    next[empty[Math.floor(Math.random() * empty.length)]] = 2;
    return next;
  }

  function start() {
    setScore(0);
    setGrid(spawn(spawn(Array(16).fill(0))));
    setPhase('play');
  }

  function move(dir: 'left' | 'right' | 'up' | 'down') {
    if (phase !== 'play') return;
    const read = (r: number, c: number) => grid[r * 4 + c];
    const lines = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => {
      if (dir === 'left') return read(i, j);
      if (dir === 'right') return read(i, 3 - j);
      if (dir === 'up') return read(j, i);
      return read(3 - j, i);
    }));
    let gained = 0;
    const slid = lines.map((line) => { const s = slide(line); gained += s.gained; return s.row; });
    const next = Array(16).fill(0);
    const write = (r: number, c: number, n: number) => { next[r * 4 + c] = n; };
    slid.forEach((line, i) => line.forEach((n, j) => {
      if (dir === 'left') write(i, j, n);
      else if (dir === 'right') write(i, 3 - j, n);
      else if (dir === 'up') write(j, i, n);
      else write(3 - j, i, n);
    }));
    if (next.join() === grid.join()) return;
    const filled = spawn(next);
    const nextScore = score + gained;
    setGrid(filled);
    setScore(nextScore);
    beep();
    if (!filled.includes(0) && stuck(filled)) finish(nextScore);
  }

  function stuck(g: Grid): boolean {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      if (c < 3 && g[r * 4 + c] === g[r * 4 + c + 1]) return false;
      if (r < 3 && g[r * 4 + c] === g[(r + 1) * 4 + c]) return false;
    }
    return true;
  }

  function finish(finalScore: number) {
    setPhase('over');
    setBest((prev) => { const next = Math.max(prev, finalScore); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  function onKey(e: { key: string }) {
    const map: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
    const dir = map[e.key];
    if (dir) move(dir);
  }

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
      {phase !== 'play' && <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {grid.map((n, i) => <div key={i} style={{ aspectRatio: '1', borderRadius: 8, display: 'grid', placeItems: 'center', background: n ? ACCENT : '#e5e7eb', color: '#fff', fontWeight: 700 }}>{n || ''}</div>)}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={() => move('left')}>←</button>
        <button className="primary" onClick={() => move('up')}>↑</button>
        <button className="primary" onClick={() => move('down')}>↓</button>
        <button className="primary" onClick={() => move('right')}>→</button>
      </div>
    </div>
  );
}
`;
