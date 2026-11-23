// Drum Row — the library drum machine and copy-the-rhythm game: browser-made drums, a step grid scheduled on the audio
// clock with swing, a playhead, levels that add drums, right / missed / extra scoring, and free play.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const drumRowAppTsx = `// __TITLE__ — a drum machine and a listening game: hear a rhythm, then build it on the grid and see how close you got. Or
// just make your own beats. Our own code. Every part is a named block below, so any of it can be changed by asking: the
// OPTIONS (steps, tempo, swing), the DRUMS (each sound is made by the browser — no files), the RHYTHMS to copy (written as
// text), the LOOKS, the COPY. Ideas studied (no code taken): a step grid where each row is one drum, sounds scheduled ahead
// on the audio clock so the beat never drifts, swing on the off-steps, a moving playhead, levels that add drums, and a
// score that counts right hits and wrong ones.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'drum-row-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  steps: 16,
  bpm: 96,
  swing: 0.12,          // 0 = straight; pushes every second step later by this share of a step
  listenLoops: 2,       // times the rhythm plays before you build it
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', listen: 'Listen',
    check: 'Check', next: 'Next rhythm', free: 'Free play', stop: 'Stop', clear: 'Clear', hint: 'Listen, then tap the grid to copy it',
    match: 'Match', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', listen: 'सुनो',
    check: 'जाँचो', next: 'अगली ताल', free: 'खुला बजाओ', stop: 'रोको', clear: 'साफ़', hint: 'सुनो, फिर ग्रिड पर टैप करके वैसी ही बनाओ',
    match: 'मेल', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── DRUMS — made with the browser's sound tools ──────────────────────────────
export const DRUMS = [
  { id: 'kick', en: 'Kick', hi: 'धम', colour: '#ef4444' },
  { id: 'snare', en: 'Snare', hi: 'चट', colour: '#f59e0b' },
  { id: 'hat', en: 'Hi-hat', hi: 'छन', colour: '#22c55e' },
  { id: 'clap', en: 'Clap', hi: 'ताली', colour: '#38bdf8' },
] as const;

function playDrum(ctx: AudioContext, drum: number, at: number) {
  const out = ctx.createGain(); out.connect(ctx.destination);
  if (drum === 0) {                                                    // kick: a falling sine
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.15);
    out.gain.setValueAtTime(0.5, at); out.gain.exponentialRampToValueAtTime(0.001, at + 0.25); o.connect(out); o.start(at); o.stop(at + 0.3);
    return;
  }
  const len = drum === 2 ? 0.05 : drum === 1 ? 0.15 : 0.12;           // snare / hat / clap: shaped noise
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const filter = ctx.createBiquadFilter(); filter.type = drum === 2 ? 'highpass' : 'bandpass'; filter.frequency.value = drum === 2 ? 7000 : drum === 1 ? 1800 : 1200;
  out.gain.setValueAtTime(drum === 2 ? 0.15 : 0.35, at); out.gain.exponentialRampToValueAtTime(0.001, at + len);
  src.connect(filter); filter.connect(out); src.start(at);
}

// ── RHYTHMS — one line per drum (kick, snare, hat, clap), x = hit, . = rest; level = drums used ─────────────────
export const RHYTHMS: { level: number; lines: string[] }[] = [
  { level: 1, lines: ['x...x...x...x...', '................', '................', '................'] },
  { level: 1, lines: ['x.......x.x.....', '................', '................', '................'] },
  { level: 2, lines: ['x.......x.......', '....x.......x...', '................', '................'] },
  { level: 2, lines: ['x..x....x.......', '....x.......x..x', '................', '................'] },
  { level: 3, lines: ['x.......x.......', '....x.......x...', 'x.x.x.x.x.x.x.x.', '................'] },
  { level: 3, lines: ['x..x..x...x.....', '....x.......x...', '..x...x...x...x.', '................'] },
  { level: 4, lines: ['x.......x.x.....', '....x.......x...', 'x.x.x.x.x.x.x.x.', '............x...'] },
  { level: 4, lines: ['x..x...xx.......', '....x.......x...', '.x.x.x.x.x.x.x.x', '....x.......x..x'] },
];

// ── RULES — pure ────────────────────────────────────────────────────────────
export type Grid = boolean[][];                       // grid[drum][step]
export const emptyGrid = (o = OPTIONS): Grid => DRUMS.map(() => Array(o.steps).fill(false));
export const parse = (lines: string[]): Grid => lines.map((l) => l.split('').map((c) => c === 'x'));

/** When each step sounds, in seconds from the bar start (with swing on every second step). */
export function stepTimes(o = OPTIONS): number[] {
  const step = 60 / o.bpm / 4;
  return Array.from({ length: o.steps }, (_, i) => i * step + (i % 2 ? o.swing * step : 0));
}

/** How close a copy is: right hits, missed hits and extra hits; score = right − extra, as a share of the hits. */
export function compare(target: Grid, mine: Grid): { right: number; missed: number; extra: number; score: number } {
  let right = 0, missed = 0, extra = 0;
  target.forEach((row, d) => row.forEach((on, s) => {
    const m = !!mine[d]?.[s];
    if (on && m) right++; else if (on) missed++; else if (m) extra++;
  }));
  const total = right + missed;
  return { right, missed, extra, score: total ? Math.max(0, (right - extra) / total) : 0 };
}

/** The next rhythm for a level, never the same as the last one. */
export function pickRhythm(level: number, last: number, r: () => number = Math.random): number {
  const ids = RHYTHMS.map((_, i) => i).filter((i) => RHYTHMS[i].level === Math.min(4, level) && i !== last);
  const pool = ids.length ? ids : RHYTHMS.map((_, i) => i).filter((i) => i !== last);
  return pool[Math.floor(r() * pool.length) % pool.length];
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { off: '#1e293b', beat: '#334155', head: ACCENT };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'listen' | 'build' | 'result' | 'free' | 'over'>('menu');
  const [grid, setGrid] = useState<Grid>(emptyGrid());
  const [target, setTarget] = useState(0);
  const [level, setLevel] = useState(1);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [last, setLast] = useState<ReturnType<typeof compare> | null>(null);
  const [head, setHead] = useState(-1);
  const t = COPY[lang];
  const audio = useRef<AudioContext | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
    return () => clearInterval(timer.current);
  }, []);

  /** Play a grid: schedule every hit on the audio clock (loops times), and move the playhead with the clock. */
  function play(g: Grid, loops: number, after?: () => void) {
    clearInterval(timer.current);
    try { audio.current = audio.current || new AudioContext(); } catch { audio.current = null; }
    const ctx = audio.current, times = stepTimes(), bar = (60 / OPTIONS.bpm) * (OPTIONS.steps / 4);
    const t0 = ctx ? ctx.currentTime + 0.1 : performance.now() / 1000;
    if (ctx) for (let l = 0; l < loops; l++) g.forEach((row, d) => row.forEach((on, s) => { if (on) playDrum(ctx, d, t0 + l * bar + times[s]); }));
    timer.current = window.setInterval(() => {
      const el = (ctx ? ctx.currentTime : performance.now() / 1000) - t0;
      if (el >= loops * bar) { clearInterval(timer.current); setHead(-1); after?.(); return; }
      const inBar = el % bar; let s = 0; while (s + 1 < times.length && times[s + 1] <= inBar) s++;
      setHead(el < 0 ? -1 : s);
    }, 30);
  }

  function listen(id: number) { setPhase('listen'); play(parse(RHYTHMS[id].lines), OPTIONS.listenLoops, () => setPhase('build')); }
  function start() { const id = pickRhythm(1, -1); setTarget(id); setLevel(1); setRound(1); setScore(0); setGrid(emptyGrid()); listen(id); }
  function check() {
    const res = compare(parse(RHYTHMS[target].lines), grid), got = Math.round(res.score * 100);
    setLast(res); setScore(score + got); setPhase('result');
    play(grid, 1);
  }
  function next() {
    if (round >= 8) {
      setPhase('over');
      setBest((b) => { const n = Math.max(b, score); try { localStorage.setItem(BEST, String(n)); } catch { /* ignore */ } return n; });
      return;
    }
    const lv = 1 + Math.floor(round / 2), id = pickRhythm(lv, target);
    setRound(round + 1); setLevel(lv); setTarget(id); setGrid(emptyGrid()); listen(id);
  }
  const toggle = (d: number, s: number) => {
    if (phase !== 'build' && phase !== 'free') return;
    setGrid((g) => g.map((row, i) => (i === d ? row.map((v, j) => (j === s ? !v : v)) : row)));
    if (audio.current) playDrum(audio.current, d, audio.current.currentTime);
  };

  const shown = phase === 'listen' ? parse(RHYTHMS[target].lines).map((r) => r.map(() => false)) : grid;
  const want = phase === 'result' ? parse(RHYTHMS[target].lines) : null;
  const usedDrums = phase === 'free' ? DRUMS.length : Math.max(1, RHYTHMS[target]?.level || 1);
  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level} · {round}/8</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {(phase === 'menu' || phase === 'over') && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <p>{phase === 'over' ? t.over + ' — ' + t.score + ' ' + score : t.hint}</p>
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>{' '}
          <button className="badge" onClick={() => { setGrid(emptyGrid()); setPhase('free'); }}>{t.free}</button>
        </div>
      )}
      <div style={{ display: 'grid', gap: 4 }}>
        {DRUMS.slice(0, usedDrums).map((drum, d) => (
          <div key={drum.id} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <span style={{ width: 46, fontSize: 12 }}>{drum[lang]}</span>
            {shown[d].map((on, s) => {
              const missed = want && want[d][s] && !on, extra = want && !want[d][s] && on;
              return <button key={s} onClick={() => toggle(d, s)} aria-label={drum.en + ' ' + (s + 1)}
                style={{ flex: 1, height: 30, minWidth: 0, padding: 0, border: s === head ? '2px solid ' + LOOKS.head : '1px solid #0f172a', borderRadius: 4,
                  background: on ? (extra ? '#64748b' : drum.colour) : missed ? drum.colour + '44' : s % 4 === 0 ? LOOKS.beat : LOOKS.off }} />;
            })}
          </div>
        ))}
      </div>
      <div className="row" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {phase === 'build' && <button className="badge" onClick={() => listen(target)}>{t.listen}</button>}
        {phase === 'build' && <button className="primary" onClick={check}>{t.check}</button>}
        {phase === 'result' && last && <span className="badge">{t.match} {Math.round(last.score * 100)}% · ✓{last.right} ✗{last.missed} +{last.extra}</span>}
        {phase === 'result' && <button className="primary" onClick={next}>{t.next}</button>}
        {phase === 'free' && <button className="primary" onClick={() => play(grid, 4)}>{t.play}</button>}
        {phase === 'free' && <button className="badge" onClick={() => { clearInterval(timer.current); setHead(-1); }}>{t.stop}</button>}
        {phase === 'free' && <button className="badge" onClick={() => setGrid(emptyGrid())}>{t.clear}</button>}
        {phase === 'free' && <button className="badge" onClick={() => setPhase('menu')}>✕</button>}
      </div>
    </div>
  );
}
`;
