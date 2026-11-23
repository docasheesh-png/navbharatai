// Dodge Fall — the library screen for the Arcade dodge starter. A starting point: a later request may change any of it.
export const dodgeFallAppTsx = `import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'dodge-fall-best-v1';
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', left: 'Left', right: 'Right', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', left: 'बाएँ', right: 'दाएँ', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ x: 150, running: false, score: 0, level: 1, rocks: [] as { x: number; y: number }[] });

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function finish(finalScore: number) {
    live.current.running = false;
    setScore(finalScore);
    setPhase('over');
    setBest((prev) => { const next = Math.max(prev, finalScore); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 180; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.1); } catch { /* optional */ }
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const state = live.current;
    state.running = true; state.x = 150; state.score = 0; state.level = 1; state.rocks = [];
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      if (!state.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const speed = 80 + state.level * 30;
      if (Math.random() < 0.02 + state.level * 0.005) state.rocks.push({ x: 20 + Math.random() * 260, y: -10 });
      for (const r of state.rocks) r.y += speed * dt;
      state.rocks = state.rocks.filter((r) => r.y < 400);
      const hit = state.rocks.some((r) => Math.abs(r.x - state.x) < 22 && r.y > 300 && r.y < 340);
      state.score += dt * 8;
      state.level = 1 + Math.floor(state.score / 25);
      setScore(Math.floor(state.score));
      setLevel(state.level);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(state.x - 16, 310, 32, 24);
      ctx.fillStyle = '#f59e0b';
      for (const r of state.rocks) ctx.fillRect(r.x, r.y, 18, 18);
      if (hit) { finish(Math.floor(state.score)); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { state.running = false; cancelAnimationFrame(raf); };
  }, [phase]);

  function nudge(dir: -1 | 1) { if (phase === 'play') live.current.x = Math.max(20, Math.min(280, live.current.x + dir * 22)); }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') nudge(-1);
      if (e.key === 'ArrowRight' || e.key === 'd') nudge(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }}>
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
      {phase !== 'play' && <button className="primary" onClick={() => { setScore(0); setLevel(1); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      <canvas ref={canvas} width={300} height={360} style={{ width: '100%', borderRadius: 12, touchAction: 'none' }} />
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={() => nudge(-1)}>{t.left}</button>
        <button className="primary" onClick={() => nudge(1)}>{t.right}</button>
      </div>
    </div>
  );
}
`;
