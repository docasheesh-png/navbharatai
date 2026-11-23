// Road race — the racing templates (Ring Rally: laps against rivals; Slope Ride: an endless hilly run). Our own code: a
// segment-projected road seen from BEHIND the car, bends and hills from a COURSE table, rivals that keep the pack close,
// a best-lap time, coins and rocks, and pads / tilt / auto-gas controls. Every part is a named block with named OPTIONS,
// so a later chat request can change any of it. Ideas studied (no code taken): jakesgordon/javascript-racer (MIT),
// pmndrs/racing-game (MIT), SuperTuxKart (GPL — ideas only).

export type RoadRaceMode = 'race' | 'run';

const SOURCE = `// __TITLE__ — a behind-the-car road race in our own code. Every part is a named block below, so any of it can be
// changed by asking: the OPTIONS (speed, laps, rivals, controls), the COURSE (each bend and hill), the COLORS, the COPY.
// Ideas studied (not copied): segment-projected roads from classic arcade racers, a rival pack that stays close
// ("rubber band"), a best-lap ghost time, and phone tilt steering.
import { useEffect, useRef, useState, type PointerEvent as PointerEv } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = '__BEST__';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  mode: '__MODE__' as 'race' | 'run',   // 'race': laps against rivals. 'run': endless slope, dodge rocks, grab coins
  laps: 3,                               // race: laps to finish
  rivals: 5,                             // race: rival cars
  rubberBand: true,                      // race: rivals far behind speed up a little, far ahead ease off
  lives: 3,                              // run: crashes before the end
  controls: 'pads' as 'pads' | 'tilt' | 'auto', // pads = Left/Right/Brake/Gas; tilt = tilt the phone; auto = gas held for you
  maxSpeed: 12000,                       // world units a second (one segment is 200)
  accel: 0.22,                           // share of maxSpeed gained per second on the gas
  braking: 0.9,
  coast: 0.18,
  offRoadLimit: 0.25,                    // off the road the car slows to this share of maxSpeed
  centrifugal: 0.3,                      // how hard a bend pushes the car outward
  roadWidth: 2000,
  lanes: 3,
  segmentLength: 200,
  drawDistance: 220,
  cameraHeight: 1000,
  fieldOfView: 100,
};

// ── COLORS ──────────────────────────────────────────────────────────────────
export const COLORS = {
  sky: ['#38bdf8', '#e0f2fe'],
  hills: '#4d7c0f',
  grass: ['#16a34a', '#15803d'],
  rumble: ['#f8fafc', '#dc2626'],
  road: ['#525252', '#4b5563'],
  lane: '#f8fafc',
  player: ACCENT,
  rivals: ['#f59e0b', '#2563eb', '#9333ea', '#0d9488', '#e11d48', '#65a30d'],
};

// ── COURSE — one row per piece: [kind, length in segments, bend (-6 left … 6 right), hill (+ up / - down)] ─────
type Piece = [kind: 'straight' | 'bend' | 'hill' | 'bend-hill', length: number, bend: number, hill: number];
export const COURSE: Piece[] = OPTIONS.mode === 'race'
  ? [
      ['straight', 40, 0, 0], ['bend', 60, 3, 0], ['hill', 50, 0, 30], ['bend', 70, -4, 0], ['bend-hill', 60, 2, -30],
      ['straight', 50, 0, 0], ['bend', 50, 5, 0], ['hill', 40, 0, 20], ['bend', 80, -3, -20], ['straight', 40, 0, 0],
    ]
  : [
      ['hill', 40, 0, -20], ['bend-hill', 60, 2, 25], ['hill', 50, 0, -40], ['bend', 50, -3, 0], ['bend-hill', 70, 3, 30],
      ['hill', 60, 0, -45], ['bend', 60, -4, 0], ['bend-hill', 60, 2, 20], ['hill', 40, 0, -20],
    ];

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lap: 'Lap', place: 'Place',
    bestLap: 'Best lap', lives: 'Lives', left: 'Left', right: 'Right', gas: 'Gas', brake: 'Brake', tilt: 'Tilt to steer', lang: 'हिंदी', won: 'Finished' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lap: 'चक्कर', place: 'स्थान',
    bestLap: 'सबसे तेज़ चक्कर', lives: 'जान', left: 'बाएँ', right: 'दाएँ', gas: 'तेज़', brake: 'ब्रेक', tilt: 'फ़ोन झुकाकर मोड़ो', lang: 'English', won: 'रेस पूरी' },
} as const;
type Lang = keyof typeof COPY;

// ── TRACK — built from the COURSE ───────────────────────────────────────────
export interface Thing { offset: number; kind: 'rival' | 'rock' | 'coin' | 'tree'; z: number; speed: number; color: string; taken?: boolean; distance?: number }
export interface Segment { index: number; y1: number; y2: number; curve: number; things: Thing[] }
export interface Track { segments: Segment[]; length: number }

const ease = (a: number, b: number, p: number) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);

export function buildTrack(course: Piece[] = COURSE, segmentLength = OPTIONS.segmentLength): Track {
  const segments: Segment[] = [];
  const lastY = () => (segments.length ? segments[segments.length - 1].y2 : 0);
  const add = (curve: number, y: number) => segments.push({ index: segments.length, y1: lastY(), y2: y, curve, things: [] });
  for (const [, length, bend, hill] of course) {
    const n = Math.max(3, Math.round(length));
    const enter = Math.round(n / 4), leave = Math.round(n / 4), hold = n - enter - leave;
    const startY = lastY(), endY = startY + hill * segmentLength;
    for (let i = 0; i < n; i++) {
      const curve = i < enter ? ease(0, bend, i / enter) : i < enter + hold ? bend : ease(bend, 0, (i - enter - hold) / leave);
      add(curve, ease(startY, endY, (i + 1) / n));
    }
  }
  // The road always comes back down to where it started, so the loop has no step.
  const back = Math.max(20, Math.round(Math.abs(lastY()) / segmentLength));
  const from = lastY();
  for (let i = 0; i < back; i++) add(0, ease(from, 0, (i + 1) / back));
  for (let i = 0; i < segments.length; i += 6) {
    const s = segments[i];
    s.things.push({ kind: 'tree', offset: (i % 12 ? -1 : 1) * (1.4 + ((i * 7) % 5) / 6), z: 0, speed: 0, color: '' });
  }
  return { segments, length: segments.length * segmentLength };
}

export const segmentAt = (t: Track, z: number) =>
  t.segments[Math.floor(((z % t.length) + t.length) % t.length / OPTIONS.segmentLength) % t.segments.length];

// ── CAR — one step of the player's car ──────────────────────────────────────
export interface Input { left: boolean; right: boolean; gas: boolean; brake: boolean; tilt: number }
export interface Car { z: number; x: number; speed: number; distance: number }

export function stepCar(car: Car, input: Input, track: Track, dt: number, o = OPTIONS): Car {
  dt = Math.max(0, dt);
  const max = o.maxSpeed, pct = car.speed / max, seg = segmentAt(track, car.z);
  const dx = dt * 2 * pct;
  let x = car.x;
  const steer = input.tilt !== 0 ? input.tilt : (input.left ? -1 : 0) + (input.right ? 1 : 0);
  x += dx * steer;
  x -= dx * pct * seg.curve * o.centrifugal;
  let speed = car.speed;
  const gas = input.gas || o.controls === 'auto';
  if (input.brake) speed -= max * o.braking * dt;
  else if (gas) speed += max * o.accel * dt;
  else speed -= max * o.coast * dt;
  if (Math.abs(x) > 1 && speed > max * o.offRoadLimit) speed -= max * 0.9 * dt;
  speed = Math.max(0, Math.min(max, speed));
  x = Math.max(-2.5, Math.min(2.5, x));
  const move = speed * dt;
  return { z: (((car.z + move) % track.length) + track.length) % track.length, x, speed, distance: car.distance + move };
}

// ── RIVALS / HAZARDS ────────────────────────────────────────────────────────
export function placeThings(track: Track, mode = OPTIONS.mode, rivals = OPTIONS.rivals): Thing[] {
  const out: Thing[] = [];
  if (mode === 'race') {
    for (let i = 0; i < rivals; i++) {
      out.push({
        kind: 'rival', offset: ((i % 3) - 1) * 0.55, z: (i + 1) * OPTIONS.segmentLength * 6,
        speed: OPTIONS.maxSpeed * (0.62 + (i % 4) * 0.06), color: COLORS.rivals[i % COLORS.rivals.length],
      });
    }
  } else {
    for (let s = 30; s < track.segments.length - 10; s += 9) {
      const lane = ((s * 13) % 3) - 1;
      out.push({ kind: s % 2 ? 'rock' : 'coin', offset: lane * 0.6, z: s * OPTIONS.segmentLength, speed: 0, color: s % 2 ? '#78716c' : '#facc15' });
    }
  }
  return out;
}

/** Rivals drive on; a rival far behind the player speeds up and one far ahead eases off, so the pack stays close. */
export function stepRivals(rivals: Thing[], player: Car, track: Track, dt: number, rubberBand = OPTIONS.rubberBand): void {
  for (const r of rivals) {
    if (r.kind !== 'rival') continue;
    let speed = r.speed;
    if (rubberBand) {
      let gap = r.z - player.z;
      if (gap > track.length / 2) gap -= track.length;
      if (gap < -track.length / 2) gap += track.length;
      if (gap < -OPTIONS.segmentLength * 40) speed *= 1.12;
      else if (gap > OPTIONS.segmentLength * 40) speed *= 0.9;
    }
    const lead = (r.z - player.z + track.length) % track.length;
    if (lead < OPTIONS.segmentLength * 8 && Math.abs(r.offset - player.x) < 0.4) r.offset += (r.offset > player.x ? 1 : -1) * dt * 0.8;
    r.offset = Math.max(-0.8, Math.min(0.8, r.offset));
    r.distance = (r.distance ?? r.z) + speed * dt;   // the whole way driven, for the place
    r.z = (r.z + speed * dt) % track.length;
  }
}

/** Running into something: a rival slows you to its speed, a rock stops you, a coin is collected. */
export function collide(car: Car, things: Thing[], track: Track): { car: Car; crashed: boolean; coins: number } {
  let crashed = false, coins = 0, next = car;
  for (const t of things) {
    if (t.taken) continue;
    const ahead = (t.z - car.z + track.length) % track.length;
    if (ahead > OPTIONS.segmentLength * 1.2 || Math.abs(t.offset - car.x) > 0.35) continue;
    if (t.kind === 'coin') { t.taken = true; coins++; }
    else if (t.kind === 'rock') { t.taken = true; crashed = true; next = { ...next, speed: 0 }; }
    else if (t.kind === 'rival' && next.speed > t.speed) next = { ...next, speed: t.speed * 0.8 };
  }
  return { car: next, crashed, coins };
}

export function placeOf(car: Car, rivals: Thing[]): number {
  return 1 + rivals.filter((r) => r.kind === 'rival' && (r.distance ?? r.z) > car.distance).length;
}

// ── DRAW — the road seen from BEHIND the car (tail lights toward you) ───────
function draw(ctx: CanvasRenderingContext2D, w: number, h: number, track: Track, car: Car, things: Thing[], steer: number) {
  const o = OPTIONS, depth = 1 / Math.tan(((o.fieldOfView / 2) * Math.PI) / 180);
  const sky = ctx.createLinearGradient(0, 0, 0, h / 2);
  sky.addColorStop(0, COLORS.sky[0]); sky.addColorStop(1, COLORS.sky[1]);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  const base = segmentAt(track, car.z);
  const basePct = (car.z % o.segmentLength) / o.segmentLength;
  // Far hills drift with the bends.
  ctx.fillStyle = COLORS.hills;
  const drift = (base.index * 0.7) % w;
  for (let i = -1; i < 4; i++) { ctx.beginPath(); ctx.ellipse(i * w / 2 - drift / 3, h / 2, w / 3, h / 8, 0, Math.PI, 0); ctx.fill(); }
  const camY = o.cameraHeight + ease(base.y1, base.y2, basePct);
  let maxY = h, x = 0, dx = -base.curve * basePct;
  const proj: { seg: Segment; x1: number; y1: number; w1: number; s1: number; clip: number }[] = [];
  for (let n = 0; n < o.drawDistance; n++) {
    const seg = track.segments[(base.index + n) % track.segments.length];
    const looped = seg.index < base.index ? track.length : 0;
    const z1 = seg.index * o.segmentLength + looped - car.z, z2 = z1 + o.segmentLength;
    if (z1 <= depth) { x += dx; dx += seg.curve; continue; }
    const s1 = depth / z1, s2 = depth / z2;
    const cx = car.x * o.roadWidth;
    const X1 = w / 2 + s1 * (x - cx) * w / 2, Y1 = h / 2 - s1 * (seg.y1 - camY) * h / 2, W1 = s1 * o.roadWidth * w / 2;
    const X2 = w / 2 + s2 * (x + dx - cx) * w / 2, Y2 = h / 2 - s2 * (seg.y2 - camY) * h / 2, W2 = s2 * o.roadWidth * w / 2;
    x += dx; dx += seg.curve;
    proj.push({ seg, x1: X1, y1: Y1, w1: W1, s1, clip: maxY });
    if (Y2 >= maxY || Y2 >= Y1) continue;
    const alt = Math.floor(seg.index / 3) % 2;
    ctx.fillStyle = COLORS.grass[alt]; ctx.fillRect(0, Y2, w, Y1 - Y2);
    const quad = (ax: number, aw: number, bx: number, bw: number, c: string) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(ax - aw, Y1); ctx.lineTo(bx - bw, Y2); ctx.lineTo(bx + bw, Y2); ctx.lineTo(ax + aw, Y1); ctx.fill();
    };
    quad(X1, W1 * 1.15, X2, W2 * 1.15, COLORS.rumble[alt]);
    quad(X1, W1, X2, W2, COLORS.road[alt]);
    if (alt === 0) for (let l = 1; l < o.lanes; l++) {
      const f = -1 + (2 * l) / o.lanes;
      quad(X1 + W1 * f, W1 * 0.02, X2 + W2 * f, W2 * 0.02, COLORS.lane);
    }
    maxY = Y2;
  }
  // Things far to near, so the near ones cover the far.
  for (let i = proj.length - 1; i >= 0; i--) {
    const p = proj[i];
    const here = things.filter((t) => !t.taken && segmentAt(track, t.z).index === p.seg.index).concat(p.seg.things);
    for (const t of here) {
      const size = p.s1 * w * (t.kind === 'tree' ? 700 : t.kind === 'rival' ? 380 : 220);
      const sx = p.x1 + p.s1 * t.offset * o.roadWidth * w / 2;
      const top = p.y1 - size;
      if (top > p.clip) continue;
      if (t.kind === 'tree') { ctx.fillStyle = '#166534'; ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(sx - size / 3, p.y1); ctx.lineTo(sx + size / 3, p.y1); ctx.fill(); }
      else if (t.kind === 'rival') {
        ctx.fillStyle = t.color; ctx.fillRect(sx - size / 2, p.y1 - size * 0.6, size, size * 0.6);
        ctx.fillStyle = '#ef4444'; // tail lights: rivals are seen from behind too
        ctx.fillRect(sx - size / 2.2, p.y1 - size * 0.3, size / 6, size / 10);
        ctx.fillRect(sx + size / 2.2 - size / 6, p.y1 - size * 0.3, size / 6, size / 10);
      }
      else if (t.kind === 'rock') { ctx.fillStyle = t.color; ctx.beginPath(); ctx.ellipse(sx, p.y1 - size / 3, size / 2, size / 3, 0, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(sx, p.y1 - size, size / 3, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  // The player's car from behind: body, rear window, two tail lights.
  const cw = w * 0.22, ch = cw * 0.45, cx = w / 2 + steer * w * 0.01, cy = h - ch - 10;
  ctx.save(); ctx.translate(cx, cy + ch / 2); ctx.rotate(steer * 0.05);
  ctx.fillStyle = COLORS.player; ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
  ctx.fillStyle = '#0f172a'; ctx.fillRect(-cw / 3, -ch / 2 - ch * 0.35, (cw * 2) / 3, ch * 0.4);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(-cw / 2 + 4, -ch / 6, cw / 6, ch / 5); ctx.fillRect(cw / 2 - 4 - cw / 6, -ch / 6, cw / 6, ch / 5);
  ctx.restore();
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = freq; g.gain.value = 0.04; osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.08);
  } catch { /* sound can be blocked */ }
}

const fmt = (ms: number) => (ms / 1000).toFixed(2) + 's';

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [hud, setHud] = useState({ score: 0, lap: 1, place: 1, lives: OPTIONS.lives, level: 1, speed: 0 });
  const [best, setBest] = useState(0);
  const [bestLap, setBestLap] = useState(0);
  const t = COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<Input>({ left: false, right: false, gas: false, brake: false, tilt: 0 });

  useEffect(() => {
    try {
      const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n);
      const l = parseInt(localStorage.getItem(BEST + '-lap') || '', 10); if (Number.isFinite(l)) setBestLap(l);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const keys: Record<string, keyof Omit<Input, 'tilt'>> = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'gas', w: 'gas', ArrowDown: 'brake', s: 'brake' };
    const down = (e: KeyboardEvent) => { const k = keys[e.key]; if (k) { input.current[k] = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { const k = keys[e.key]; if (k) input.current[k] = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    if (OPTIONS.controls !== 'tilt' || phase !== 'play') return;
    const onTilt = (e: DeviceOrientationEvent) => {
      const g = e.gamma ?? 0;
      input.current.tilt = Math.abs(g) < 3 ? 0 : Math.max(-1, Math.min(1, g / 28));
    };
    window.addEventListener('deviceorientation', onTilt);
    return () => { window.removeEventListener('deviceorientation', onTilt); input.current.tilt = 0; };
  }, [phase]);

  function start() {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (OPTIONS.controls === 'tilt' && typeof D?.requestPermission === 'function') D.requestPermission().catch(() => undefined);
    setPhase('play');
  }

  function end(score: number, lap: number) {
    setPhase('over');
    beep(220);
    setBest((prev) => { const next = Math.max(prev, score); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
    if (lap > 0) setBestLap((prev) => { const next = prev ? Math.min(prev, lap) : lap; try { localStorage.setItem(BEST + '-lap', String(next)); } catch { /* ignore */ } return next; });
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const track = buildTrack();
    const things = placeThings(track);
    let car: Car = { z: 0, x: 0, speed: 0, distance: 0 };
    let lap = 1, lapStart = performance.now(), fastest = 0, lives = OPTIONS.lives, coins = 0, level = 1, crashFlash = 0;
    let last = performance.now(), raf = 0, running = true;
    const raceStart = performance.now();
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; // a late first frame can come early
      const before = car.z;
      const o = OPTIONS.mode === 'run' ? { ...OPTIONS, maxSpeed: OPTIONS.maxSpeed * (0.8 + level * 0.1) } : OPTIONS;
      car = stepCar(car, input.current, track, dt, o);
      stepRivals(things, car, track, dt);
      const hit = collide(car, things, track);
      car = hit.car;
      if (hit.coins) { coins += hit.coins; beep(880); }
      if (hit.crashed) { lives--; crashFlash = 0.4; beep(140); }
      crashFlash = Math.max(0, crashFlash - dt);
      if (car.z < before) {
        // Crossed the line.
        const lapMs = now - lapStart; lapStart = now;
        fastest = fastest ? Math.min(fastest, lapMs) : lapMs;
        if (OPTIONS.mode === 'race') {
          if (lap >= OPTIONS.laps) {
            running = false;
            const place = placeOf(car, things);
            const seconds = (now - raceStart) / 1000;
            const score = (OPTIONS.rivals + 2 - place) * 100 + Math.max(0, Math.round(600 - seconds * 2));
            end(score, Math.round(fastest));
            setHud((p) => ({ ...p, score, place }));
            return;
          }
          lap++; beep(660);
        } else {
          for (const th of things) th.taken = false;
          level++; beep(660);
        }
      }
      const score = OPTIONS.mode === 'race' ? Math.round(car.distance / 100) : Math.round(car.distance / 200) + coins * 10;
      if (OPTIONS.mode === 'run' && lives <= 0) { running = false; end(score, 0); setHud((p) => ({ ...p, score, lives: 0 })); return; }
      const steer = input.current.tilt || (input.current.left ? -1 : 0) + (input.current.right ? 1 : 0);
      draw(ctx, c.width, c.height, track, car, things, steer);
      if (crashFlash > 0) { ctx.fillStyle = 'rgba(239,68,68,0.35)'; ctx.fillRect(0, 0, c.width, c.height); }
      setHud({ score, lap, place: placeOf(car, things), lives, level, speed: Math.round((car.speed / OPTIONS.maxSpeed) * 200) });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, [phase]);

  const hold = (k: keyof Omit<Input, 'tilt'>) => ({
    onPointerDown: (e: PointerEv) => { e.preventDefault(); input.current[k] = true; },
    onPointerUp: () => { input.current[k] = false; },
    onPointerLeave: () => { input.current[k] = false; },
    onPointerCancel: () => { input.current[k] = false; },
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
        {OPTIONS.mode === 'race'
          ? <>
              <span className="badge">{t.lap} {hud.lap}/{OPTIONS.laps}</span>
              <span className="badge">{t.place} {hud.place}/{OPTIONS.rivals + 1}</span>
              {bestLap > 0 && <span className="badge">{t.bestLap} {fmt(bestLap)}</span>}
            </>
          : <><span className="badge">{t.lives} {hud.lives}</span><span className="badge">{t.level} {hud.level}</span></>}
        <span className="badge">{hud.speed} km/h</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{OPTIONS.mode === 'race' ? t.won + ' · ' + t.place + ' ' + hud.place : t.over}</p>}
      <canvas ref={canvas} width={480} height={320} style={{ width: '100%', borderRadius: 12, touchAction: 'none', background: '#0f172a' }} />
      {OPTIONS.controls === 'tilt' && <p style={{ margin: '6px 0' }}>{t.tilt}</p>}
      <div className="row" style={{ gap: 8, marginTop: 10, justifyContent: 'space-between', touchAction: 'none', userSelect: 'none' }}>
        {OPTIONS.controls !== 'tilt' && <div className="row" style={{ gap: 8 }}>
          <button className="primary" {...hold('left')}>{t.left}</button>
          <button className="primary" {...hold('right')}>{t.right}</button>
        </div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="primary" {...hold('brake')}>{t.brake}</button>
          {OPTIONS.controls !== 'auto' && <button className="primary" {...hold('gas')}>{t.gas}</button>}
        </div>
      </div>
    </div>
  );
}
`;

/** One complete App.tsx: 'race' = laps against rivals, 'run' = an endless slope. __TITLE__ / __ACCENT__ stay for the skin. */
export function roadRaceAppTsx(mode: RoadRaceMode, best: string): string {
  return SOURCE.replace("'__MODE__'", `'${mode}'`).replace("'__BEST__'", `'${best.replace(/[^a-z0-9-]/gi, '')}'`);
}
