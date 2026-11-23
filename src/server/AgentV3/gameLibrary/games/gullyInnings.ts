// Gully Innings — an original tap-timing cricket game. A starting point: a later request may change any of it.
export const gullyInningsAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'gully-innings-best-v1';
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', bat: 'Bat', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', bat: 'बैट', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [ball, setBall] = useState(0);
  const [mark, setMark] = useState(0);
  const [best, setBest] = useState(0);
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    const id = window.setInterval(() => setMark((m) => (m + 4 + level) % 100), 40);
    return () => window.clearInterval(id);
  }, [phase, level]);

  function beep(freq: number) {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.07);
    } catch { /* optional */ }
  }

  function end(finalScore: number) {
    setPhase('over');
    setBest((prev) => { const next = Math.max(prev, finalScore); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
    beep(200);
  }

  function bat() {
    if (phase !== 'play') return;
    const sweet = mark > 42 && mark < 58;
    const runs = sweet ? (mark > 48 && mark < 52 ? 6 : 4) : mark > 30 && mark < 70 ? 1 : 0;
    const out = !sweet && (mark < 12 || mark > 88);
    beep(sweet ? 700 : 320);
    const nextBall = ball + 1;
    const nextScore = score + runs;
    if (out || nextBall >= 6) {
      if (!out && nextScore >= 8 + level) { setScore(0); setBall(0); setLevel((n) => n + 1); return; }
      setScore(nextScore);
      end(nextScore + (level - 1) * 10);
      return;
    }
    setScore(nextScore);
    setBall(nextBall);
  }

  function onKey(e: { key: string }) { if (e.key === ' ' || e.key === 'Enter') bat(); }

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
      {phase !== 'play' && <button className="primary" onClick={() => { setScore(0); setBall(0); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      {phase === 'play' && (
        <div>
          <div style={{ height: 16, background: '#e5e7eb', borderRadius: 8, position: 'relative' }}>
            <div style={{ position: 'absolute', left: '40%', width: '20%', top: 0, bottom: 0, background: ACCENT, opacity: 0.35 }} />
            <div style={{ position: 'absolute', left: mark + '%', width: 8, top: -4, bottom: -4, background: '#111827' }} />
          </div>
          <button className="primary" style={{ marginTop: 16 }} onClick={bat}>{t.bat}</button>
        </div>
      )}
    </div>
  );
}
`;
