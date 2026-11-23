// Shape Yard — the library shapes game: find a shape, count sides, spot shapes with no corners; shapes turned and resized,
// look-alike choices, and the name and sides shown after each answer.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const shapeYardAppTsx = `// __TITLE__ — a yard full of shapes: find the one asked for, count sides and corners, and spot shapes turned or resized.
// Our own code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS (rounds, choices),
// the SHAPES (names in English and Hindi, sides, how each is drawn), the ASKS, the LOOKS, the COPY. Ideas studied (no code
// taken): shapes drawn turned and resized so the child learns the shape and not one picture of it, questions about
// properties (sides, corners, curved), look-alike distractors (a square among rectangles), and a short "why" after answers.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'shape-yard-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  rounds: 10,
  choices: 4,
  turnShapes: true,       // draw shapes turned at random angles (harder, and better for learning)
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Round', find: 'Tap the',
    sides: 'Which shape has', sidesEnd: 'sides?', curved: 'Which shape has no corners?', right: 'Yes!', wrong: 'That is a', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'दौर', find: 'टैप करो:',
    sides: 'किस आकार की', sidesEnd: 'भुजाएँ हैं?', curved: 'किस आकार में कोई कोना नहीं है?', right: 'हाँ!', wrong: 'यह है', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── SHAPES — points are drawn round a centre; sides 0 = curved ──────────────
export interface Shape { id: string; en: string; hi: string; sides: number; points: (r: number) => [number, number][] }
const regular = (n: number, start = -Math.PI / 2) => (r: number) =>
  Array.from({ length: n }, (_, i): [number, number] => [r * Math.cos(start + (i * 2 * Math.PI) / n), r * Math.sin(start + (i * 2 * Math.PI) / n)]);
export const SHAPES: Shape[] = [
  { id: 'circle', en: 'circle', hi: 'वृत्त', sides: 0, points: (r) => Array.from({ length: 36 }, (_, i): [number, number] => [r * Math.cos(i / 5.73), r * Math.sin(i / 5.73)]) },
  { id: 'oval', en: 'oval', hi: 'अंडाकार', sides: 0, points: (r) => Array.from({ length: 36 }, (_, i): [number, number] => [r * Math.cos(i / 5.73), 0.6 * r * Math.sin(i / 5.73)]) },
  { id: 'triangle', en: 'triangle', hi: 'त्रिभुज', sides: 3, points: regular(3) },
  { id: 'square', en: 'square', hi: 'वर्ग', sides: 4, points: regular(4, Math.PI / 4) },
  { id: 'rectangle', en: 'rectangle', hi: 'आयत', sides: 4, points: (r) => [[-r, -0.55 * r], [r, -0.55 * r], [r, 0.55 * r], [-r, 0.55 * r]] },
  { id: 'pentagon', en: 'pentagon', hi: 'पंचभुज', sides: 5, points: regular(5) },
  { id: 'hexagon', en: 'hexagon', hi: 'षट्भुज', sides: 6, points: regular(6) },
  { id: 'star', en: 'star', hi: 'तारा', sides: 10, points: (r) => Array.from({ length: 10 }, (_, i): [number, number] => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.45 : 1; return [r * k * Math.cos(a), r * k * Math.sin(a)]; }) },
];

// ── RULES — pure ────────────────────────────────────────────────────────────
export type Ask = { kind: 'find'; target: string } | { kind: 'sides'; sides: number } | { kind: 'curved' };
export interface Round { ask: Ask; options: string[]; answer: string; turns: number[]; sizes: number[] }

/** Does this shape answer the ask? */
export function fits(shape: Shape, ask: Ask): boolean {
  if (ask.kind === 'find') return shape.id === ask.target;
  if (ask.kind === 'sides') return shape.sides === ask.sides;
  return shape.sides === 0;
}

/** A round: exactly one option fits the ask; look-alikes are picked first as the wrong options. */
export function makeRound(n: number, r: () => number = Math.random, o = OPTIONS): Round {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length) % xs.length];
  const kind = n < 3 ? 'find' : pick(['find', 'sides', 'curved'] as const);
  const answerShape = kind === 'curved' ? pick(SHAPES.filter((s) => s.sides === 0)) : pick(SHAPES.filter((s) => kind === 'find' || s.sides > 0));
  const ask: Ask = kind === 'find' ? { kind, target: answerShape.id } : kind === 'sides' ? { kind, sides: answerShape.sides } : { kind };
  const wrong = SHAPES.filter((s) => !fits(s, ask));
  const alike = wrong.filter((s) => Math.abs(s.sides - answerShape.sides) <= 1);
  const pool = [...alike, ...wrong.filter((s) => !alike.includes(s))];
  const chosen = [answerShape.id];
  for (const s of pool) { if (chosen.length >= o.choices) break; if (r() < 0.8 || pool.length - pool.indexOf(s) <= o.choices - chosen.length) chosen.push(s.id); }
  for (let i = chosen.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  return { ask, options: chosen, answer: answerShape.id, turns: chosen.map(() => (o.turnShapes ? r() * 360 : 0)), sizes: chosen.map(() => 0.7 + r() * 0.3) };
}

export const shapeById = (id: string) => SHAPES.find((s) => s.id === id)!;

function beep(freq: number, len = 0.1) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.05; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { colours: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'], box: 120 };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [n, setN] = useState(0);
  const [round, setRound] = useState<Round>(() => makeRound(0));
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const t = COPY[lang];

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  function start() { setN(0); setRound(makeRound(0)); setScore(0); setPicked(null); setPhase('play'); }
  function pick(id: string) {
    if (picked) return;
    const ok = fits(shapeById(id), round.ask), next = score + (ok ? 10 : 0);
    setPicked(id); setScore(next); beep(ok ? 880 : 200);
    setTimeout(() => {
      setPicked(null);
      if (n + 1 >= OPTIONS.rounds) {
        setPhase('over');
        setBest((b) => { const v = Math.max(b, next); try { localStorage.setItem(BEST, String(v)); } catch { /* ignore */ } return v; });
        return;
      }
      setN(n + 1); setRound(makeRound(n + 1));
    }, 1300);
  }

  const ask = round.ask;
  const question = ask.kind === 'find' ? t.find + ' ' + shapeById(ask.target)[lang] : ask.kind === 'sides' ? t.sides + ' ' + ask.sides + ' ' + t.sidesEnd : t.curved;
  const B = LOOKS.box;
  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {n + 1}/{OPTIONS.rounds}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16 }}>
          {phase === 'over' && <p>{t.over} — {t.score} {score}</p>}
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {phase === 'play' && (
        <div className="card" style={{ padding: 16 }}>
          <p style={{ fontSize: 18, textAlign: 'center' }}>{question}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {round.options.map((id, i) => {
              const s = shapeById(id), pts = s.points((B / 2 - 10) * round.sizes[i]).map(([x, y]) => x + ',' + y).join(' ');
              const ok = fits(s, ask), shown = picked !== null;
              return (
                <button key={id} onClick={() => pick(id)} aria-label={s.en} style={{ border: '3px solid ' + (shown && ok ? '#16a34a' : shown && picked === id ? '#dc2626' : ACCENT),
                  borderRadius: 12, background: 'transparent', padding: 4 }}>
                  <svg viewBox={-B / 2 + ' ' + -B / 2 + ' ' + B + ' ' + B} width="100%" style={{ maxHeight: B }}>
                    <polygon points={pts} fill={LOOKS.colours[i % LOOKS.colours.length]} transform={'rotate(' + round.turns[i] + ')'} />
                  </svg>
                  {shown && <div style={{ fontSize: 13 }}>{s[lang]}{s.sides ? ' · ' + s.sides : ''}</div>}
                </button>
              );
            })}
          </div>
          {picked && <p style={{ textAlign: 'center' }}>{fits(shapeById(picked), ask) ? t.right : t.wrong + ' ' + shapeById(picked)[lang]}</p>}
        </div>
      )}
    </div>
  );
}
`;
