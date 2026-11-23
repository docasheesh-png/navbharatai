// Trail Walk — the open-world library template: explore a seeded map on foot and find every relic before night. Our own
// code: a follow camera, a world from patches of lakes and woods, a trail that guarantees every relic can be reached
// (bridges over water), paths faster than grass, a minimap with fog of war, compass hints and a day/night clock.
// Named OPTIONS / TILES / COPY blocks keep every part editable by chat. Ideas studied (no code taken): brunosimon/folio-2019
// (MIT) and pmndrs/ecctrl (MIT) for the follow camera and exploration feel.
export const trailWalkAppTsx = `// __TITLE__ — explore a hand-sized open world on foot, in our own code. Every part is a named block below, so any of it can
// be changed by asking: the OPTIONS (map size, relics, hints, day length, speeds), the TILES and their colours, the COPY.
// Ideas studied (no code taken): a camera that follows the walker, things to find spread over the map, a minimap with
// fog of war, a compass hint, paths that are faster than grass, and a day that turns to night.
import { useEffect, useRef, useState, type PointerEvent as PointerEv } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'trail-walk-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  mapSize: 40,          // tiles per side on level 1 (each level adds 8, up to 72)
  relics: 6,            // things to find on level 1 (each level adds 2)
  hints: 3,             // compass hints per level
  dayLength: 120,       // seconds from morning to night
  walkSpeed: 4,         // tiles a second on grass
  pathBonus: 1.5,       // speed × this on a path or a bridge
  tile: 32,             // pixels per tile on screen
  seed: 0,              // 0 = a new world each game; any other number = always the same world
};

// ── TILES ───────────────────────────────────────────────────────────────────
export type Tile = 'grass' | 'flowers' | 'path' | 'water' | 'bridge' | 'tree' | 'rock';
export const TILE_COLORS: Record<Tile, string> = {
  grass: '#4ade80', flowers: '#86efac', path: '#d6b98c', water: '#38bdf8', bridge: '#a16207', tree: '#166534', rock: '#78716c',
};
export const BLOCKED: ReadonlySet<Tile> = new Set<Tile>(['water', 'tree', 'rock']);

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', found: 'Found',
    hint: 'Compass', next: 'Next level', time: 'Day', lang: 'हिंदी', up: 'Up', down: 'Down', left: 'Left', right: 'Right', done: 'All relics found!' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', found: 'मिले',
    hint: 'दिशा', next: 'अगला स्तर', time: 'दिन', lang: 'English', up: 'ऊपर', down: 'नीचे', left: 'बाएँ', right: 'दाएँ', done: 'सब मिल गए!' },
} as const;
type Lang = keyof typeof COPY;

// ── WORLD — made from a seed, every relic reachable ─────────────────────────
export interface Spot { x: number; y: number }
export interface World { size: number; tiles: Tile[]; start: Spot; relics: Spot[] }

export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Smooth noise 0…1 from a coarse random grid, so lakes and woods come in patches, not salt and pepper. */
function patches(size: number, cell: number, r: () => number): (x: number, y: number) => number {
  const n = Math.ceil(size / cell) + 2, grid = Array.from({ length: n * n }, () => r());
  const at = (i: number, j: number) => grid[Math.min(n - 1, j) * n + Math.min(n - 1, i)];
  return (x, y) => {
    const fx = x / cell, fy = y / cell, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

export const tileAt = (w: World, x: number, y: number): Tile =>
  x < 0 || y < 0 || x >= w.size || y >= w.size ? 'rock' : w.tiles[Math.floor(y) * w.size + Math.floor(x)];
export const walkable = (w: World, x: number, y: number) => !BLOCKED.has(tileAt(w, x, y));

/** Tiles reachable on foot from a spot (breadth-first). */
export function reachable(w: World, from: Spot): Set<number> {
  const seen = new Set<number>([from.y * w.size + from.x]), queue = [from];
  while (queue.length) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx, y = p.y + dy, k = y * w.size + x;
      if (x < 0 || y < 0 || x >= w.size || y >= w.size || seen.has(k) || !walkable(w, x, y)) continue;
      seen.add(k); queue.push({ x, y });
    }
  }
  return seen;
}

/** Carve a path from a to b: an L-shaped trail; over water it becomes a bridge, through trees and rocks it clears them. */
function carve(tiles: Tile[], size: number, a: Spot, b: Spot) {
  const lay = (x: number, y: number) => { const k = y * size + x; tiles[k] = tiles[k] === 'water' || tiles[k] === 'bridge' ? 'bridge' : 'path'; };
  let x = a.x, y = a.y;
  while (x !== b.x) { lay(x, y); x += Math.sign(b.x - x); }
  while (y !== b.y) { lay(x, y); y += Math.sign(b.y - y); }
  lay(x, y);
}

export function generateWorld(seed: number, size = OPTIONS.mapSize, relicCount = OPTIONS.relics): World {
  const r = rng(seed), lakes = patches(size, 9, r), woods = patches(size, 5, r);
  const tiles: Tile[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    const l = lakes(x, y), t = woods(x, y), q = r();
    tiles.push(edge ? 'tree' : l > 0.72 ? 'water' : t > 0.66 && q < 0.7 ? 'tree' : q < 0.02 ? 'rock' : q < 0.08 ? 'flowers' : 'grass');
  }
  const start = { x: Math.floor(size / 2), y: Math.floor(size / 2) };
  // Relics spread out: each one the farthest of a few random tries from those already placed.
  const relics: Spot[] = [];
  for (let i = 0; i < relicCount; i++) {
    let best: Spot | null = null, bestD = -1;
    for (let k = 0; k < 12; k++) {
      const p = { x: 2 + Math.floor(r() * (size - 4)), y: 2 + Math.floor(r() * (size - 4)) };
      const d = Math.min(...[start, ...relics].map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
      if (d > bestD) { bestD = d; best = p; }
    }
    relics.push(best!);
  }
  // A trail from the start to each relic, so every one can be reached (and the trail shows the way).
  let from = start;
  for (const p of [...relics].sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y))) {
    carve(tiles, size, from, p); from = p;
  }
  return { size, tiles, start, relics };
}

// ── THE WALKER ──────────────────────────────────────────────────────────────
export interface Walker { x: number; y: number; facing: number }

/** One step: move by the input direction, faster on a path, sliding along anything blocked (never through it). */
export function stepWalker(p: Walker, dir: Spot, w: World, dt: number, o = OPTIONS): Walker {
  const len = Math.hypot(dir.x, dir.y);
  if (len < 0.01) return p;
  const here = tileAt(w, p.x, p.y);
  const speed = o.walkSpeed * (here === 'path' || here === 'bridge' ? o.pathBonus : 1);
  const dx = (dir.x / len) * speed * Math.max(0, Math.min(0.1, dt)), dy = (dir.y / len) * speed * Math.max(0, Math.min(0.1, dt));
  const R = 0.3;
  const free = (x: number, y: number) => walkable(w, x - R, y - R) && walkable(w, x + R, y - R) && walkable(w, x - R, y + R) && walkable(w, x + R, y + R);
  let x = p.x, y = p.y;
  if (free(x + dx, y)) x += dx;
  if (free(x, y + dy)) y += dy;
  return { x, y, facing: Math.atan2(dir.y, dir.x) };
}

/** The nearest relic still to find, its distance and its compass direction (radians, 0 = east, y down). */
export function nearestRelic(p: Spot, relics: Spot[]): { relic: Spot; distance: number; angle: number } | null {
  let best: Spot | null = null, d = Infinity;
  for (const r of relics) { const k = Math.hypot(r.x + 0.5 - p.x, r.y + 0.5 - p.y); if (k < d) { d = k; best = r; } }
  return best ? { relic: best, distance: d, angle: Math.atan2(best.y + 0.5 - p.y, best.x + 0.5 - p.x) } : null;
}

/** Light at a time of day (0 = morning … 1 = night): 1 by day, down to 0.45 at night. */
export const daylight = (t: number) => 1 - 0.55 * Math.max(0, Math.min(1, (t - 0.6) / 0.4));

// ── DRAW ────────────────────────────────────────────────────────────────────
function draw(ctx: CanvasRenderingContext2D, cw: number, ch: number, w: World, p: Walker, relics: Spot[], seen: Uint8Array, dayT: number, compass: number | null) {
  const T = OPTIONS.tile;
  const camX = Math.max(0, Math.min(w.size * T - cw, p.x * T - cw / 2)), camY = Math.max(0, Math.min(w.size * T - ch, p.y * T - ch / 2));
  const x0 = Math.floor(camX / T), y0 = Math.floor(camY / T);
  for (let y = y0; y <= y0 + Math.ceil(ch / T) + 1 && y < w.size; y++) for (let x = x0; x <= x0 + Math.ceil(cw / T) + 1 && x < w.size; x++) {
    const tile = w.tiles[y * w.size + x], sx = x * T - camX, sy = y * T - camY;
    ctx.fillStyle = TILE_COLORS[tile === 'tree' || tile === 'rock' ? 'grass' : tile]; ctx.fillRect(sx, sy, T + 1, T + 1);
    if (tile === 'tree') { ctx.fillStyle = TILE_COLORS.tree; ctx.beginPath(); ctx.arc(sx + T / 2, sy + T / 2, T * 0.45, 0, Math.PI * 2); ctx.fill(); }
    if (tile === 'rock') { ctx.fillStyle = TILE_COLORS.rock; ctx.beginPath(); ctx.ellipse(sx + T / 2, sy + T * 0.6, T * 0.4, T * 0.28, 0, 0, Math.PI * 2); ctx.fill(); }
    if (tile === 'bridge') { ctx.strokeStyle = '#713f12'; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(sx, sy + (i * T) / 4); ctx.lineTo(sx + T, sy + (i * T) / 4); ctx.stroke(); } }
    if (tile === 'flowers') { ctx.fillStyle = '#f472b6'; ctx.fillRect(sx + T * 0.3, sy + T * 0.3, 4, 4); ctx.fillRect(sx + T * 0.65, sy + T * 0.6, 4, 4); }
  }
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 250);
  for (const r of relics) {
    const sx = (r.x + 0.5) * T - camX, sy = (r.y + 0.5) * T - camY;
    ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(sx, sy, T * (0.22 + 0.06 * pulse), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a16207'; ctx.stroke();
  }
  // The walker: body, and a nose that shows which way he faces.
  const px = p.x * T - camX, py = p.y * T - camY;
  ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(px, py, T * 0.32, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.lineWidth = 1;    // stands out on any ground
  ctx.fillStyle = '#fef3c7'; ctx.beginPath(); ctx.arc(px + Math.cos(p.facing) * T * 0.2, py + Math.sin(p.facing) * T * 0.2, T * 0.1, 0, Math.PI * 2); ctx.fill();
  // Evening and night.
  const light = daylight(dayT);
  if (light < 1) { ctx.fillStyle = 'rgba(15,23,42,' + (1 - light).toFixed(2) + ')'; ctx.fillRect(0, 0, cw, ch); }
  // The compass.
  if (compass !== null) {
    ctx.save(); ctx.translate(cw - 34, 34); ctx.rotate(compass);
    ctx.fillStyle = 'rgba(15,23,42,0.6)'; ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.fill();
    ctx.restore();
  }
  // The minimap: only what has been seen.
  const m = 2, mw = w.size * m, mx = 8, my = ch - mw - 8;
  ctx.fillStyle = 'rgba(15,23,42,0.7)'; ctx.fillRect(mx - 2, my - 2, mw + 4, mw + 4);
  for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) {
    if (!seen[y * w.size + x]) continue;
    ctx.fillStyle = TILE_COLORS[w.tiles[y * w.size + x]]; ctx.fillRect(mx + x * m, my + y * m, m, m);
  }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(mx + p.x * m - 1.5, my + p.y * m - 1.5, 3, 3);
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = freq; g.gain.value = 0.04; osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.08);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'won' | 'over'>('menu');
  const [level, setLevel] = useState(1);
  const [hud, setHud] = useState({ score: 0, found: 0, total: OPTIONS.relics, hints: OPTIONS.hints, day: 0 });
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const dir = useRef<Spot>({ x: 0, y: 0 });
  const held = useRef(new Set<string>());
  const hintAsk = useRef(false);
  const total = useRef(0);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const keys: Record<string, string> = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
    const sync = () => {
      const h = held.current;
      dir.current = { x: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0), y: (h.has('down') ? 1 : 0) - (h.has('up') ? 1 : 0) };
    };
    const down = (e: KeyboardEvent) => { const k = keys[e.key]; if (k) { held.current.add(k); sync(); e.preventDefault(); } if (e.key === 'h') hintAsk.current = true; };
    const up = (e: KeyboardEvent) => { const k = keys[e.key]; if (k) { held.current.delete(k); sync(); } };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  function save(score: number) {
    setBest((prev) => { const next = Math.max(prev, score); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const size = Math.min(72, OPTIONS.mapSize + (level - 1) * 8), count = OPTIONS.relics + (level - 1) * 2;
    const world = generateWorld(OPTIONS.seed || Math.floor(Math.random() * 1e9), size, count);
    let walker: Walker = { x: world.start.x + 0.5, y: world.start.y + 0.5, facing: 0 };
    let relics = [...world.relics], hints = OPTIONS.hints, compassUntil = 0, dayT = 0, last = performance.now(), raf = 0, running = true;
    const seen = new Uint8Array(size * size);
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      walker = stepWalker(walker, dir.current, world, dt);
      dayT += dt / OPTIONS.dayLength;
      for (let y = -5; y <= 5; y++) for (let x = -5; x <= 5; x++) {
        const tx = Math.floor(walker.x) + x, ty = Math.floor(walker.y) + y;
        if (tx >= 0 && ty >= 0 && tx < size && ty < size && x * x + y * y <= 25) seen[ty * size + tx] = 1;
      }
      const got = relics.filter((r) => Math.hypot(r.x + 0.5 - walker.x, r.y + 0.5 - walker.y) < 0.7);
      if (got.length) { relics = relics.filter((r) => !got.includes(r)); total.current += got.length * 100; beep(880); }
      if (hintAsk.current) { hintAsk.current = false; if (hints > 0 && relics.length) { hints--; compassUntil = now + 6000; beep(520); } }
      const near = nearestRelic(walker, relics);
      draw(ctx, c.width, c.height, world, walker, relics, seen, dayT, now < compassUntil && near ? near.angle : null);
      setHud({ score: total.current, found: count - relics.length, total: count, hints, day: Math.min(100, Math.round(dayT * 100)) });
      if (!relics.length) {
        running = false; total.current += Math.round(Math.max(0, 1 - dayT) * 200) + hints * 25; save(total.current);
        setHud((h) => ({ ...h, score: total.current })); setPhase('won'); beep(990); return;
      }
      if (dayT >= 1) { running = false; save(total.current); setPhase('over'); beep(200); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, [phase, level]);

  const pad = (k: string) => ({
    onPointerDown: (e: PointerEv) => { e.preventDefault(); held.current.add(k); dir.current = padDir(held.current); },
    onPointerUp: () => { held.current.delete(k); dir.current = padDir(held.current); },
    onPointerLeave: () => { held.current.delete(k); dir.current = padDir(held.current); },
    onPointerCancel: () => { held.current.delete(k); dir.current = padDir(held.current); },
  });

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {hud.score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        <span className="badge">{t.found} {hud.found}/{hud.total}</span>
        <span className="badge">{t.time} {hud.day}%</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase === 'menu' && <button className="primary" onClick={() => { total.current = 0; setPhase('play'); }}>{t.play}</button>}
      {phase === 'won' && <p>{t.done} <button className="primary" onClick={() => { setLevel((l) => l + 1); setPhase('play'); }}>{t.next}</button></p>}
      {phase === 'over' && <p>{t.over} <button className="primary" onClick={() => { total.current = 0; setLevel(1); setPhase('play'); }}>{t.again}</button></p>}
      <canvas ref={canvas} width={480} height={360} style={{ width: '100%', borderRadius: 12, touchAction: 'none', background: '#14532d' }} />
      <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'space-between', touchAction: 'none', userSelect: 'none' }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="primary" {...pad('left')}>{t.left}</button>
          <button className="primary" {...pad('up')}>{t.up}</button>
          <button className="primary" {...pad('down')}>{t.down}</button>
          <button className="primary" {...pad('right')}>{t.right}</button>
        </div>
        <button className="primary" onClick={() => { hintAsk.current = true; }}>{t.hint} {hud.hints}</button>
      </div>
    </div>
  );
}

function padDir(h: Set<string>): Spot {
  return { x: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0), y: (h.has('down') ? 1 : 0) - (h.has('up') ? 1 : 0) };
}
`;
