// Lane Dash — the library lane runner: swipe and keys, jump / slide / switch, hand-made obstacle and coin chunks,
// an easing speed curve, a magnet, one revive, missions, and a perspective road. Our own code; every part is a named
// block so it can be changed by chat. Studied for ideas only, no code taken.
export const laneDashAppTsx = `// __TITLE__ — an endless lane runner: switch lanes, jump the low walls, slide under the high bars, grab coins. Our own
// code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS (speed curve, jump, slide,
// magnet, revives), the CHUNKS (hand-made obstacle and coin patterns), the MISSIONS, the LOOKS, the COPY. Ideas studied (no
// code taken): swipe controls, coin trails laid in patterns, a speed curve that eases up to a top speed, a pickup magnet,
// one revive per run, missions that give the run a goal, and a road drawn in perspective.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'lane-dash-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  lanes: 3,
  startSpeed: 9,          // metres a second at the start
  topSpeed: 24,           // the speed curve eases up to this
  rampSeconds: 90,        // about how long it takes to get near top speed
  jumpSeconds: 0.65,      // time in the air
  slideSeconds: 0.65,     // time sliding
  magnetSeconds: 7,       // how long a magnet pulls in coins
  revives: 1,             // revives per run (costs coins)
  reviveCost: 25,         // coins for a revive
  coinPoints: 5,          // score per coin (score also grows with distance)
  swipeMin: 24,           // pixels a finger must move to count as a swipe
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Speed', coins: 'Coins',
    left: '◀', right: '▶', jump: 'Jump', slide: 'Slide', revive: 'Revive', no: 'End run', missions: 'Missions', done: 'Done!',
    help: 'Swipe or use the arrow keys', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'रफ़्तार', coins: 'सिक्के',
    left: '◀', right: '▶', jump: 'कूदो', slide: 'फिसलो', revive: 'फिर से जियो', no: 'खत्म करो', missions: 'मिशन', done: 'पूरा!',
    help: 'स्वाइप करो या तीर वाली कुंजियाँ दबाओ', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── WORLD — pure rules ──────────────────────────────────────────────────────
export type Kind = 'block' | 'low' | 'high' | 'coin' | 'magnet';     // block: change lane · low: jump · high: slide
export interface Thing { lane: number; z: number; kind: Kind; taken?: boolean }
export interface Runner { lane: number; air: number; slide: number }   // air / slide = seconds left in that move

/** The speed curve: eases from the start speed towards the top speed and never passes it. */
export function speedAt(seconds: number, o = OPTIONS): number {
  return o.startSpeed + (o.topSpeed - o.startSpeed) * (1 - Math.exp(-Math.max(0, seconds) / (o.rampSeconds / 2.5)));
}

// CHUNKS — each is a hand-made stretch of road. dz in metres from the chunk start; lane -1 = 'the chosen lane'.
type Piece = [dz: number, lane: number, kind: Kind];
export const CHUNKS: Record<string, { level: number; length: number; pieces: Piece[] }> = {
  coinLine: { level: 0, length: 30, pieces: [0, 4, 8, 12, 16, 20].map((dz): Piece => [dz, -1, 'coin']) },
  wallJump: { level: 0, length: 30, pieces: [[10, 0, 'low'], [10, 1, 'low'], [10, 2, 'low'], [6, -1, 'coin'], [10, -1, 'coin'], [14, -1, 'coin']] },
  gate: { level: 0, length: 30, pieces: [[12, 0, 'block'], [12, 2, 'block'], [4, 1, 'coin'], [8, 1, 'coin'], [12, 1, 'coin']] },
  barSlide: { level: 1, length: 30, pieces: [[12, 0, 'high'], [12, 1, 'high'], [12, 2, 'high'], [12, -1, 'coin'], [16, -1, 'coin']] },
  zigzag: { level: 1, length: 40, pieces: [[0, 0, 'coin'], [6, 1, 'coin'], [12, 2, 'coin'], [18, 1, 'coin'], [24, 0, 'coin'], [20, 2, 'block']] },
  mixed: { level: 2, length: 40, pieces: [[10, 0, 'block'], [10, 1, 'low'], [10, 2, 'high'], [24, 0, 'high'], [24, 1, 'block'], [24, 2, 'low']] },
  squeeze: { level: 2, length: 40, pieces: [[8, 1, 'block'], [16, 0, 'block'], [16, 2, 'block'], [24, 1, 'low'], [16, 1, 'coin'], [20, 1, 'coin']] },
};

/** Lay the next chunk at z: harder chunks join as the run goes on; sometimes a magnet. Never blocks every lane. */
export function nextChunk(z: number, distance: number, r: () => number = Math.random, o = OPTIONS): { things: Thing[]; length: number } {
  const level = distance < 300 ? 0 : distance < 900 ? 1 : 2;
  const names = Object.keys(CHUNKS).filter((n) => CHUNKS[n].level <= level);
  const chunk = CHUNKS[names[Math.floor(r() * names.length) % names.length]];
  const lane = Math.floor(r() * o.lanes) % o.lanes;
  const things: Thing[] = chunk.pieces.map(([dz, l, kind]) => ({ lane: l < 0 ? lane : l, z: z + dz, kind }));
  if (r() < 0.12) things.push({ lane, z: z + chunk.length - 4, kind: 'magnet' });
  return { things, length: chunk.length };
}

/** Can a runner get through every row of a chunk? (at least one lane in each row is not a block) */
export function passable(things: Thing[], o = OPTIONS): boolean {
  const rows = new Map<number, Set<number>>();
  for (const t of things) if (t.kind === 'block') rows.set(t.z, (rows.get(t.z) || new Set()).add(t.lane));
  return [...rows.values()].every((lanes) => lanes.size < o.lanes);
}

/** What touching a thing does to this runner: 'coin', 'magnet', 'crash', or null (cleared it). */
export function touch(run: Runner, t: Thing): 'coin' | 'magnet' | 'crash' | null {
  if (t.lane !== run.lane || t.taken) return null;
  if (t.kind === 'coin' || t.kind === 'magnet') return t.kind;
  if (t.kind === 'low') return run.air > 0 ? null : 'crash';
  if (t.kind === 'high') return run.slide > 0 ? null : 'crash';
  return 'crash';
}

/** A swipe from a finger move (dx, dy in pixels), or null when it was only a tap. */
export function swipe(dx: number, dy: number, o = OPTIONS): 'left' | 'right' | 'up' | 'down' | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < o.swipeMin) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
}

// MISSIONS — the run's goals
export interface Tally { metres: number; coins: number; jumps: number; slides: number }
export const MISSIONS: { en: string; hi: string; goal: (t: Tally) => boolean }[] = [
  { en: 'Run 500 m', hi: '500 मीटर दौड़ो', goal: (t) => t.metres >= 500 },
  { en: 'Collect 50 coins', hi: '50 सिक्के जमा करो', goal: (t) => t.coins >= 50 },
  { en: 'Jump 10 times', hi: '10 बार कूदो', goal: (t) => t.jumps >= 10 },
  { en: 'Slide 10 times', hi: '10 बार फिसलो', goal: (t) => t.slides >= 10 },
];

function beep(freq: number, len = 0.06) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { sky: '#0f172a', road: '#334155', line: '#94a3b8', block: '#ef4444', low: '#f59e0b', high: '#a855f7', coin: '#facc15',
  magnet: '#22d3ee', runner: '#f8fafc', view: 60 };   // view = metres of road drawn ahead

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'down' | 'over'>('menu');
  const [hud, setHud] = useState({ score: 0, coins: 0, speed: 0 });
  const [best, setBest] = useState(0);
  const [tally, setTally] = useState<Tally>({ metres: 0, coins: 0, jumps: 0, slides: 0 });
  const t = COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef({ run: { lane: 1, air: 0, slide: 0 } as Runner, things: [] as Thing[], laidTo: 20, z: 0, time: 0, coins: 0,
    magnet: 0, revives: OPTIONS.revives, tally: { metres: 0, coins: 0, jumps: 0, slides: 0 } as Tally });
  const touchAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  const scoreOf = () => Math.floor(game.current.z) + game.current.coins * OPTIONS.coinPoints;

  function start() {
    game.current = { run: { lane: 1, air: 0, slide: 0 }, things: [], laidTo: 20, z: 0, time: 0, coins: 0, magnet: 0,
      revives: OPTIONS.revives, tally: { metres: 0, coins: 0, jumps: 0, slides: 0 } };
    setPhase('play');
  }

  function end() {
    const final = scoreOf();
    setPhase('over'); setTally({ ...game.current.tally });
    setBest((prev) => { const b = Math.max(prev, final); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
  }

  function revive() {
    const g = game.current;
    g.coins -= OPTIONS.reviveCost; g.revives -= 1;
    g.things = g.things.filter((x) => x.z > g.z + 12 || x.kind === 'coin');     // clear the road just ahead
    setPhase('play');
  }

  function act(what: 'left' | 'right' | 'up' | 'down') {
    const g = game.current;
    if (phase !== 'play') return;
    if (what === 'left') g.run.lane = Math.max(0, g.run.lane - 1);
    if (what === 'right') g.run.lane = Math.min(OPTIONS.lanes - 1, g.run.lane + 1);
    if (what === 'up' && g.run.air <= 0) { g.run.air = OPTIONS.jumpSeconds; g.run.slide = 0; g.tally.jumps++; beep(520); }
    if (what === 'down' && g.run.slide <= 0) { g.run.slide = OPTIONS.slideSeconds; g.run.air = 0; g.tally.slides++; beep(300); }
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0, last = performance.now(), hudAt = 0;
    const step = (now: number) => {
      const g = game.current;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      g.time += dt;
      const v = speedAt(g.time);
      g.z += v * dt; g.tally.metres = g.z;
      g.run.air = Math.max(0, g.run.air - dt); g.run.slide = Math.max(0, g.run.slide - dt); g.magnet = Math.max(0, g.magnet - dt);
      while (g.laidTo < g.z + LOOKS.view + 10) { const ch = nextChunk(g.laidTo, g.z); g.things.push(...ch.things); g.laidTo += ch.length; }
      g.things = g.things.filter((x) => x.z > g.z - 2);
      let crashed = false;
      for (const x of g.things) {
        if (x.taken) continue;
        if (g.magnet > 0 && x.kind === 'coin' && x.z - g.z < 8 && Math.abs(x.lane - g.run.lane) <= 1) x.lane = g.run.lane;
        if (Math.abs(x.z - g.z) > 0.8) continue;
        const hit = touch(g.run, x);
        if (hit === 'coin') { x.taken = true; g.coins++; g.tally.coins++; beep(880, 0.04); }
        if (hit === 'magnet') { x.taken = true; g.magnet = OPTIONS.magnetSeconds; beep(990, 0.15); }
        if (hit === 'crash') crashed = true;
      }
      draw(ctx, c.width, c.height);
      if (now - hudAt > 100) { hudAt = now; setHud({ score: scoreOf(), coins: g.coins, speed: Math.round(v * 3.6) }); }
      if (crashed) {
        beep(140, 0.35);
        if (g.revives > 0 && g.coins >= OPTIONS.reviveCost) { setHud({ score: scoreOf(), coins: g.coins, speed: 0 }); setPhase('down'); } else end();
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const g = game.current, horizon = h * 0.28;
    const proj = (lane: number, z: number) => {             // road coordinates → screen; nearer = bigger
      const d = Math.max(0.5, z - g.z + 3), k = 3 / d;
      const y = horizon + (h - horizon) * k;
      const half = (w * 0.45) * k + 4;
      return { x: w / 2 + ((lane + 0.5) / OPTIONS.lanes - 0.5) * 2 * half, y, s: k };
    };
    ctx.fillStyle = LOOKS.sky; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = LOOKS.road; ctx.beginPath(); ctx.moveTo(w / 2 - 4, horizon); ctx.lineTo(w / 2 + 4, horizon);
    ctx.lineTo(w * 0.95, h); ctx.lineTo(w * 0.05, h); ctx.fill();
    ctx.strokeStyle = LOOKS.line; ctx.setLineDash([12, 14]); ctx.lineDashOffset = -g.z * 20;
    for (let k = 1; k < OPTIONS.lanes; k++) {
      ctx.beginPath(); ctx.moveTo(w / 2, horizon); ctx.lineTo(w * 0.05 + (w * 0.9 * k) / OPTIONS.lanes, h); ctx.stroke();
    }
    ctx.setLineDash([]);
    const ahead = g.things.filter((x) => !x.taken && x.z - g.z < LOOKS.view).sort((a, b) => b.z - a.z);
    for (const x of ahead) {
      const p = proj(x.lane, x.z), size = 120 * p.s;
      ctx.fillStyle = LOOKS[x.kind];
      if (x.kind === 'coin' || x.kind === 'magnet') { ctx.beginPath(); ctx.arc(p.x, p.y - size * 0.4, size * 0.18, 0, 7); ctx.fill(); }
      else if (x.kind === 'low') ctx.fillRect(p.x - size * 0.45, p.y - size * 0.3, size * 0.9, size * 0.3);
      else if (x.kind === 'high') { ctx.fillRect(p.x - size * 0.45, p.y - size, size * 0.9, size * 0.22); ctx.fillRect(p.x - size * 0.45, p.y - size, 4, size); }
      else ctx.fillRect(p.x - size * 0.4, p.y - size, size * 0.8, size);
    }
    const me = proj(g.run.lane, g.z), size = 80 * me.s;
    const lift = g.run.air > 0 ? Math.sin((1 - g.run.air / OPTIONS.jumpSeconds) * Math.PI) * size * 0.8 : 0;
    const tall = g.run.slide > 0 ? 0.4 : 0.9;
    ctx.fillStyle = g.magnet > 0 ? LOOKS.magnet : LOOKS.runner;
    ctx.fillRect(me.x - size * 0.2, me.y - 6 - size * tall - lift, size * 0.4, size * tall);
    ctx.fillStyle = ACCENT; ctx.fillRect(me.x - size * 0.2, me.y - 6 - size * tall - lift, size * 0.4, size * 0.15);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right',
        ArrowUp: 'up', w: 'up', ' ': 'up', ArrowDown: 'down', s: 'down' };
      if (map[e.key]) { e.preventDefault(); act(map[e.key]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const g = game.current;
  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {hud.score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.coins} {hud.coins}</span>
        <span className="badge">{t.level} {hud.speed}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {(phase === 'menu' || phase === 'over') && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <p>{phase === 'over' ? t.over + ' — ' + t.score + ' ' + scoreOf() : t.help}</p>
          <b>{t.missions}</b>
          {MISSIONS.map((m) => <div key={m.en}>{phase === 'over' && m.goal(tally) ? '✅ ' : '▫️ '}{m[lang]}</div>)}
          <button className="primary" style={{ marginTop: 10 }} onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {phase === 'down' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <button className="primary" onClick={revive}>{t.revive} (−{OPTIONS.reviveCost} {t.coins})</button>{' '}
          <button className="badge" onClick={end}>{t.no}</button>
          <span style={{ marginLeft: 8 }}>×{g.revives}</span>
        </div>
      )}
      <canvas ref={canvas} width={320} height={440} style={{ width: '100%', borderRadius: 12, touchAction: 'none' }}
        onPointerDown={(e) => { touchAt.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const from = touchAt.current; touchAt.current = null;
          const dir = from ? swipe(e.clientX - from.x, e.clientY - from.y) : null;
          if (dir) act(dir);
        }} />
      <div className="row" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={() => act('left')}>{t.left}</button>
        <button className="primary" onClick={() => act('up')}>{t.jump}</button>
        <button className="primary" onClick={() => act('down')}>{t.slide}</button>
        <button className="primary" onClick={() => act('right')}>{t.right}</button>
      </div>
    </div>
  );
}
`;
