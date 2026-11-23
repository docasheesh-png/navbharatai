// Courtyard — an original two-player dice board. A starting point: a later request may change any of it.
export const courtyardAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'courtyard-best-v1';
const TRACK = 20;
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', roll: 'Roll', you: 'You', rival: 'Rival', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', roll: 'पासा', you: 'आप', rival: 'प्रतिद्वंद्वी', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [level, setLevel] = useState(1);
  const [you, setYou] = useState(0);
  const [rival, setRival] = useState(0);
  const [turn, setTurn] = useState<'you' | 'rival'>('you');
  const [die, setDie] = useState(1);
  const [best, setBest] = useState(1);
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function beep() {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 480; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.06);
    } catch { /* sound is optional */ }
  }

  function win(atLevel: number) {
    setPhase('over');
    setBest((prev) => { const next = Math.max(prev, atLevel); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  function step(pos: number, roll: number) {
    const next = pos + roll;
    if (next === 7 || next === 14) return Math.min(TRACK, next + 3);
    if (next === 11 || next === 18) return Math.max(0, next - 3);
    return Math.min(TRACK, next);
  }

  function roll() {
    if (phase !== 'play' || turn !== 'you') return;
    const value = 1 + Math.floor(Math.random() * (5 + level));
    const face = ((value - 1) % 6) + 1;
    setDie(face);
    beep();
    const mine = step(you, face);
    setYou(mine);
    if (mine >= TRACK) { win(level); return; }
    const theirs = step(rival, 1 + Math.floor(Math.random() * 6));
    setRival(theirs);
    if (theirs >= TRACK) { setPhase('over'); return; }
    setTurn('you');
  }

  function onKey(e: { key: string }) { if (e.key === ' ' || e.key === 'Enter') roll(); }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }} onKeyDown={onKey} tabIndex={0}>
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
      {phase === 'menu' && <button className="primary" onClick={() => setPhase('play')}>{t.play}</button>}
      {phase === 'over' && (
        <div className="card" style={{ padding: 16 }}>
          <p>{t.over}</p>
          <button className="primary" onClick={() => { setYou(0); setRival(0); setLevel((n) => n + 1); setPhase('play'); }}>{t.again}</button>
        </div>
      )}
      {phase === 'play' && (
        <div>
          <p>{t.you} {you}/{TRACK} · {t.rival} {rival}/{TRACK}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {Array.from({ length: TRACK + 1 }, (_, i) => (
              <div key={i} style={{ height: 28, borderRadius: 6, background: i === you ? ACCENT : i === rival ? '#f59e0b' : '#e5e7eb' }} />
            ))}
          </div>
          <button className="primary" style={{ marginTop: 12 }} onClick={roll}>{t.roll} ({die})</button>
        </div>
      )}
    </div>
  );
}
`;
