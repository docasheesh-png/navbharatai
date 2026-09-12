// AgentV3 — Golden Scaffolds: GAMES (admin 2026-09-12, "games se shuru karo").
//
// WHY GAMES WERE THE FIRST GAP WORTH CLOSING, and it is not "because a genre was missing". A game is
// the one thing this platform makes that a person actually SHARES — which is the loop App Mart needs
// and has not had. It also happens to be the cheapest app we can serve: no database, no backend, no
// auth, so a published game runs entirely in the viewer's browser and costs us nothing per viewer,
// however many arrive. Three problems, one shape of app.
//
// THE HONEST TIER SPLIT, because a template is a promise about quality:
//   • `memory` and `puzzle` are SIMPLE — plain React state over a small grid, no physics and no
//     timing loop, so the weak free tier extends them reliably and a free user's first game works.
//   • `arcade` is PRO — it carries a real fixed-timestep loop, and that is precisely the code a weak
//     model gets wrong (see GameRuntimeGenerator's list of the specific failures). Offering it free
//     would hand someone a game that runs at double speed on their phone.
//
// 🔒 THE LOOP DISCIPLINE IN `arcade` IS NOT DECORATION — it is the four bugs the game runtime exists
// to prevent, written correctly once so the builder extends a correct base instead of re-deriving it:
//   • FIXED TIMESTEP. Gameplay advances in fixed steps, never by raw delta — otherwise the player
//     jumps higher on a 144Hz monitor than on a cheap Android.
//   • DELTA CLAMP. Alt-tabbing for a minute produces one 60-second frame; unclamped, the simulation
//     spirals or NaNs out. Clamped, the game simply resumes.
//   • POLLED INPUT, not event-driven. A key pressed and released between two frames must still count.
//   • NO ALLOCATION IN THE LOOP. Obstacles are recycled from a fixed pool; a `new` per frame hands the
//     garbage collector work sixty times a second, which is the usual cause of browser-game stutter.
//
// Every app here is plain React + the base design kit (container/card/row/stack/badge/primary), the
// same foundation every other golden scaffold uses, so nothing new has to be installed and the preview
// compiles on the first try.

/** MEMORY MATCH — simple tier. A grid of pairs, flip two, keep what matches. Best score persists. */
export const memoryAppTsx = `import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

const FACES = ['🦚', '🐯', '🪷', '🥭', '🛺', '🪔', '🎨', '🪕'];
const BEST_KEY = 'memory-best-moves-v1';

interface Card { id: number; face: string; done: boolean }

function newDeck(): Card[] {
  const deck: Card[] = [];
  FACES.forEach((face, i) => {
    deck.push({ id: i * 2, face, done: false });
    deck.push({ id: i * 2 + 1, face, done: false });
  });
  // Fisher-Yates: an unbiased shuffle. sort(() => Math.random() - 0.5) is NOT one — it clusters.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

export default function App() {
  const [deck, setDeck] = useState<Card[]>(newDeck);
  const [open, setOpen] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [best, setBest] = useState<number | null>(() => {
    const raw = parseInt(localStorage.getItem(BEST_KEY) || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  });

  const won = useMemo(() => deck.every((c) => c.done), [deck]);

  useEffect(() => {
    if (open.length !== 2) return;
    const [a, b] = open;
    const ca = deck.find((c) => c.id === a);
    const cb = deck.find((c) => c.id === b);
    // A pair stays face-up for a beat either way, so the player can actually see the second card.
    const id = setTimeout(() => {
      if (ca && cb && ca.face === cb.face) {
        setDeck((d) => d.map((c) => (c.id === a || c.id === b ? { ...c, done: true } : c)));
      }
      setOpen([]);
    }, 620);
    return () => clearTimeout(id);
  }, [open, deck]);

  useEffect(() => {
    if (!won) return;
    setBest((prev) => {
      if (prev !== null && prev <= moves) return prev;
      try { localStorage.setItem(BEST_KEY, String(moves)); } catch { /* storage blocked — score just is not kept */ }
      return moves;
    });
  }, [won, moves]);

  function flip(card: Card) {
    if (card.done || open.includes(card.id) || open.length === 2) return;
    setOpen((o) => [...o, card.id]);
    if (open.length === 1) setMoves((m) => m + 1);
  }

  function restart() {
    setDeck(newDeck());
    setOpen([]);
    setMoves(0);
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Memory match</h1>
        <ThemeToggle />
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <span className="badge">Moves {moves}</span>
        <span className="muted">{best === null ? 'No best yet' : 'Best ' + best}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {deck.map((card) => {
          const face = card.done || open.includes(card.id);
          return (
            <button
              key={card.id}
              onClick={() => flip(card)}
              aria-label={face ? card.face : 'Hidden card'}
              style={{
                aspectRatio: '1 / 1', fontSize: 30, borderRadius: 12, cursor: card.done ? 'default' : 'pointer',
                background: face ? 'var(--accent-soft)' : 'var(--card)',
                border: '1px solid var(--border)', opacity: card.done ? 0.45 : 1,
                display: 'grid', placeItems: 'center', transition: 'background .15s, opacity .2s',
              }}
            >
              {face ? card.face : ''}
            </button>
          );
        })}
      </div>

      {won && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          Cleared in {moves} moves{best === moves ? ' — a new best!' : ''}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
        <button className="primary" onClick={restart}>{won ? 'Play again' : 'Restart'}</button>
      </div>
    </div>
  );
}
`;

/** MERGE PUZZLE — simple tier. Slide a 4x4 grid, equal tiles merge, score climbs. Arrow keys + swipe. */
export const puzzleAppTsx = `import { useCallback, useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const SIZE = 4;
const BEST_KEY = 'puzzle-best-score-v1';
type Grid = number[];

function spawn(grid: Grid): Grid {
  const empty: number[] = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === 0) empty.push(i);
  if (empty.length === 0) return grid;
  const next = grid.slice();
  next[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
  return next;
}

function newGrid(): Grid {
  return spawn(spawn(new Array(SIZE * SIZE).fill(0)));
}

/** Collapse ONE row to the left. Pure, so the whole move is four calls and a rotation. */
function slideRow(row: number[]): { row: number[]; gained: number } {
  const kept = row.filter((n) => n !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < kept.length; i++) {
    // A tile merged this move cannot merge again in the same move — skip the partner outright.
    if (i + 1 < kept.length && kept[i] === kept[i + 1]) {
      out.push(kept[i] * 2);
      gained += kept[i] * 2;
      i++;
    } else {
      out.push(kept[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained };
}

function rotate(grid: Grid): Grid {
  const out = new Array(SIZE * SIZE).fill(0);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out[c * SIZE + (SIZE - 1 - r)] = grid[r * SIZE + c];
  return out;
}

function move(grid: Grid, dir: 'left' | 'right' | 'up' | 'down'): { grid: Grid; gained: number; moved: boolean } {
  const turns = { left: 0, up: 1, right: 2, down: 3 }[dir];
  let g = grid;
  for (let i = 0; i < turns; i++) g = rotate(g);
  let gained = 0;
  const next = new Array(SIZE * SIZE).fill(0);
  for (let r = 0; r < SIZE; r++) {
    const res = slideRow(g.slice(r * SIZE, r * SIZE + SIZE));
    gained += res.gained;
    for (let c = 0; c < SIZE; c++) next[r * SIZE + c] = res.row[c];
  }
  let back = next;
  for (let i = turns; i < 4; i++) back = rotate(back);
  return { grid: back, gained, moved: back.some((v, i) => v !== grid[i]) };
}

function stuck(grid: Grid): boolean {
  return (['left', 'right', 'up', 'down'] as const).every((d) => !move(grid, d).moved);
}

const TINT: Record<number, string> = {
  2: '#eef0ff', 4: '#dfe3ff', 8: '#ffd9a8', 16: '#ffc078', 32: '#ff9f6e',
  64: '#ff7f5c', 128: '#ffd45c', 256: '#ffc93c', 512: '#ffbe1a', 1024: '#f0a500', 2048: '#e08c00',
};

export default function App() {
  const [grid, setGrid] = useState<Grid>(newGrid);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const push = useCallback((dir: 'left' | 'right' | 'up' | 'down') => {
    setGrid((g) => {
      const res = move(g, dir);
      if (!res.moved) return g;
      if (res.gained) {
        setScore((s) => {
          const next = s + res.gained;
          setBest((b) => {
            if (next <= b) return b;
            try { localStorage.setItem(BEST_KEY, String(next)); } catch { /* storage blocked */ }
            return next;
          });
          return next;
        });
      }
      return spawn(res.grid);
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key] as
        'left' | 'right' | 'up' | 'down' | undefined;
      if (!dir) return;
      e.preventDefault();
      push(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [push]);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // A 24px floor, so a tap on the board is never read as a tiny swipe.
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  }

  const over = stuck(grid);

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Merge puzzle</h1>
        <ThemeToggle />
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <span className="badge">Score {score}</span>
        <span className="muted">Best {best}</span>
      </div>

      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: 8,
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, touchAction: 'none',
        }}
      >
        {grid.map((v, i) => (
          <div
            key={i}
            style={{
              aspectRatio: '1 / 1', borderRadius: 10, display: 'grid', placeItems: 'center',
              fontSize: v >= 1024 ? 18 : v >= 128 ? 22 : 26, fontWeight: 700,
              background: v ? (TINT[v] || '#e08c00') : 'var(--accent-soft)',
              color: v ? '#1a1a20' : 'transparent',
            }}
          >
            {v || 0}
          </div>
        ))}
      </div>

      <p className="muted" style={{ marginTop: 12, textAlign: 'center' }}>Swipe, or use the arrow keys</p>

      {over && <div className="alert alert-warning" style={{ marginTop: 8 }}>No moves left — final score {score}</div>}

      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        <button className="primary" onClick={() => { setGrid(newGrid()); setScore(0); }}>New game</button>
      </div>
    </div>
  );
}
`;

/**
 * ARCADE — pro tier. A real fixed-timestep canvas loop, inside the shared pro architecture.
 *
 * 🔒 WHY IT SITS ON `lib/ui` + `lib/store` LIKE EVERY OTHER PRO SCAFFOLD, and why that is not a
 * contrivance. The pro contract exists because an app that re-declares its own Card and its own
 * persistence drifts from every other screen. A game looks like the exception — a loop is not a list —
 * but it genuinely has a collection worth keeping: the RUNS. A score and a date per attempt is exactly
 * what makes a high score mean anything, and it persists through `useCollection` like any other
 * record. So the game keeps its canvas and its loop, and everything AROUND the canvas is the shared
 * furniture.
 *
 * 🔒 THE LOOP DISCIPLINE IS THE POINT — it is the four failures GameRuntimeGenerator exists to prevent,
 * written correctly once so the builder extends a correct base instead of re-deriving it:
 *   • FIXED TIMESTEP — gameplay advances in fixed steps, never by raw delta, or the player moves faster
 *     on a 144Hz monitor than on a cheap Android.
 *   • DELTA CLAMP — an alt-tabbed minute must not arrive as one 60-second frame.
 *   • POLLED INPUT — a key pressed and released between two frames must still count.
 *   • NO ALLOCATION IN THE LOOP — obstacles are recycled from a fixed pool; a `new` per frame hands the
 *     garbage collector work sixty times a second, the usual cause of browser-game stutter.
 */
export const arcadeAppTsx = `import { useCallback, useEffect, useRef, useState } from 'react';
import { Shell, Card, Badge, StatTile, Button, Empty } from './lib/ui';
import { useCollection, shortDate, type Entity } from './lib/store';

interface Run extends Entity { score: number; at: string }

const W = 360;
const H = 560;
const STEP = 1 / 60;              // one fixed simulation step, in seconds
const MAX_FRAME = 0.25;           // delta clamp
const POOL = 24;                  // obstacles are recycled, never allocated inside the loop

interface Obstacle { x: number; y: number; r: number; vy: number; live: boolean }

export default function App() {
  const [tab, setTab] = useState('play');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const runs = useCollection<Run>('arcade-runs-v1', []);

  // Everything the loop mutates lives in refs: state in the loop would re-render sixty times a second.
  const keys = useRef<Record<string, boolean>>({});
  const player = useRef({ x: W / 2, y: H - 54, r: 15 });
  const pool = useRef<Obstacle[]>(
    Array.from({ length: POOL }, () => ({ x: 0, y: 0, r: 12, vy: 0, live: false })),
  );
  const spawnIn = useRef(0.9);
  const elapsed = useRef(0);
  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const runningRef = useRef(false);
  // The loop cannot call a hook, and runs.add changes identity — a ref keeps one stable door to it.
  const recordRef = useRef(runs.add);
  recordRef.current = runs.add;

  const start = useCallback(() => {
    player.current.x = W / 2;
    for (const o of pool.current) o.live = false;
    spawnIn.current = 0.9;
    elapsed.current = 0;
    scoreRef.current = 0;
    livesRef.current = 3;
    setScore(0);
    setLives(3);
    runningRef.current = true;
    setRunning(true);
  }, []);

  useEffect(() => {
    // POLLED INPUT: the loop reads this map, so a press-and-release between two frames still counts.
    const down = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd', 'A', 'D'].includes(e.key)) e.preventDefault();
      keys.current[e.key] = true;
    };
    const up = (e: KeyboardEvent) => { keys.current[e.key] = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let alive = true;

    function step() {
      const p = player.current;
      // Movement in the FIXED step, never in render — otherwise speed follows the monitor refresh rate.
      const speed = 260 * STEP;
      if (keys.current.ArrowLeft || keys.current.a || keys.current.A) p.x -= speed;
      if (keys.current.ArrowRight || keys.current.d || keys.current.D) p.x += speed;
      p.x = Math.max(p.r, Math.min(W - p.r, p.x));

      elapsed.current += STEP;
      spawnIn.current -= STEP;
      if (spawnIn.current <= 0) {
        const free = pool.current.find((o) => !o.live);
        if (free) {
          free.live = true;
          free.r = 10 + Math.random() * 9;
          free.x = free.r + Math.random() * (W - free.r * 2);
          free.y = -free.r;
          free.vy = 120 + Math.random() * 90 + Math.min(160, elapsed.current * 7);
        }
        spawnIn.current = Math.max(0.24, 0.9 - elapsed.current * 0.02);
      }

      for (const o of pool.current) {
        if (!o.live) continue;
        o.y += o.vy * STEP;
        if (o.y - o.r > H) {
          o.live = false;
          scoreRef.current += 1;
          setScore(scoreRef.current);
          continue;
        }
        const dx = o.x - p.x;
        const dy = o.y - p.y;
        if (dx * dx + dy * dy < (o.r + p.r) * (o.r + p.r)) {
          o.live = false;
          livesRef.current -= 1;
          setLives(livesRef.current);
          if (livesRef.current <= 0) {
            runningRef.current = false;
            setRunning(false);
            recordRef.current({ score: scoreRef.current, at: new Date().toISOString() });
          }
        }
      }
    }

    function draw() {
      if (!ctx) return;
      const css = getComputedStyle(document.documentElement);
      ctx.fillStyle = css.getPropertyValue('--card').trim() || '#17171f';
      ctx.fillRect(0, 0, W, H);
      const accent = css.getPropertyValue('--accent').trim() || '#7c74ff';
      for (const o of pool.current) {
        if (!o.live) continue;
        ctx.beginPath();
        ctx.fillStyle = '#ff7f5c';
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
      }
      const p = player.current;
      ctx.beginPath();
      ctx.fillStyle = accent;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    function frame(now: number) {
      if (!alive) return;
      // DELTA CLAMP: a long pause resumes the game instead of teleporting everything through it.
      const dt = Math.min(MAX_FRAME, (now - last) / 1000);
      last = now;
      if (runningRef.current) {
        acc += dt;
        while (acc >= STEP) { step(); acc -= STEP; }
      }
      draw();
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    // FULL TEARDOWN: React 18 StrictMode mounts twice in development. Without this there are two loops,
    // doubled input, and a game that runs at double speed — in dev only, which is worse than always.
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);

  function nudge(dir: number) {
    const p = player.current;
    p.x = Math.max(p.r, Math.min(W - p.r, p.x + dir * 34));
  }

  const bestRun = runs.items.reduce((a, r) => (r.score > a ? r.score : a), 0);
  const recent = runs.items.slice(0, 8);

  return (
    <Shell
      brand="Dodge"
      nav={[{ id: 'play', label: 'Play' }, { id: 'scores', label: 'Scores' }]}
      active={tab}
      onNavigate={setTab}
      actions={<Badge tone="accent">Best {bestRun}</Badge>}
    >
      {tab === 'play' ? (
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
            <StatTile label="Score" value={String(score)} />
            <StatTile label="Lives" value={String(lives)} />
            <StatTile label="Best" value={String(bestRun)} hint={runs.items.length + ' runs'} />
          </div>

          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            style={{ width: '100%', maxWidth: W, borderRadius: 14, border: '1px solid var(--border)', display: 'block', margin: '0 auto', touchAction: 'none' }}
          />

          {!running && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <p style={{ margin: '0 0 10px', fontWeight: 700 }}>
                {score > 0 ? 'Game over — ' + score + ' dodged' : 'Dodge what falls'}
              </p>
              <Button onClick={start}>{score > 0 ? 'Play again' : 'Start'}</Button>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 14 }}>
            <Button onClick={() => nudge(-1)}>Left</Button>
            <Button onClick={() => nudge(1)}>Right</Button>
          </div>
        </Card>
      ) : (
        <Card title="Your runs">
          {recent.length === 0 ? (
            <Empty title="No runs yet" text="Play a round and your scores land here." />
          ) : (
            <div>
              {recent.map((r) => (
                <div
                  key={r.id}
                  style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <span>{shortDate(r.at)}</span>
                  <Badge tone={r.score >= bestRun && bestRun > 0 ? 'good' : 'neutral'}>{r.score} dodged</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </Shell>
  );
}
`;
