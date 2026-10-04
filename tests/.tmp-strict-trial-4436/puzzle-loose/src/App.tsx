import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [best, setBest] = useState(() => {
    try { return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch { return 0; }
  });
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
