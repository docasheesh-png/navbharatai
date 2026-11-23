// Ring Rally — an original top-down lap race. A starting point: a later request may change any of it.
export const ringRallyAppTsx = `import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'ring-rally-best-v1';
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
  const live = useRef({ x: 150, angle: 0, running: false, score: 0, level: 1 });

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function beep(freq: number) {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.06);
    } catch { /* optional */ }
  }

  function finish(finalScore: number) {
    live.current.running = false;
    setScore(finalScore);
    setPhase('over');
    setBest((prev) => { const next = Math.max(prev, finalScore); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const state = live.current;
    state.running = true;
    state.x = 150;
    state.angle = 0;
    state.score = 0;
    state.level = 1;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      if (!state.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      state.angle += dt * (1.2 + state.level * 0.25);
      state.score += dt * 12;
      const nextLevel = 1 + Math.floor(state.score / 40);
      if (nextLevel !== state.level) { state.level = nextLevel; beep(640); }
      const gate = (Math.sin(state.angle * 3) * 40) + 150;
      if (Math.abs(state.x - gate) > 70) { finish(Math.floor(state.score)); return; }
      setScore(Math.floor(state.score));
      setLevel(state.level);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#14532d';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 28;
      ctx.beginPath();
      ctx.arc(150, 180, 90, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(state.x - 10, 250, 20, 32);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { state.running = false; cancelAnimationFrame(raf); };
  }, [phase]);

  function nudge(dir: -1 | 1) { if (phase === 'play') live.current.x = Math.max(40, Math.min(260, live.current.x + dir * 18)); }

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
