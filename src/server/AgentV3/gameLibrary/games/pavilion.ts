// Pavilion — a playable overs screen in front of the cricket rules. Play is the match, not a wager. A later request may change any of it.
export const pavilionAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'pavilion-best-v1';
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;
const SHOTS = [0, 1, 2, 4, 6] as const;

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [runs, setRuns] = useState(0);
  const [balls, setBalls] = useState(0);
  const [wickets, setWickets] = useState(0);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const target = 12 + level * 4;

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function finish(finalScore: number) {
    setPhase('over');
    setBest((prev) => { const next = Math.max(prev, finalScore); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
    try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 300; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08); } catch { /* optional */ }
  }

  function shot(asked: number) {
    if (phase !== 'play' || wickets >= 2) return;
    const luck = Math.random();
    const wide = luck > 0.92;
    const out = !wide && luck < 0.12 + level * 0.02;
    const got = wide ? 1 : out ? 0 : luck > 0.7 ? asked : Math.min(asked, 1);
    const nextBalls = balls + (wide ? 0 : 1);
    const nextRuns = runs + got;
    const nextWickets = wickets + (out ? 1 : 0);
    setRuns(nextRuns); setBalls(nextBalls); setWickets(nextWickets);
    if (nextRuns >= target) { setLevel((n) => n + 1); setRuns(0); setBalls(0); setWickets(0); return; }
    if (nextWickets >= 2 || nextBalls >= 6) finish(nextRuns + (level - 1) * 10);
  }

  function onKey(e: { key: string }) {
    if (e.key === '1') shot(1);
    if (e.key === '2') shot(2);
    if (e.key === '4') shot(4);
    if (e.key === '6') shot(6);
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {runs}/{target}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      <p className="muted">{balls} balls · {wickets} wickets</p>
      {phase !== 'play' && <button className="primary" onClick={() => { setRuns(0); setBalls(0); setWickets(0); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      {phase === 'play' && (
        <div className="row" style={{ gap: 8 }}>
          {SHOTS.filter((n) => n > 0).map((n) => <button key={n} className="primary" style={{ background: ACCENT }} onClick={() => shot(n)}>{n}</button>)}
        </div>
      )}
    </div>
  );
}
`;
