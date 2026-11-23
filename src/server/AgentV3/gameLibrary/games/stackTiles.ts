// Stack Tiles — the slide-and-join number puzzle (library Puzzle template). Our own code: tiles that glide and pop, swipe on a
// phone, a new tile only after a real move (a 4 one time in ten), a goal tile with "keep going", undo, and colours that warm
// up as numbers grow. Named OPTIONS / TILE_COLORS / COPY blocks keep every part editable by chat. Ideas studied (no code
// taken): gabrielecirulli/2048 (MIT).
export const stackTilesAppTsx = `// __TITLE__ — slide the tiles, join two of the same number into one, reach the goal tile. Our own code. Every part is a named
// block below, so any of it can be changed by asking: the OPTIONS (board size, goal tile, the chance of a 4, undos), the
// TILE_COLORS, the COPY. Ideas studied (no code taken): tiles that glide to their new place and pop when they join, swipe
// on a phone, a new tile only after a real move, a goal with "keep going", and an undo.
import { useEffect, useRef, useState, type PointerEvent as PointerEv } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'stack-tiles-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  size: 4,              // tiles per side (3 … 6)
  goal: 2048,           // the tile that wins (play on after it if you like)
  fourChance: 0.1,      // share of new tiles that are a 4 instead of a 2
  undos: 1,             // undos per game (0 = none)
  swipeMin: 24,         // pixels a finger must move to count as a swipe
};

// ── TILE COLORS — by value; bigger numbers get warmer ───────────────────────
export const TILE_COLORS: Record<number, [bg: string, fg: string]> = {
  2: ['#eee4da', '#776e65'], 4: ['#ede0c8', '#776e65'], 8: ['#f2b179', '#ffffff'], 16: ['#f59563', '#ffffff'],
  32: ['#f67c5f', '#ffffff'], 64: ['#f65e3b', '#ffffff'], 128: ['#edcf72', '#ffffff'], 256: ['#edcc61', '#ffffff'],
  512: ['#edc850', '#ffffff'], 1024: ['#edc53f', '#ffffff'], 2048: ['#edc22e', '#ffffff'],
};
const colorOf = (v: number): [string, string] => TILE_COLORS[v] ?? [ACCENT, '#ffffff'];

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', undo: 'Undo',
    won: 'You made the goal tile!', keep: 'Keep going', lang: 'हिंदी', swipe: 'Swipe or use the arrow keys' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', undo: 'वापस',
    won: 'लक्ष्य टाइल बन गई!', keep: 'खेलते रहो', lang: 'English', swipe: 'स्वाइप करो या तीर वाली कुंजियाँ दबाओ' },
} as const;
type Lang = keyof typeof COPY;

// ── RULES — pure, so they can be tested and changed safely ──────────────────
export type Dir = 'left' | 'right' | 'up' | 'down';
/** A tile with an id, so the screen can glide it from where it was to where it is. */
export interface TileCell { id: number; value: number; row: number; col: number; merged?: boolean; fresh?: boolean }
export interface Board { size: number; tiles: TileCell[]; nextId: number }

export function emptyBoard(size = OPTIONS.size): Board { return { size, tiles: [], nextId: 1 }; }

/** A new 2 (or sometimes a 4) on a random empty square. r() is the random source (Math.random by default). */
export function spawn(b: Board, r: () => number = Math.random, fourChance = OPTIONS.fourChance): Board {
  const taken = new Set(b.tiles.map((t) => t.row * b.size + t.col));
  const empty: number[] = [];
  for (let i = 0; i < b.size * b.size; i++) if (!taken.has(i)) empty.push(i);
  if (!empty.length) return b;
  const at = empty[Math.floor(r() * empty.length)];
  const tile: TileCell = { id: b.nextId, value: r() < fourChance ? 4 : 2, row: Math.floor(at / b.size), col: at % b.size, fresh: true };
  return { ...b, tiles: [...b.tiles.map((t) => ({ ...t, fresh: false })), tile], nextId: b.nextId + 1 };
}

/**
 * Slide every tile as far as it goes toward dir; two equal tiles that meet join into one (a tile joins only once per
 * move). moved false = nothing changed (then no new tile appears). gained = the joined values added up.
 */
export function slide(b: Board, dir: Dir): { board: Board; moved: boolean; gained: number } {
  const n = b.size;
  const grid: (TileCell | null)[][] = Array.from({ length: n }, () => Array<TileCell | null>(n).fill(null));
  for (const t of b.tiles) grid[t.row][t.col] = t;
  // For each line, read cells from the side the tiles move toward.
  const cellOf = (line: number, i: number): [number, number] =>
    dir === 'left' ? [line, i] : dir === 'right' ? [line, n - 1 - i] : dir === 'up' ? [i, line] : [n - 1 - i, line];
  const out: TileCell[] = [];
  let gained = 0, moved = false, nextId = b.nextId;
  for (let line = 0; line < n; line++) {
    const row: TileCell[] = [];
    for (let i = 0; i < n; i++) { const [r, c] = cellOf(line, i); const t = grid[r][c]; if (t) row.push(t); }
    let slot = 0;
    for (let k = 0; k < row.length; k++) {
      const [r, c] = cellOf(line, slot);
      const t = row[k], u = row[k + 1];
      if (u && u.value === t.value) {
        out.push({ id: nextId++, value: t.value * 2, row: r, col: c, merged: true });
        gained += t.value * 2; moved = true; k++;
      } else {
        if (t.row !== r || t.col !== c) moved = true;
        out.push({ ...t, row: r, col: c, merged: false, fresh: false });
      }
      slot++;
    }
  }
  return { board: { size: n, tiles: out, nextId }, moved, gained };
}

/** No empty square and no two equal neighbours: nothing can move. */
export function stuck(b: Board): boolean {
  if (b.tiles.length < b.size * b.size) return false;
  return (['left', 'up'] as Dir[]).every((d) => !slide(b, d).moved);
}

export const biggest = (b: Board) => b.tiles.reduce((m, t) => Math.max(m, t.value), 0);

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = freq; g.gain.value = 0.04; osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.06);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'won' | 'over'>('menu');
  const [board, setBoard] = useState<Board>(emptyBoard());
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [history, setHistory] = useState<{ board: Board; score: number }[]>([]);
  const [undos, setUndos] = useState(OPTIONS.undos);
  const [keepGoing, setKeepGoing] = useState(false);
  const t = COPY[lang];
  const level = Math.max(1, Math.log2(Math.max(2, biggest(board))) - 2);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const live = useRef({ board, score, phase, keepGoing });
  live.current = { board, score, phase, keepGoing };

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  function save(s: number) {
    setBest((prev) => { const next = Math.max(prev, s); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  function start() {
    setBoard(spawn(spawn(emptyBoard())));
    setScore(0); setHistory([]); setUndos(OPTIONS.undos); setKeepGoing(false); setPhase('play');
  }

  function go(dir: Dir) {
    const { board: b, score: s, phase: p, keepGoing: k } = live.current;
    if (p !== 'play') return;
    const r = slide(b, dir);
    if (!r.moved) return;
    const next = spawn(r.board);
    const total = s + r.gained;
    setHistory((h) => [...h.slice(-9), { board: b, score: s }]);
    setBoard(next); setScore(total);
    beep(r.gained ? 660 : 420);
    if (!k && biggest(next) >= OPTIONS.goal) { save(total); setPhase('won'); beep(990); return; }
    if (stuck(next)) { save(total); setPhase('over'); beep(200); }
  }

  function undo() {
    if (!undos || !history.length || phase !== 'play') return;
    const last = history[history.length - 1];
    setBoard(last.board); setScore(last.score); setHistory(history.slice(0, -1)); setUndos(undos - 1);
  }

  useEffect(() => {
    const keys: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
    const onKey = (e: KeyboardEvent) => { const d = keys[e.key]; if (d) { e.preventDefault(); go(d); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onDown = (e: PointerEv) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEv) => {
    const s = swipe.current; swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < OPTIONS.swipeMin) return;
    go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  };

  const n = board.size, gap = 8, cell = 'calc((100% - ' + gap * (n + 1) + 'px) / ' + n + ')';
  const place = (i: number) => 'calc(' + gap * (i + 1) + 'px + ' + i + ' * ' + cell + ')';

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 16 }}>
      <style>{'@keyframes st-pop{0%{transform:scale(.6)}60%{transform:scale(1.12)}100%{transform:scale(1)}}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        {OPTIONS.undos > 0 && <button className="badge" onClick={undo} disabled={!undos || !history.length}>{t.undo} {undos}</button>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase === 'menu' && <button className="primary" onClick={start}>{t.play}</button>}
      {phase === 'over' && <p>{t.over} <button className="primary" onClick={start}>{t.again}</button></p>}
      {phase === 'won' && <p>{t.won} <button className="primary" onClick={() => { setKeepGoing(true); setPhase('play'); }}>{t.keep}</button> <button className="primary" onClick={start}>{t.again}</button></p>}
      <div onPointerDown={onDown} onPointerUp={onUp}
        style={{ position: 'relative', width: '100%', aspectRatio: '1', background: '#bbada0', borderRadius: 10, touchAction: 'none', userSelect: 'none' }}>
        {Array.from({ length: n * n }, (_, i) => (
          <div key={'bg' + i} style={{ position: 'absolute', left: place(i % n), top: place(Math.floor(i / n)), width: cell, height: cell, borderRadius: 6, background: 'rgba(238,228,218,0.35)' }} />
        ))}
        {board.tiles.map((tile) => {
          const [bg, fg] = colorOf(tile.value);
          return (
            <div key={tile.id} style={{
              position: 'absolute', left: place(tile.col), top: place(tile.row), width: cell, height: cell, borderRadius: 6,
              display: 'grid', placeItems: 'center', background: bg, color: fg, fontWeight: 800,
              fontSize: tile.value >= 1024 ? 20 : tile.value >= 128 ? 24 : 30,
              transition: 'left 110ms ease-out, top 110ms ease-out',
              animation: tile.merged || tile.fresh ? 'st-pop 160ms ease-out' : undefined,
            }}>{tile.value}</div>
          );
        })}
      </div>
      <p style={{ opacity: 0.7, margin: '8px 0' }}>{t.swipe}</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="primary" onClick={() => go('left')}>←</button>
        <button className="primary" onClick={() => go('up')}>↑</button>
        <button className="primary" onClick={() => go('down')}>↓</button>
        <button className="primary" onClick={() => go('right')}>→</button>
      </div>
    </div>
  );
}
`;
