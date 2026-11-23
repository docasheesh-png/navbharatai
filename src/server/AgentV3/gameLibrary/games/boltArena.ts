// Bolt Arena — the library arena shooter: one-thumb move with auto-aim, spawn warnings, chasers / orbiters / splitters,
// dash with a safe moment, knockback, and a choose-one-of-three upgrade between waves. Our own code; every part is a named
// block so it can be changed by chat. Studied for ideas only, no code taken.
export const boltArenaAppTsx = `// __TITLE__ — a top-down arena: move with one thumb (or WASD), your bolts fire by themselves at the nearest enemy, survive
// the waves, and pick an upgrade between them. Our own code. Every part is a named block below, so any of it can be changed
// by asking: the OPTIONS (arena, speed, dash), the ENEMIES (each kind's speed, health, behaviour), the UPGRADES, the LOOKS,
// the COPY. Ideas studied (no code taken): auto-aim fire for one-thumb play, spawn warnings so nothing appears on top of you,
// enemy kinds that chase, circle and split, a dash with a moment of safety, knockback, and a choose-one-of-three upgrade.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'bolt-arena-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  size: 340,              // the arena is a square this many pixels across
  playerRadius: 11,
  health: 5,
  moveSpeed: 150,         // pixels a second
  fireEvery: 0.4,         // seconds between bolts
  boltSpeed: 360,
  boltDamage: 1,
  dashSpeed: 520, dashSeconds: 0.18, dashCooldown: 1.2,
  safeSeconds: 0.8,       // can't be hurt for this long after a hit or during a dash
  warnSeconds: 0.9,       // a spawn shows a warning ring this long before the enemy appears
  spawnSafeDistance: 90,  // enemies never appear closer than this to you
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Wave', health: 'Health',
    dash: 'Dash', pick: 'Pick an upgrade', help: 'Drag anywhere to move, WASD or arrows; space to dash', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'लहर', health: 'जान',
    dash: 'झपटो', pick: 'एक ताकत चुनो', help: 'चलने के लिए कहीं भी खींचो, WASD या तीर; झपटने के लिए स्पेस', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── ENEMIES ─────────────────────────────────────────────────────────────────
export type EnemyKind = 'chaser' | 'orbiter' | 'splitter' | 'mini';
export const ENEMIES: Record<EnemyKind, { r: number; speed: number; hp: number; points: number; colour: string }> = {
  chaser: { r: 10, speed: 70, hp: 2, points: 10, colour: '#ef4444' },      // walks straight at you
  orbiter: { r: 9, speed: 110, hp: 2, points: 15, colour: '#f59e0b' },     // circles in, then darts
  splitter: { r: 14, speed: 50, hp: 4, points: 20, colour: '#a855f7' },    // breaks into two minis
  mini: { r: 6, speed: 120, hp: 1, points: 5, colour: '#d946ef' },
};
export interface Enemy { kind: EnemyKind; x: number; y: number; hp: number; vx: number; vy: number; age: number }

// ── UPGRADES ────────────────────────────────────────────────────────────────
export interface Stats { fireEvery: number; boltDamage: number; moveSpeed: number; bolts: number; health: number; maxHealth: number }
export const UPGRADES: Record<string, { en: string; hi: string; apply: (s: Stats) => Stats }> = {
  rapid: { en: 'Faster bolts', hi: 'तेज़ बोल्ट', apply: (s) => ({ ...s, fireEvery: Math.max(0.12, s.fireEvery * 0.8) }) },
  power: { en: 'Stronger bolts', hi: 'ताकतवर बोल्ट', apply: (s) => ({ ...s, boltDamage: s.boltDamage + 1 }) },
  spread: { en: 'One more bolt', hi: 'एक और बोल्ट', apply: (s) => ({ ...s, bolts: Math.min(5, s.bolts + 1) }) },
  boots: { en: 'Quicker feet', hi: 'तेज़ कदम', apply: (s) => ({ ...s, moveSpeed: s.moveSpeed * 1.15 }) },
  heart: { en: 'Heal and +1 health', hi: 'इलाज और +1 जान', apply: (s) => ({ ...s, maxHealth: s.maxHealth + 1, health: s.maxHealth + 1 }) },
};

// ── RULES — pure ────────────────────────────────────────────────────────────
export const baseStats = (o = OPTIONS): Stats => ({ fireEvery: o.fireEvery, boltDamage: o.boltDamage, moveSpeed: o.moveSpeed, bolts: 1,
  health: o.health, maxHealth: o.health });

/** Which enemies make up a wave: more, and tougher kinds, as waves go on. */
export function waveMix(wave: number): EnemyKind[] {
  const out: EnemyKind[] = [];
  for (let k = 0; k < 3 + wave * 2; k++) out.push(wave >= 4 && k % 5 === 4 ? 'splitter' : wave >= 2 && k % 3 === 2 ? 'orbiter' : 'chaser');
  return out;
}

/** A spawn point on the arena edge, never close to the player. */
export function spawnPoint(px: number, py: number, r: () => number = Math.random, o = OPTIONS): { x: number; y: number } {
  for (let tries = 0; tries < 20; tries++) {
    const side = Math.floor(r() * 4) % 4, along = 20 + r() * (o.size - 40);
    const p = side === 0 ? { x: along, y: 20 } : side === 1 ? { x: o.size - 20, y: along } : side === 2 ? { x: along, y: o.size - 20 } : { x: 20, y: along };
    if (Math.hypot(p.x - px, p.y - py) >= o.spawnSafeDistance) return p;
  }
  return { x: px < o.size / 2 ? o.size - 20 : 20, y: py < o.size / 2 ? o.size - 20 : 20 };      // the far corner
}

/** The nearest living enemy, for auto-aim. */
export function nearest(enemies: Enemy[], x: number, y: number): Enemy | null {
  let best: Enemy | null = null, d = Infinity;
  for (const e of enemies) { const dd = Math.hypot(e.x - x, e.y - y); if (e.hp > 0 && dd < d) { d = dd; best = e; } }
  return best;
}

/** Bolt directions: one at the target, extra bolts fan out evenly around it. */
export function fan(angle: number, bolts: number, spread = 0.22): number[] {
  return Array.from({ length: bolts }, (_, i) => angle + (i - (bolts - 1) / 2) * spread);
}

/** How an enemy moves this step toward the player (pure: returns the new position). */
export function steer(e: Enemy, px: number, py: number, dt: number): { x: number; y: number } {
  const spec = ENEMIES[e.kind], a = Math.atan2(py - e.y, px - e.x);
  const turn = e.kind === 'orbiter' && Math.hypot(px - e.x, py - e.y) > 70 ? 1.1 : 0;    // circle in, then dart straight
  const v = spec.speed * dt;
  return { x: e.x + Math.cos(a + turn) * v + e.vx * dt, y: e.y + Math.sin(a + turn) * v + e.vy * dt };
}

/** A hit: damage the enemy, knock it back; a splitter that dies leaves two minis. */
export function hitEnemy(e: Enemy, damage: number, fromAngle: number): { dead: boolean; spawn: Enemy[] } {
  e.hp -= damage; e.vx += Math.cos(fromAngle) * 140; e.vy += Math.sin(fromAngle) * 140;
  if (e.hp > 0) return { dead: false, spawn: [] };
  const spawn = e.kind === 'splitter'
    ? [-1, 1].map((s): Enemy => ({ kind: 'mini', x: e.x + s * 10, y: e.y, hp: ENEMIES.mini.hp, vx: s * 120, vy: 0, age: 0 })) : [];
  return { dead: true, spawn };
}

/** Three different upgrades to choose from. */
export function offer(r: () => number = Math.random): string[] {
  const ids = Object.keys(UPGRADES);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids.slice(0, 3);
}

function beep(freq: number, len = 0.05) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.03; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { floor: '#111827', grid: '#1f2937', player: '#f8fafc', bolt: '#fde047', warn: '#ef444488', hurt: '#fca5a5' };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
interface Bolt { x: number; y: number; a: number; life: number }
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'pick' | 'over'>('menu');
  const [hud, setHud] = useState({ score: 0, wave: 1, health: OPTIONS.health, max: OPTIONS.health });
  const [best, setBest] = useState(0);
  const [choices, setChoices] = useState<string[]>([]);
  const t = COPY[lang];
  const o = OPTIONS;
  const canvas = useRef<HTMLCanvasElement>(null);
  const fresh = () => ({ x: o.size / 2, y: o.size / 2, stats: baseStats(), enemies: [] as Enemy[], bolts: [] as Bolt[],
    warns: [] as { x: number; y: number; kind: EnemyKind; t: number }[], queue: [] as EnemyKind[], wave: 1, score: 0, fireIn: 0, safe: 0,
    dash: 0, dashCool: 0, keys: { x: 0, y: 0 }, drag: null as null | { x: number; y: number; ox: number; oy: number }, face: 0 });
  const game = useRef(fresh());

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function start() { game.current = fresh(); game.current.queue = waveMix(1); setPhase('play'); }

  function choose(id: string) {
    const g = game.current;
    g.stats = UPGRADES[id].apply(g.stats); g.wave++; g.queue = waveMix(g.wave); beep(880, 0.2); setPhase('play');
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0, last = performance.now(), hudAt = 0, spawnIn = 0.3;
    const step = (now: number) => {
      const g = game.current, s = g.stats;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      g.safe = Math.max(0, g.safe - dt); g.dash = Math.max(0, g.dash - dt); g.dashCool = Math.max(0, g.dashCool - dt);
      // move
      let mx = g.keys.x, my = g.keys.y;
      if (g.drag) { mx = g.drag.x - g.drag.ox; my = g.drag.y - g.drag.oy; const m = Math.hypot(mx, my); if (m < 6) { mx = 0; my = 0; } }
      const m = Math.hypot(mx, my);
      if (m > 0) { g.face = Math.atan2(my, mx); const sp = (g.dash > 0 ? o.dashSpeed : s.moveSpeed) * dt; g.x += (mx / m) * sp; g.y += (my / m) * sp; }
      g.x = Math.max(o.playerRadius, Math.min(o.size - o.playerRadius, g.x)); g.y = Math.max(o.playerRadius, Math.min(o.size - o.playerRadius, g.y));
      // spawn with a warning first
      spawnIn -= dt;
      if (g.queue.length && spawnIn <= 0) { const p = spawnPoint(g.x, g.y); g.warns.push({ ...p, kind: g.queue.shift()!, t: o.warnSeconds }); spawnIn = 0.55; }
      for (const w of g.warns) w.t -= dt;
      for (const w of g.warns.filter((x) => x.t <= 0)) g.enemies.push({ kind: w.kind, x: w.x, y: w.y, hp: ENEMIES[w.kind].hp, vx: 0, vy: 0, age: 0 });
      g.warns = g.warns.filter((x) => x.t > 0);
      // fire
      g.fireIn -= dt;
      const target = nearest(g.enemies, g.x, g.y);
      if (target && g.fireIn <= 0) {
        for (const a of fan(Math.atan2(target.y - g.y, target.x - g.x), s.bolts)) g.bolts.push({ x: g.x, y: g.y, a, life: 1.2 });
        g.fireIn = s.fireEvery; beep(1400, 0.02);
      }
      for (const b of g.bolts) { b.x += Math.cos(b.a) * o.boltSpeed * dt; b.y += Math.sin(b.a) * o.boltSpeed * dt; b.life -= dt; }
      // enemies
      const born: Enemy[] = [];
      for (const e of g.enemies) {
        const p = steer(e, g.x, g.y, dt); e.x = p.x; e.y = p.y; e.vx *= 0.88; e.vy *= 0.88; e.age += dt;
        for (const b of g.bolts) {
          if (b.life > 0 && e.hp > 0 && Math.hypot(b.x - e.x, b.y - e.y) < ENEMIES[e.kind].r + 3) {
            b.life = 0; const res = hitEnemy(e, s.boltDamage, b.a); born.push(...res.spawn);
            if (res.dead) { g.score += ENEMIES[e.kind].points; beep(300, 0.06); }
          }
        }
        if (e.hp > 0 && g.safe <= 0 && g.dash <= 0 && Math.hypot(e.x - g.x, e.y - g.y) < ENEMIES[e.kind].r + o.playerRadius) {
          s.health--; g.safe = o.safeSeconds; beep(120, 0.25);
          const a = Math.atan2(e.y - g.y, e.x - g.x); e.vx += Math.cos(a) * 260; e.vy += Math.sin(a) * 260;
        }
      }
      g.enemies = g.enemies.filter((e) => e.hp > 0).concat(born);
      g.bolts = g.bolts.filter((b) => b.life > 0 && b.x > -10 && b.y > -10 && b.x < o.size + 10 && b.y < o.size + 10);
      draw(ctx);
      if (now - hudAt > 100) { hudAt = now; setHud({ score: g.score, wave: g.wave, health: s.health, max: s.maxHealth }); }
      if (s.health <= 0) {
        setHud({ score: g.score, wave: g.wave, health: 0, max: s.maxHealth }); setPhase('over');
        setBest((prev) => { const b = Math.max(prev, g.score); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
        return;
      }
      if (!g.queue.length && !g.warns.length && !g.enemies.length) { setChoices(offer()); setPhase('pick'); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  function draw(ctx: CanvasRenderingContext2D) {
    const g = game.current;
    ctx.fillStyle = LOOKS.floor; ctx.fillRect(0, 0, o.size, o.size);
    ctx.strokeStyle = LOOKS.grid; ctx.lineWidth = 1;
    for (let k = 0; k <= o.size; k += 34) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, o.size); ctx.moveTo(0, k); ctx.lineTo(o.size, k); ctx.stroke(); }
    for (const w of g.warns) { ctx.strokeStyle = LOOKS.warn; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w.x, w.y, 6 + 16 * (w.t / o.warnSeconds), 0, 7); ctx.stroke(); }
    for (const e of g.enemies) { ctx.fillStyle = ENEMIES[e.kind].colour; ctx.beginPath(); ctx.arc(e.x, e.y, ENEMIES[e.kind].r, 0, 7); ctx.fill(); }
    ctx.fillStyle = LOOKS.bolt;
    for (const b of g.bolts) ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    const blink = g.safe > 0 && Math.floor(g.safe * 12) % 2 === 0;
    ctx.fillStyle = g.dash > 0 ? ACCENT : blink ? LOOKS.hurt : LOOKS.player;
    ctx.beginPath(); ctx.arc(g.x, g.y, o.playerRadius, 0, 7); ctx.fill();
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(g.x, g.y);
    ctx.lineTo(g.x + Math.cos(g.face) * 16, g.y + Math.sin(g.face) * 16); ctx.stroke();
  }

  function dash() { const g = game.current; if (phase === 'play' && g.dashCool <= 0) { g.dash = o.dashSeconds; g.dashCool = o.dashCooldown; beep(660, 0.08); } }

  useEffect(() => {
    const k = (e: KeyboardEvent, on: boolean) => {
      const g = game.current, v = on ? 1 : 0;
      if (e.key === 'ArrowLeft' || e.key === 'a') g.keys.x = -v; if (e.key === 'ArrowRight' || e.key === 'd') g.keys.x = v;
      if (e.key === 'ArrowUp' || e.key === 'w') g.keys.y = -v; if (e.key === 'ArrowDown' || e.key === 's') g.keys.y = v;
      if (on && e.key === ' ') { e.preventDefault(); dash(); }
    };
    const down = (e: KeyboardEvent) => k(e, true), up = (e: KeyboardEvent) => k(e, false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

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
        <span className="badge">{t.health} {hud.health}/{hud.max}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {(phase === 'menu' || phase === 'over') && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <p>{phase === 'over' ? t.over + ' — ' + t.score + ' ' + hud.score : t.help}</p>
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {phase === 'pick' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <b>{t.pick}</b>
          {choices.map((id) => <button key={id} className="primary" style={{ display: 'block', width: '100%', marginTop: 8 }}
            onClick={() => choose(id)}>{UPGRADES[id][lang]}</button>)}
        </div>
      )}
      <canvas ref={canvas} width={o.size} height={o.size} style={{ width: '100%', borderRadius: 12, touchAction: 'none' }}
        onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(), k = o.size / b.width;
          game.current.drag = { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k, ox: (e.clientX - b.left) * k, oy: (e.clientY - b.top) * k }; }}
        onPointerMove={(e) => { const d = game.current.drag; if (!d) return; const b = e.currentTarget.getBoundingClientRect(), k = o.size / b.width;
          d.x = (e.clientX - b.left) * k; d.y = (e.clientY - b.top) * k; }}
        onPointerUp={() => { game.current.drag = null; }} onPointerLeave={() => { game.current.drag = null; }} />
      <button className="primary" style={{ width: '100%', marginTop: 10 }} onClick={dash}>{t.dash}</button>
    </div>
  );
}
`;
