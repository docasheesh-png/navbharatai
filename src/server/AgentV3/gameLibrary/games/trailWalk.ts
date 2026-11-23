// Trail Walk — the publishable walk for the open-world starter. The 3D OpenWorldGame kit stays for big-map builds. A later request may change any of this file.
export const trailWalkAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'trail-walk-best-v1';
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [x, setX] = useState(1);
  const [y, setY] = useState(1);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const [markers, setMarkers] = useState<string[]>(['3,1', '1,4', '5,5']);
  const t = COPY[lang];
  const size = 5 + Math.min(3, level);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function place(nextLevel: number) {
    const span = 5 + Math.min(3, nextLevel);
    const spots: string[] = [];
    while (spots.length < 3) {
      const spot = Math.floor(Math.random() * span) + ',' + Math.floor(Math.random() * span);
      if (spot !== '0,0' && !spots.includes(spot)) spots.push(spot);
    }
    setMarkers(spots);
    setX(0); setY(0); setLevel(nextLevel); setPhase('play');
  }

  function move(dx: number, dy: number) {
    if (phase !== 'play') return;
    const nx = Math.max(0, Math.min(size - 1, x + dx));
    const ny = Math.max(0, Math.min(size - 1, y + dy));
    setX(nx); setY(ny);
    const key = nx + ',' + ny;
    if (!markers.includes(key)) return;
    const left = markers.filter((m) => m !== key);
    setMarkers(left);
    const next = score + 1;
    setScore(next);
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 600; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.05); } catch { /* optional */ }
    if (left.length === 0) {
      setBest((prev) => { const high = Math.max(prev, next); try { localStorage.setItem(BEST, String(high)); } catch { /* ignore */ } return high; });
      setPhase('over');
    }
  }

  function onKey(e: { key: string }) {
    if (e.key === 'ArrowLeft' || e.key === 'a') move(-1, 0);
    if (e.key === 'ArrowRight' || e.key === 'd') move(1, 0);
    if (e.key === 'ArrowUp' || e.key === 'w') move(0, -1);
    if (e.key === 'ArrowDown' || e.key === 's') move(0, 1);
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
      {phase !== 'play' && <button className="primary" onClick={() => place(phase === 'over' ? level + 1 : 1)}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + size + ', 1fr)', gap: 4 }}>
        {Array.from({ length: size * size }, (_, i) => {
          const cx = i % size;
          const cy = Math.floor(i / size);
          const here = cx === x && cy === y;
          const mark = markers.includes(cx + ',' + cy);
          return <div key={i} style={{ aspectRatio: '1', borderRadius: 6, background: here ? ACCENT : mark ? '#fde68a' : '#d1fae5' }} />;
        })}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={() => move(-1, 0)}>←</button>
        <button className="primary" onClick={() => move(0, -1)}>↑</button>
        <button className="primary" onClick={() => move(0, 1)}>↓</button>
        <button className="primary" onClick={() => move(1, 0)}>→</button>
      </div>
    </div>
  );
}
`;
