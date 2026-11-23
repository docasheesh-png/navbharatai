// Dodge Fall — the library dodge game: eased drag/keys, fair round hit boxes, near-miss points, waves that always leave
// a way through, shield and slow-time pickups, shake and sparks. Our own code; every part is a named block so it can be
// changed by chat. Studied for ideas only, no code taken.
export const dodgeFallAppTsx = `// __TITLE__ — things fall from the sky: slide left and right to dodge them, brush past for a bonus, grab a shield or a
// slow-down. Our own code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS (speed,
// lives, pickups), the FALLERS (what falls and how), the WAVES (patterns that leave a gap), the LOOKS, the COPY. Ideas
// studied (no code taken): drag-to-follow with an eased move, fair round hit boxes a little smaller than the drawing, near-miss
// points, waves laid out so there is always a way through, short shield and slow-time pickups, and a shake and burst on a hit.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'dodge-fall-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  width: 320, height: 440,
  playerRadius: 14,
  playerSpeed: 420,        // pixels a second the player can move
  lives: 3,
  startFall: 140,          // pixels a second at the start
  fallGrowth: 6,           // extra pixels a second for every 10 seconds played
  waveSeconds: 1.4,        // time between waves at the start (gets shorter)
  fastestWave: 0.55,
  graze: 14,               // pixels: passing this close without a hit scores a near miss
  grazePoints: 5,
  shieldSeconds: 5, slowSeconds: 4, slowFactor: 0.5,
  pickupChance: 0.12,      // chance a wave carries a pickup
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Wave', lives: 'Lives', left: '◀',
    right: '▶', help: 'Drag, tap the sides, or use the arrow keys', graze: 'Close!', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'लहर', lives: 'जान', left: '◀',
    right: '▶', help: 'खींचो, किनारों पर टैप करो या तीर वाली कुंजियाँ दबाओ', graze: 'बाल-बाल!', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── FALLERS ─────────────────────────────────────────────────────────────────
export type FallerKind = 'rock' | 'meteor' | 'log' | 'shield' | 'slow';
export const FALLERS: Record<FallerKind, { r: number; speed: number; colour: string; wide?: number; good?: boolean }> = {
  rock: { r: 14, speed: 1, colour: '#a8a29e' },
  meteor: { r: 10, speed: 1.7, colour: '#f97316' },
  log: { r: 10, speed: 0.8, colour: '#92400e', wide: 70 },        // a long bar: its hit box is a capsule
  shield: { r: 11, speed: 0.9, colour: '#38bdf8', good: true },
  slow: { r: 11, speed: 0.9, colour: '#a3e635', good: true },
};
export interface Faller { kind: FallerKind; x: number; y: number; grazed?: boolean }

// ── RULES — pure ────────────────────────────────────────────────────────────
export const fallSpeed = (seconds: number, o = OPTIONS) => o.startFall + o.fallGrowth * (seconds / 10);
export const waveGap = (wave: number, o = OPTIONS) => Math.max(o.fastestWave, o.waveSeconds * Math.pow(0.97, wave));

/** Distance from a point to a faller's hit shape (a circle, or a capsule for a wide one). */
export function distanceTo(f: Faller, x: number, y: number): number {
  const spec = FALLERS[f.kind], half = (spec.wide || 0) / 2;
  const cx = Math.max(f.x - half, Math.min(f.x + half, x));
  return Math.hypot(x - cx, y - f.y) - spec.r;
}

/** Hit when the player's (slightly forgiving) circle overlaps the faller's shape. */
export const hits = (f: Faller, px: number, py: number, o = OPTIONS) => distanceTo(f, px, py) < o.playerRadius * 0.8;
export const grazes = (f: Faller, px: number, py: number, o = OPTIONS) =>
  !hits(f, px, py, o) && distanceTo(f, px, py) < o.playerRadius + o.graze;

/** Move toward a target x at most speed × dt (an eased follow for drag and keys). */
export function moveToward(x: number, target: number, speed: number, dt: number): number {
  const step = speed * dt;
  return Math.abs(target - x) <= step ? target : x + Math.sign(target - x) * step;
}

/** One wave: fallers across the top that always leave a gap wide enough for the player. */
export function makeWave(wave: number, r: () => number = Math.random, o = OPTIONS): Faller[] {
  const cols = 6, colW = o.width / cols;
  const gap = Math.floor(r() * cols) % cols;                // this column stays clear
  const count = Math.min(cols - 2, 1 + Math.floor(wave / 4));
  const out: Faller[] = [];
  const free = Array.from({ length: cols }, (_, c) => c).filter((c) => Math.abs(c - gap) > 0);
  for (let k = 0; k < count && free.length; k++) {
    const c = free.splice(Math.floor(r() * free.length) % free.length, 1)[0];
    const roll = r();
    const kind: FallerKind = wave > 6 && roll < 0.2 ? 'meteor' : wave > 3 && roll > 0.85 && c !== gap - 1 && c !== gap + 1 ? 'log' : 'rock';
    out.push({ kind, x: (c + 0.5) * colW, y: -20 - r() * 30 });
  }
  if (r() < o.pickupChance) out.push({ kind: r() < 0.5 ? 'shield' : 'slow', x: (gap + 0.5) * colW, y: -40 });
  return out;
}

/** Is there a clear lane through a wave for a player this wide? */
export function hasWayThrough(wave: Faller[], o = OPTIONS): boolean {
  for (let x = o.playerRadius; x <= o.width - o.playerRadius; x += 4) {
    if (wave.every((f) => FALLERS[f.kind].good || distanceTo(f, x, f.y) >= o.playerRadius)) return true;
  }
  return false;
}

function beep(freq: number, len = 0.06) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { sky: '#0b1020', ground: '#1e293b', player: '#f8fafc', shield: '#38bdf8', spark: '#fbbf24' };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [hud, setHud] = useState({ score: 0, wave: 0, lives: OPTIONS.lives });
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const o = OPTIONS;
  const game = useRef({ x: o.width / 2, target: o.width / 2, keys: 0, fallers: [] as Faller[], time: 0, nextWave: 0.5, wave: 0, score: 0,
    lives: o.lives, shield: 0, slow: 0, shake: 0, sparks: [] as { x: number; y: number; vx: number; vy: number; life: number }[], note: 0 });

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function start() {
    game.current = { ...game.current, x: o.width / 2, target: o.width / 2, keys: 0, fallers: [], time: 0, nextWave: 0.5, wave: 0, score: 0,
      lives: o.lives, shield: 0, slow: 0, shake: 0, sparks: [], note: 0 };
    setPhase('play');
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0, last = performance.now(), hudAt = 0;
    const py = o.height - 40;
    const step = (now: number) => {
      const g = game.current;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      const slowed = g.slow > 0 ? o.slowFactor : 1;
      g.time += dt; g.shield = Math.max(0, g.shield - dt); g.slow = Math.max(0, g.slow - dt); g.shake = Math.max(0, g.shake - dt);
      g.note = Math.max(0, g.note - dt);
      if (g.keys) g.target = Math.max(o.playerRadius, Math.min(o.width - o.playerRadius, g.x + g.keys * 60));
      g.x = moveToward(g.x, g.target, o.playerSpeed, dt);
      g.nextWave -= dt * slowed;
      if (g.nextWave <= 0) { g.wave++; g.fallers.push(...makeWave(g.wave)); g.nextWave = waveGap(g.wave); }
      const v = fallSpeed(g.time) * slowed;
      for (const f of g.fallers) f.y += v * FALLERS[f.kind].speed * dt;
      g.score += dt * 10;
      const keep: Faller[] = [];
      for (const f of g.fallers) {
        if (hits(f, g.x, py)) {
          if (f.kind === 'shield') { g.shield = o.shieldSeconds; beep(990, 0.15); continue; }
          if (f.kind === 'slow') { g.slow = o.slowSeconds; beep(700, 0.2); continue; }
          if (g.shield > 0) { burst(f.x, f.y); beep(500); continue; }
          g.lives--; g.shake = 0.3; g.shield = 1.2; burst(g.x, py); beep(140, 0.3);    // a moment of cover after a hit
          continue;
        }
        if (!f.grazed && !FALLERS[f.kind].good && grazes(f, g.x, py) && f.y > py - 4) {
          f.grazed = true; g.score += o.grazePoints; g.note = 0.6; beep(1200, 0.03);
        }
        if (f.y < o.height + 30) keep.push(f);
      }
      g.fallers = keep;
      for (const s of g.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 400 * dt; s.life -= dt; }
      g.sparks = g.sparks.filter((s) => s.life > 0);
      draw(ctx, py);
      if (now - hudAt > 100) { hudAt = now; setHud({ score: Math.floor(g.score), wave: g.wave, lives: g.lives }); }
      if (g.lives <= 0) {
        const final = Math.floor(g.score);
        setHud({ score: final, wave: g.wave, lives: 0 }); setPhase('over');
        setBest((prev) => { const b = Math.max(prev, final); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  function burst(x: number, y: number) {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      game.current.sparks.push({ x, y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160 - 80, life: 0.5 });
    }
  }

  function draw(ctx: CanvasRenderingContext2D, py: number) {
    const g = game.current;
    ctx.save();
    if (g.shake > 0) ctx.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    ctx.fillStyle = g.slow > 0 ? '#1a2e05' : LOOKS.sky; ctx.fillRect(-10, -10, o.width + 20, o.height + 20);
    ctx.fillStyle = LOOKS.ground; ctx.fillRect(0, py + o.playerRadius, o.width, o.height);
    for (const f of g.fallers) {
      const spec = FALLERS[f.kind];
      ctx.fillStyle = spec.colour;
      if (spec.wide) { ctx.fillRect(f.x - spec.wide / 2, f.y - spec.r, spec.wide, spec.r * 2); continue; }
      ctx.beginPath(); ctx.arc(f.x, f.y, spec.r, 0, Math.PI * 2); ctx.fill();
      if (f.kind === 'meteor') { ctx.fillStyle = '#fde68a55'; ctx.fillRect(f.x - 3, f.y - 40, 6, 30); }
    }
    ctx.fillStyle = LOOKS.player; ctx.beginPath(); ctx.arc(g.x, py, o.playerRadius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(g.x, py, o.playerRadius * 0.5, 0, Math.PI * 2); ctx.fill();
    if (g.shield > 0) { ctx.strokeStyle = LOOKS.shield; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(g.x, py, o.playerRadius + 6, 0, 7); ctx.stroke(); }
    ctx.fillStyle = LOOKS.spark;
    for (const s of g.sparks) ctx.fillRect(s.x, s.y, 3, 3);
    if (g.note > 0) { ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(t.graze, g.x - 20, py - 30); }
    ctx.restore();
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') game.current.keys = -1;
      if (e.key === 'ArrowRight' || e.key === 'd') game.current.keys = 1;
    };
    const up = () => { game.current.keys = 0; game.current.target = game.current.x; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  function aim(e: { clientX: number; currentTarget: HTMLCanvasElement }) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * o.width;
    game.current.target = Math.max(o.playerRadius, Math.min(o.width - o.playerRadius, x));
  }

  const nudge = (dir: number) => { game.current.target = Math.max(o.playerRadius, Math.min(o.width - o.playerRadius, game.current.x + dir * 60)); };
  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {hud.score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {hud.wave}</span>
        <span className="badge">{t.lives} {'❤'.repeat(Math.max(0, hud.lives))}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <p>{phase === 'over' ? t.over + ' — ' + t.score + ' ' + hud.score : t.help}</p>
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      <canvas ref={canvas} width={o.width} height={o.height} style={{ width: '100%', borderRadius: 12, touchAction: 'none' }}
        onPointerDown={aim} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') aim(e); }} />
      <div className="row" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="primary" style={{ flex: 1 }} onClick={() => nudge(-1)}>{t.left}</button>
        <button className="primary" style={{ flex: 1 }} onClick={() => nudge(1)}>{t.right}</button>
      </div>
    </div>
  );
}
`;
