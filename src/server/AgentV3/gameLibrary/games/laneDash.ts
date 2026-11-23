// Lane Dash — an original endless runner. A starting point: a later request may change any of it.
export const laneDashAppTsx = `import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'lane-dash-best-v1';

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', left: 'Left', right: 'Right', jump: 'Jump', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', left: 'बाएँ', right: 'दाएँ', jump: 'कूदो', lang: 'English' },
} as const;

type Lang = keyof typeof COPY;
type Phase = 'menu' | 'play' | 'over';

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<Phase>('menu');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ score: 0, level: 1, lane: 1, y: 0, vy: 0, obstacles: [] as { lane: number; z: number }[], running: false });

  useEffect(() => {
    try {
      const n = parseInt(localStorage.getItem(BEST) || '', 10);
      if (Number.isFinite(n)) setBest(n);
    } catch { /* a private window simply does not remember */ }
  }, []);

  function beep(freq: number) {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.value = 0.04;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.07);
    } catch { /* sound can be blocked; the game still plays */ }
  }

  function finish(finalScore: number) {
    live.current.running = false;
    setScore(finalScore);
    setPhase('over');
    setBest((prev) => {
      const next = Math.max(prev, finalScore);
      try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ }
      return next;
    });
    beep(180);
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const state = live.current;
    state.running = true;
    state.score = 0;
    state.level = 1;
    state.lane = 1;
    state.y = 0;
    state.vy = 0;
    state.obstacles = [];
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      if (!state.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      state.vy -= 28 * dt;
      state.y = Math.max(0, state.y + state.vy * dt);
      if (state.y === 0) state.vy = 0;
      const speed = 4 + state.level;
      if (Math.random() < 0.02 + state.level * 0.004) state.obstacles.push({ lane: Math.floor(Math.random() * 3), z: 1 });
      for (const o of state.obstacles) o.z -= dt * speed * 0.35;
      state.obstacles = state.obstacles.filter((o) => o.z > -0.1);
      const hit = state.obstacles.some((o) => o.lane === state.lane && o.z < 0.12 && o.z > 0 && state.y < 0.4);
      state.score += dt * 10;
      const nextLevel = 1 + Math.floor(state.score / 30);
      if (nextLevel !== state.level) { state.level = nextLevel; beep(620); }
      setScore(Math.floor(state.score));
      setLevel(state.level);
      const w = c.width;
      const h = c.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, w, h);
      for (let lane = 0; lane < 3; lane++) {
        ctx.fillStyle = lane === state.lane ? ACCENT : '#1f2937';
        ctx.fillRect(20 + lane * 90, 20, 80, h - 40);
      }
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(28 + state.lane * 90, h - 80 - state.y * 80, 64, 48);
      ctx.fillStyle = '#f59e0b';
      for (const o of state.obstacles) ctx.fillRect(36 + o.lane * 90, 40 + o.z * (h - 120), 48, 28);
      if (hit) { finish(Math.floor(state.score)); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { state.running = false; cancelAnimationFrame(raf); };
  }, [phase]);

  function move(dir: -1 | 1) {
    if (phase !== 'play') return;
    live.current.lane = Math.max(0, Math.min(2, live.current.lane + dir));
  }
  function jump() {
    if (phase === 'play' && live.current.y === 0) { live.current.vy = 9; beep(520); }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') move(-1);
      if (e.key === 'ArrowRight' || e.key === 'd') move(1);
      if (e.key === 'ArrowUp' || e.key === ' ' || e.key === 'w') jump();
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
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16 }}>
          <p>{phase === 'over' ? t.over : TITLE}</p>
          <button className="primary" onClick={() => { setScore(0); setLevel(1); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      <canvas ref={canvas} width={300} height={420} style={{ width: '100%', borderRadius: 12, touchAction: 'none' }} />
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={() => move(-1)}>{t.left}</button>
        <button className="primary" onClick={jump}>{t.jump}</button>
        <button className="primary" onClick={() => move(1)}>{t.right}</button>
      </div>
    </div>
  );
}
`;
