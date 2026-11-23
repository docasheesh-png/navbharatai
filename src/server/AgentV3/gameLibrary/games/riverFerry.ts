// River Ferry — the library river-crossing puzzles: puzzles as data, a fewest-crossings solver for hints and stars, undo,
// and a message saying why a move is not safe.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const riverFerryAppTsx = `// __TITLE__ — get everyone across the river in a small boat without leaving the wrong pair alone together. Our own code.
// Every part is a named block below, so any of it can be changed by asking: the PUZZLES (who travels, the boat size, who
// must never be left alone with whom), the LOOKS, the COPY. Ideas studied (no code taken): classic river-crossing puzzles
// written as data so new ones are easy to add, a solver that finds the fewest crossings (for the hint and the star rating),
// undo, a clear message saying why a move is not allowed, and a move counter against the best possible.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'river-ferry-best-v1';

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Stars', best: 'Best', level: 'Puzzle', moves: 'Crossings',
    least: 'Fewest possible', cross: 'Cross', undo: 'Undo', hint: 'Hint', reset: 'Start over', boat: 'Boat', done: 'Everyone is across!',
    next: 'Next puzzle', needs: 'The boat needs the ferryman', full: 'The boat is full', unsafe: 'Not safe:', alone: 'left alone with', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'तारे', best: 'सर्वश्रेष्ठ', level: 'पहेली', moves: 'पार',
    least: 'सबसे कम संभव', cross: 'पार करो', undo: 'वापस', hint: 'संकेत', reset: 'फिर से', boat: 'नाव', done: 'सब पार हो गए!',
    next: 'अगली पहेली', needs: 'नाव को मल्लाह चाहिए', full: 'नाव भर गई', unsafe: 'सुरक्षित नहीं:', alone: 'अकेले छूटे', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── PUZZLES — 'rower' must be in the boat to cross; 'never' pairs cannot be left on a bank without the rower ─────────
export interface Puzzle { en: string; hi: string; who: { id: string; icon: string; en: string; hi: string }[]; rower: string; seats: number;
  never: [string, string][] }
export const PUZZLES: Puzzle[] = [
  { en: 'Goat, tiger and grass', hi: 'बकरी, बाघ और घास', rower: 'man', seats: 2,
    who: [{ id: 'man', icon: '🧑‍🌾', en: 'ferryman', hi: 'मल्लाह' }, { id: 'tiger', icon: '🐯', en: 'tiger', hi: 'बाघ' },
      { id: 'goat', icon: '🐐', en: 'goat', hi: 'बकरी' }, { id: 'grass', icon: '🌾', en: 'grass', hi: 'घास' }],
    never: [['tiger', 'goat'], ['goat', 'grass']] },
  { en: 'Cat, parrot and chillies', hi: 'बिल्ली, तोता और मिर्च', rower: 'man', seats: 2,
    who: [{ id: 'man', icon: '👩‍🌾', en: 'ferrywoman', hi: 'मल्लाहिन' }, { id: 'cat', icon: '🐈', en: 'cat', hi: 'बिल्ली' },
      { id: 'parrot', icon: '🦜', en: 'parrot', hi: 'तोता' }, { id: 'chilli', icon: '🌶️', en: 'chillies', hi: 'मिर्च' }],
    never: [['cat', 'parrot'], ['parrot', 'chilli']] },
  { en: 'Dog, hen, grain and mouse', hi: 'कुत्ता, मुर्गी, दाना और चूहा', rower: 'man', seats: 3,
    who: [{ id: 'man', icon: '🧑‍🌾', en: 'ferryman', hi: 'मल्लाह' }, { id: 'dog', icon: '🐕', en: 'dog', hi: 'कुत्ता' },
      { id: 'hen', icon: '🐔', en: 'hen', hi: 'मुर्गी' }, { id: 'grain', icon: '🌽', en: 'grain', hi: 'दाना' }, { id: 'mouse', icon: '🐭', en: 'mouse', hi: 'चूहा' }],
    never: [['dog', 'hen'], ['hen', 'grain'], ['mouse', 'grain'], ['hen', 'mouse']] },
];

// ── RULES — pure ────────────────────────────────────────────────────────────
/** A state: the set of ids on the FAR bank (the rest are on the near bank). The rower's side is where the boat is. */
export type State = string[];
const key = (s: State) => [...s].sort().join(',');

/** The first unsafe pair on a bank (a bank without the rower), or null when both banks are safe. */
export function unsafePair(p: Puzzle, far: State): [string, string] | null {
  const ids = p.who.map((w) => w.id), farSet = new Set(far);
  for (const side of [ids.filter((i) => farSet.has(i)), ids.filter((i) => !farSet.has(i))]) {
    if (side.includes(p.rower)) continue;
    for (const [a, b] of p.never) if (side.includes(a) && side.includes(b)) return [a, b];
  }
  return null;
}

/** Why a crossing is not allowed, or null. The load is who rides with the rower (all on the rower's bank). */
export function problem(p: Puzzle, far: State, load: string[]): 'needs' | 'full' | 'unsafe' | null {
  if (!load.includes(p.rower)) return 'needs';
  if (load.length > p.seats) return 'full';
  const rowerFar = far.includes(p.rower);
  if (load.some((id) => far.includes(id) !== rowerFar)) return 'needs';
  return unsafePair(p, cross(far, load)) ? 'unsafe' : null;
}

/** The state after the load crosses. */
export function cross(far: State, load: string[]): State {
  const s = new Set(far);
  for (const id of load) { if (s.has(id)) s.delete(id); else s.add(id); }
  return [...s];
}

/** Every allowed crossing from a state. */
export function crossings(p: Puzzle, far: State): string[][] {
  const rowerFar = far.includes(p.rower);
  const here = p.who.map((w) => w.id).filter((id) => id !== p.rower && far.includes(id) === rowerFar);
  const out: string[][] = [[p.rower]];
  const add = (start: number, load: string[]) => {
    for (let i = start; i < here.length; i++) { const l = [...load, here[i]]; if (l.length <= p.seats) { out.push(l); add(i + 1, l); } }
  };
  add(0, [p.rower]);
  return out.filter((l) => !problem(p, far, l));
}

/** The fewest crossings from a state to everyone across, as a list of loads (breadth-first search). Null if impossible. */
export function solve(p: Puzzle, far: State = []): string[][] | null {
  const goal = p.who.length, seen = new Map<string, { from: string; load: string[] } | null>([[key(far), null]]);
  const queue: State[] = [far];
  while (queue.length) {
    const s = queue.shift()!;
    if (s.length === goal) {
      const path: string[][] = []; let k = key(s);
      while (seen.get(k)) { const step = seen.get(k)!; path.unshift(step.load); k = step.from; }
      return path;
    }
    for (const load of crossings(p, s)) {
      const n = cross(s, load), nk = key(n);
      if (!seen.has(nk)) { seen.set(nk, { from: key(s), load }); queue.push(n); }
    }
  }
  return null;
}

/** Stars: 3 at the fewest crossings, 2 within a few more, else 1. */
export const starsFor = (moves: number, least: number) => (moves <= least ? 3 : moves <= least + 4 ? 2 : 1);

function beep(freq: number, len = 0.08) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.05; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { bank: '#65a30d', water: '#0ea5e9', boat: '#92400e' };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [at, setAt] = useState(0);
  const [far, setFar] = useState<State>([]);
  const [load, setLoad] = useState<string[]>([]);
  const [history, setHistory] = useState<State[]>([]);
  const [stars, setStars] = useState(0);
  const [best, setBest] = useState(0);
  const [note, setNote] = useState('');
  const t = COPY[lang];
  const p = PUZZLES[at];
  const least = (solve(p) || []).length;
  const done = far.length === p.who.length;
  const rowerFar = far.includes(p.rower);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function begin(i: number) { setAt(i); setFar([]); setLoad([]); setHistory([]); setNote(''); setPhase('play'); }
  function toggle(id: string) {
    if (done || far.includes(id) !== rowerFar) return;
    setNote(''); setLoad(load.includes(id) ? load.filter((x) => x !== id) : [...load, id]);
  }
  function go() {
    const why = problem(p, far, load);
    if (why) {
      const pair = why === 'unsafe' ? unsafePair(p, cross(far, load)) : null;
      const name = (id: string) => p.who.find((w) => w.id === id)![lang];
      setNote(why === 'unsafe' && pair ? t.unsafe + ' ' + name(pair[0]) + ' ' + t.alone + ' ' + name(pair[1]) : t[why]); beep(180, 0.25); return;
    }
    const next = cross(far, load);
    setHistory([...history, far]); setFar(next); setLoad([]); beep(500, 0.1);
    if (next.length === p.who.length) {
      const got = starsFor(history.length + 1, least); beep(990, 0.3);
      setStars((s) => { const n = s + got; setBest((b) => { const v = Math.max(b, n); try { localStorage.setItem(BEST, String(v)); } catch { /* ignore */ } return v; }); return n; });
    }
  }
  function hint() {
    const path = solve(p, far);
    if (path && path.length) { setLoad(path[0]); setNote(t.hint + ': ' + path[0].map((id) => p.who.find((w) => w.id === id)!.icon).join(' ')); }
  }

  const bank = (side: 'near' | 'far') => p.who.filter((w) => (far.includes(w.id) ? 'far' : 'near') === side && !load.includes(w.id));
  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {stars}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {at + 1}/{PUZZLES.length}</span>
        {phase === 'play' && <span className="badge">{t.moves} {history.length} · {t.least} {least}</span>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16 }}>
          {phase === 'over' && <p>{t.over} — {t.score} {stars}</p>}
          <button className="primary" onClick={() => { setStars(0); begin(0); }}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {phase === 'play' && (
        <>
          <p style={{ fontWeight: 700 }}>{p[lang]} · {t.boat} {p.seats}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', minHeight: 220, borderRadius: 12, overflow: 'hidden' }}>
            {(['near', 'water', 'far'] as const).map((side) => side === 'water' ? (
              <div key={side} style={{ background: LOOKS.water, display: 'flex', alignItems: 'center', justifyContent: rowerFar ? 'flex-end' : 'flex-start', padding: 6 }}>
                <div style={{ background: LOOKS.boat, borderRadius: '0 0 30px 30px', minWidth: 70, minHeight: 40, padding: 4, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {load.map((id) => { const w = p.who.find((x) => x.id === id)!;
                    return <button key={id} onClick={() => toggle(id)} style={{ fontSize: 26, background: 'none', border: 0 }}>{w.icon}</button>; })}
                </div>
              </div>
            ) : (
              <div key={side} style={{ background: LOOKS.bank, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 6 }}>
                {bank(side).map((w) => <button key={w.id} onClick={() => toggle(w.id)} title={w[lang]} style={{ fontSize: 30, background: 'none', border: 0 }}>{w.icon}</button>)}
              </div>
            ))}
          </div>
          <p style={{ minHeight: 22 }}>{done ? t.done : note}</p>
          <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!done && <button className="primary" style={{ background: ACCENT }} onClick={go}>{t.cross} {rowerFar ? '◀' : '▶'}</button>}
            {!done && <button className="badge" disabled={!history.length} onClick={() => { setFar(history[history.length - 1]); setHistory(history.slice(0, -1)); setLoad([]); }}>{t.undo}</button>}
            {!done && <button className="badge" onClick={hint}>{t.hint}</button>}
            {!done && <button className="badge" onClick={() => begin(at)}>{t.reset}</button>}
            {done && <button className="primary" onClick={() => (at + 1 < PUZZLES.length ? begin(at + 1) : setPhase('over'))}>{at + 1 < PUZZLES.length ? t.next : t.over}</button>}
          </div>
        </>
      )}
    </div>
  );
}
`;
