// Garden Match — the match-3 library template. Our own code: no run on a new board and always a move, a swap that slides
// back when it makes nothing, cascades shown step by step with a chain bonus, a line flower for 4 and a bomb flower for 5,
// a reshuffle when stuck, a hint after a pause, and score goals per level. Named OPTIONS / FLOWERS / COPY blocks keep every
// part editable by chat. Ideas studied (no code taken): daltonbr/Match3 (MIT), TobseF/Candy-Crush-Clone (MIT),
// LibraStack/Match3-SDK (MIT).
export const gardenMatchAppTsx = `// __TITLE__ — swap two neighbouring flowers to line up three or more of a kind. Our own code. Every part is a named block
// below, so any of it can be changed by asking: the OPTIONS (board size, kinds, moves, targets, hint delay), the FLOWERS,
// the COPY. Ideas studied (no code taken): a board that never starts with a match and always has a move, a swap that slides
// back when it makes no match, cascades with a chain bonus, special flowers for 4 and 5 in a row, a hint, and level goals.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'garden-match-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  size: 7,              // tiles per side
  kinds: 5,             // flower kinds in play (3 … 6)
  moves: 20,            // moves per level
  target: 1200,         // points to clear level 1 (each level adds half again)
  hintAfter: 5,         // seconds without a move before the hint glows (0 = never)
  stepMs: 180,          // pause between cascade steps, so the player sees each one
};

// ── FLOWERS ─────────────────────────────────────────────────────────────────
export const FLOWERS = ['🌺', '🌻', '🌼', '🪻', '🌷', '🍀'];
export const SPECIAL_LOOK = { line: '➰', bomb: '💥' } as const;

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', moves: 'Moves',
    goal: 'Goal', next: 'Next level', cleared: 'Level cleared!', chain: 'Chain', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', moves: 'चालें',
    goal: 'लक्ष्य', next: 'अगला स्तर', cleared: 'स्तर पूरा!', chain: 'लगातार', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── RULES — pure ────────────────────────────────────────────────────────────
/** kind 0…kinds-1; special 'line' clears its row and column, 'bomb' clears every flower of its kind. */
export interface Tile { kind: number; special?: 'line' | 'bomb' }
export type Grid = (Tile | null)[];
export interface Step { cleared: number[]; grid: Grid; points: number; chain: number }

export const idx = (n: number, r: number, c: number) => r * n + c;

/** Every run of 3+ in a row or column: the cells in it. */
export function findRuns(g: Grid, n: number): number[][] {
  const runs: number[][] = [];
  for (const across of [true, false]) {
    for (let a = 0; a < n; a++) {
      let run: number[] = [];
      for (let b = 0; b <= n; b++) {
        const i = b < n ? (across ? idx(n, a, b) : idx(n, b, a)) : -1;
        const t = i >= 0 ? g[i] : null, prev = run.length ? g[run[0]] : null;
        if (t && prev && t.kind === prev.kind) run.push(i);
        else { if (run.length >= 3) runs.push(run); run = t ? [i] : []; }
      }
    }
  }
  return runs;
}

/** A new board with no run already on it. */
export function newGrid(n = OPTIONS.size, kinds = OPTIONS.kinds, r: () => number = Math.random): Grid {
  for (let attempt = 0; ; attempt++) {
    if (attempt === 50) r = Math.random;               // a stuck random source can never lock the game
    const g: Grid = [];
    for (let i = 0; i < n * n; i++) {
      const row = Math.floor(i / n), col = i % n;
      let k = Math.floor(r() * kinds);
      for (let tries = 0; tries < kinds; tries++) {
        const left = col >= 2 && g[i - 1]?.kind === k && g[i - 2]?.kind === k;
        const up = row >= 2 && g[i - n]?.kind === k && g[i - 2 * n]?.kind === k;
        if (!left && !up) break;
        k = (k + 1) % kinds;
      }
      g.push({ kind: k });
    }
    if (findMove(g, n)) return g;
  }
}

const neighbours = (n: number, a: number, b: number) =>
  (Math.abs(a - b) === 1 && Math.floor(a / n) === Math.floor(b / n)) || Math.abs(a - b) === n;

const swapped = (g: Grid, a: number, b: number): Grid => { const s = g.slice(); [s[a], s[b]] = [s[b], s[a]]; return s; };

/** A swap that would make a run (for the hint), or null when the board is stuck. */
export function findMove(g: Grid, n: number): [number, number] | null {
  for (let i = 0; i < n * n; i++) for (const j of [i + 1, i + n]) {
    if (j >= n * n || !neighbours(n, i, j)) continue;
    if (g[i]?.special === 'bomb' || g[j]?.special === 'bomb') return [i, j];
    if (findRuns(swapped(g, i, j), n).length) return [i, j];
  }
  return null;
}

/**
 * Swap a and b. ok false = no run made (the screen slides them back). Otherwise steps: each clear, then the fall and new
 * flowers, chain after chain, until the board is still. A run of 4 leaves a line flower, 5 a bomb flower, where it was made.
 */
export function swapTiles(g: Grid, n: number, a: number, b: number, kinds = OPTIONS.kinds, r: () => number = Math.random):
  { ok: boolean; grid: Grid; steps: Step[]; points: number } {
  if (!neighbours(n, a, b) || !g[a] || !g[b]) return { ok: false, grid: g, steps: [], points: 0 };
  let grid = swapped(g, a, b);
  const bombAt = grid[a]?.special === 'bomb' ? a : grid[b]?.special === 'bomb' ? b : -1;
  if (bombAt < 0 && !findRuns(grid, n).length) return { ok: false, grid: g, steps: [], points: 0 };
  const steps: Step[] = [];
  let chain = 0, points = 0;
  let forced: number[] | null = null;
  if (bombAt >= 0) {
    const other = bombAt === a ? b : a, kind = grid[other]!.kind;
    forced = grid.map((t, i) => (t && (t.kind === kind || i === bombAt) ? i : -1)).filter((i) => i >= 0);
  }
  for (let guard = 0; guard < 30; guard++) {           // 30 chains is already a miracle; never loop for ever
    const runs = forced ? [forced] : findRuns(grid, n);
    if (!runs.length) break;
    chain++;
    const clear = new Set<number>();
    const makes: { at: number; tile: Tile }[] = [];
    for (const run of runs) {
      run.forEach((i) => clear.add(i));
      if (!forced && run.length >= 4) {
        const at = run.includes(a) ? a : run.includes(b) ? b : run[1];
        makes.push({ at, tile: { kind: grid[run[0]]!.kind, special: run.length >= 5 ? 'bomb' : 'line' } });
      }
    }
    // A line flower caught in a clear takes its whole row and column with it.
    for (const i of [...clear]) if (grid[i]?.special === 'line' && !makes.some((m) => m.at === i)) {
      const row = Math.floor(i / n), col = i % n;
      for (let k = 0; k < n; k++) { clear.add(idx(n, row, k)); clear.add(idx(n, k, col)); }
    }
    forced = null;
    const gained = clear.size * 10 * chain;
    points += gained;
    const after = grid.slice();
    clear.forEach((i) => { after[i] = null; });
    makes.forEach((m) => { after[m.at] = m.tile; });
    steps.push({ cleared: [...clear], grid: after, points: gained, chain });
    // Fall and refill, column by column.
    const fallen = after.slice();
    for (let c = 0; c < n; c++) {
      const col: Tile[] = [];
      for (let rr = n - 1; rr >= 0; rr--) { const t = after[idx(n, rr, c)]; if (t) col.push(t); }
      for (let rr = n - 1, k = 0; rr >= 0; rr--, k++) fallen[idx(n, rr, c)] = col[k] ?? { kind: Math.floor(r() * kinds) };
    }
    steps.push({ cleared: [], grid: fallen, points: 0, chain });
    grid = fallen;
  }
  if (!findMove(grid, n)) { grid = newGrid(n, kinds, r); steps.push({ cleared: [], grid, points: 0, chain }); }   // stuck: reshuffle
  return { ok: true, grid, steps, points };
}

export const targetFor = (level: number) => Math.round(OPTIONS.target * (1 + (level - 1) * 0.5));

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.07);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const n = OPTIONS.size;
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'busy' | 'won' | 'over'>('menu');
  const [grid, setGrid] = useState<Grid>(() => newGrid());
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [moves, setMoves] = useState(OPTIONS.moves);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const [flash, setFlash] = useState<number[]>([]);
  const [chain, setChain] = useState(0);
  const [hint, setHint] = useState<[number, number] | null>(null);
  const [shake, setShake] = useState<number[]>([]);
  const t = COPY[lang];
  const idle = useRef(0);

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play' || !OPTIONS.hintAfter) return;
    setHint(null);
    idle.current = window.setTimeout(() => setHint(findMove(grid, n)), OPTIONS.hintAfter * 1000);
    return () => window.clearTimeout(idle.current);
  }, [phase, grid]);

  function save(s: number) {
    setBest((prev) => { const next = Math.max(prev, s); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  function begin(nextLevel: number, carry: number) {
    setLevel(nextLevel); setScore(carry); setMoves(OPTIONS.moves); setGrid(newGrid()); setPicked(null); setPhase('play');
  }

  function tap(i: number) {
    if (phase !== 'play') return;
    if (picked === null || picked === i) { setPicked(picked === i ? null : i); return; }
    const a = picked; setPicked(null);
    const r = swapTiles(grid, n, a, i);
    if (!r.ok) { beep(220); setShake([a, i]); window.setTimeout(() => setShake([]), 300); return; }
    setPhase('busy'); setHint(null);
    const left = moves - 1; setMoves(left);
    let s = score;
    r.steps.forEach((step, k) => window.setTimeout(() => {
      setGrid(step.grid); setFlash(step.cleared); setChain(step.chain);
      if (step.points) { s += step.points; setScore(s); beep(520 + step.chain * 90); }
      if (k === r.steps.length - 1) {
        setFlash([]); setChain(0);
        if (s >= targetFor(level)) { save(s); setPhase('won'); beep(990); }
        else if (left <= 0) { save(s); setPhase('over'); beep(200); }
        else setPhase('play');
      }
    }, k * OPTIONS.stepMs));
  }

  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 16 }}>
      <style>{'@keyframes gm-pop{to{transform:scale(0);opacity:0}}.gm-pop{animation:gm-pop .18s forwards}'
        + '@keyframes gm-glow{50%{box-shadow:0 0 0 3px ' + ACCENT + '}}.gm-hint{animation:gm-glow 1s infinite}'
        + '@keyframes gm-no{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}.gm-no{animation:gm-no .15s 2}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.goal} {targetFor(level)}</span>
        <span className="badge">{t.moves} {moves}</span>
        <span className="badge">{t.level} {level}</span>
        <span className="badge">{t.best} {best}</span>
        {chain > 1 && <span className="badge">{t.chain} ×{chain}</span>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase === 'menu' && <button className="primary" onClick={() => begin(1, 0)}>{t.play}</button>}
      {phase === 'won' && <p>{t.cleared} <button className="primary" onClick={() => begin(level + 1, score)}>{t.next}</button></p>}
      {phase === 'over' && <p>{t.over} <button className="primary" onClick={() => begin(1, 0)}>{t.again}</button></p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + n + ', 1fr)', gap: 4, background: '#14532d', padding: 6, borderRadius: 12, userSelect: 'none' }}>
        {grid.map((tile, i) => {
          const cls = flash.includes(i) ? 'gm-pop' : shake.includes(i) ? 'gm-no' : hint && hint.includes(i) ? 'gm-hint' : undefined;
          return (
            <button key={i} className={cls} onClick={() => tap(i)}
              style={{ aspectRatio: '1', borderRadius: 8, border: 0, padding: 0, fontSize: 26, position: 'relative',
                background: picked === i ? ACCENT : '#dcfce7' }}>
              {tile ? FLOWERS[tile.kind % FLOWERS.length] : ''}
              {tile?.special && <span style={{ position: 'absolute', right: 2, top: 0, fontSize: 12 }}>{SPECIAL_LOOK[tile.special]}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
`;
