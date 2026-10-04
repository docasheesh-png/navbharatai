import { useCallback, useEffect, useRef, useState } from 'react';
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
            <Empty>No runs yet. Play a round and your scores land here.</Empty>
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
