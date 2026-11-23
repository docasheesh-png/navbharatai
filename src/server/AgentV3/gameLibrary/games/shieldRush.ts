// Shield Rush — the library guard-the-core game: a turning shield, shot patterns that ramp up, colour-coded shot speeds,
// perfect (centred) blocks that charge a blast, and a combo. Our own code; every part is a named block so it can be
// changed by chat. Studied for ideas only, no code taken.
export const shieldRushAppTsx = `// __TITLE__ — guard the core: shots fly in from every side, turn your shield to block them. A block dead in the middle of the
// shield is a perfect block and charges a blast. Our own code. Every part is a named block below, so any of it can be changed by asking:
// the OPTIONS (shield size, turn speed, core health), the PATTERNS (how shots come in), the LOOKS, the COPY. Ideas studied
// (no code taken): a rotating guard round a centre, attack patterns (bursts, spirals, pairs) that ramp up, colour-coded shots
// that tell you their speed, an aim reward for centred blocks, a charge meter for a clear-the-screen blast, and a combo.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'shield-rush-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  size: 340,
  coreRadius: 22,
  shieldRadius: 46,
  shieldArc: 1.25,        // radians the shield covers (about 72°)
  turnSpeed: 6,           // radians a second with keys or buttons
  health: 5,
  perfectShare: 1 / 3,    // a block in this middle share of the shield is perfect
  blastCharge: 6,         // perfect blocks needed for a blast
  points: 10,
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', health: 'Core',
    combo: 'Combo', blast: 'Blast', perfect: 'Perfect!', help: 'Drag round the core, or arrow keys / A-D; space to blast', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', health: 'केंद्र',
    combo: 'कॉम्बो', blast: 'धमाका', perfect: 'एकदम सही!', help: 'केंद्र के चारों ओर खींचो, या तीर / A-D; धमाके के लिए स्पेस', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── SHOTS AND PATTERNS ──────────────────────────────────────────────────────
export type ShotKind = 'slow' | 'fast' | 'heavy';
export const SHOTS: Record<ShotKind, { speed: number; damage: number; colour: string }> = {
  slow: { speed: 80, damage: 1, colour: '#38bdf8' },
  fast: { speed: 150, damage: 1, colour: '#f43f5e' },
  heavy: { speed: 60, damage: 2, colour: '#facc15' },
};
export interface Shot { angle: number; dist: number; kind: ShotKind; delay: number }   // delay: seconds before it starts

/** A pattern is a list of shots (angles in radians from the right, going clockwise on screen). */
export const PATTERNS: Record<string, { level: number; make: (a: number, r: () => number) => Shot[] }> = {
  single: { level: 1, make: (a) => [{ angle: a, dist: 200, kind: 'slow', delay: 0 }] },
  pair: { level: 1, make: (a) => [0, Math.PI].map((d) => ({ angle: a + d, dist: 200, kind: 'slow' as ShotKind, delay: 0 })) },
  burst: { level: 2, make: (a) => [0, 1, 2].map((i) => ({ angle: a, dist: 200, kind: 'fast' as ShotKind, delay: i * 0.3 })) },
  spiral: { level: 2, make: (a) => Array.from({ length: 6 }, (_, i) => ({ angle: a + i * 0.6, dist: 200, kind: 'slow' as ShotKind, delay: i * 0.25 })) },
  heavy: { level: 3, make: (a, r) => [{ angle: a, dist: 200, kind: 'heavy', delay: 0 }, { angle: a + 2 + r(), dist: 200, kind: 'fast', delay: 0.4 }] },
};

// ── RULES — pure ────────────────────────────────────────────────────────────
/** The smallest signed turn from angle a to angle b, in -π … π. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Does a shield facing 'facing' cover a shot coming in at 'angle'? */
export const covers = (facing: number, angle: number, o = OPTIONS) => Math.abs(angleDiff(facing, angle)) <= o.shieldArc / 2;

/** What happens to a shot this step: still flying, blocked (perfect or not), or hit the core. */
export function resolve(shot: Shot, facing: number, step: number, o = OPTIONS): 'flying' | 'blocked' | 'perfect' | 'hit' {
  const next = shot.dist - step;
  if (shot.dist > o.shieldRadius && next <= o.shieldRadius && covers(facing, shot.angle, o)) {
    return Math.abs(angleDiff(facing, shot.angle)) <= (o.shieldArc * o.perfectShare) / 2 ? 'perfect' : 'blocked';
  }
  return next <= o.coreRadius ? 'hit' : 'flying';
}

export const levelFor = (score: number) => 1 + Math.floor(score / 150);
export const patternGap = (level: number) => Math.max(0.6, 2 - level * 0.15);
export const speedScale = (level: number) => 1 + Math.min(1, (level - 1) * 0.08);

/** The next pattern for this level. */
export function pickPattern(level: number, r: () => number = Math.random): Shot[] {
  const names = Object.keys(PATTERNS).filter((n) => PATTERNS[n].level <= Math.min(3, level));
  return PATTERNS[names[Math.floor(r() * names.length) % names.length]].make(r() * Math.PI * 2, r);
}

function beep(freq: number, len = 0.05) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { bg: '#0c0a09', ring: '#292524', core: '#f8fafc', hurt: '#ef4444' };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [hud, setHud] = useState({ score: 0, level: 1, health: OPTIONS.health, combo: 0, charge: 0 });
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const o = OPTIONS;
  const canvas = useRef<HTMLCanvasElement>(null);
  const fresh = () => ({ facing: -Math.PI / 2, turn: 0, aim: null as number | null, shots: [] as Shot[], score: 0, health: o.health,
    combo: 0, charge: 0, next: 1, flash: 0, perfect: 0, blast: 0 });
  const game = useRef(fresh());

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function start() { game.current = fresh(); setPhase('play'); }
  function blast() {
    const g = game.current;
    if (phase !== 'play' || g.charge < o.blastCharge) return;
    g.score += g.shots.filter((s) => s.delay <= 0).length * o.points; g.shots = g.shots.filter((s) => s.delay > 0);
    g.charge = 0; g.blast = 0.4; beep(200, 0.4);
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0, last = performance.now(), hudAt = 0;
    const step = (now: number) => {
      const g = game.current;
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      const level = levelFor(g.score);
      if (g.aim !== null) {
        const d = angleDiff(g.facing, g.aim), max = o.turnSpeed * 2 * dt;
        g.facing += Math.abs(d) <= max ? d : Math.sign(d) * max;
      } else g.facing += g.turn * o.turnSpeed * dt;
      g.next -= dt; g.flash = Math.max(0, g.flash - dt); g.perfect = Math.max(0, g.perfect - dt); g.blast = Math.max(0, g.blast - dt);
      if (g.next <= 0) { g.shots.push(...pickPattern(level)); g.next = patternGap(level); }
      const keep: Shot[] = [];
      for (const s of g.shots) {
        if (s.delay > 0) { s.delay -= dt; keep.push(s); continue; }
        const stepLen = SHOTS[s.kind].speed * speedScale(level) * dt;
        const res = resolve(s, g.facing, stepLen);
        if (res === 'flying') { s.dist -= stepLen; keep.push(s); continue; }
        if (res === 'hit') { g.health -= SHOTS[s.kind].damage; g.combo = 0; g.flash = 0.25; beep(120, 0.25); continue; }
        g.combo++; g.score += o.points * (1 + Math.floor(g.combo / 5)) * (res === 'perfect' ? 2 : 1);
        if (res === 'perfect') { g.charge = Math.min(o.blastCharge, g.charge + 1); g.perfect = 0.5; beep(1320, 0.05); } else beep(760, 0.04);
      }
      g.shots = keep;
      draw(ctx);
      if (now - hudAt > 100) { hudAt = now; setHud({ score: g.score, level, health: g.health, combo: g.combo, charge: g.charge }); }
      if (g.health <= 0) {
        setHud({ score: g.score, level, health: 0, combo: 0, charge: 0 }); setPhase('over');
        setBest((prev) => { const b = Math.max(prev, g.score); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  function draw(ctx: CanvasRenderingContext2D) {
    const g = game.current, cx = o.size / 2, cy = o.size / 2;
    ctx.fillStyle = g.blast > 0 ? '#fef3c7' : LOOKS.bg; ctx.fillRect(0, 0, o.size, o.size);
    ctx.strokeStyle = LOOKS.ring; ctx.lineWidth = 1;
    for (const r of [o.shieldRadius, 100, 150]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke(); }
    for (const s of g.shots) {
      if (s.delay > 0) continue;
      ctx.fillStyle = SHOTS[s.kind].colour; ctx.beginPath();
      ctx.arc(cx + Math.cos(s.angle) * s.dist, cy + Math.sin(s.angle) * s.dist, s.kind === 'heavy' ? 8 : 5, 0, 7); ctx.fill();
    }
    ctx.fillStyle = g.flash > 0 ? LOOKS.hurt : LOOKS.core; ctx.beginPath(); ctx.arc(cx, cy, o.coreRadius, 0, 7); ctx.fill();
    ctx.strokeStyle = g.perfect > 0 ? '#fde047' : ACCENT; ctx.lineWidth = 8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, o.shieldRadius, g.facing - o.shieldArc / 2, g.facing + o.shieldArc / 2); ctx.stroke();
    ctx.fillStyle = ACCENT; ctx.fillRect(10, o.size - 16, ((o.size - 20) * g.charge) / o.blastCharge, 6);
    if (g.perfect > 0) { ctx.fillStyle = '#fde047'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(t.perfect, cx - 30, cy - 70); }
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') { game.current.turn = -1; game.current.aim = null; }
      if (e.key === 'ArrowRight' || e.key === 'd') { game.current.turn = 1; game.current.aim = null; }
      if (e.key === ' ') { e.preventDefault(); blast(); }
    };
    const up = () => { game.current.turn = 0; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  function aim(e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) {
    const b = e.currentTarget.getBoundingClientRect();
    game.current.aim = Math.atan2(e.clientY - b.top - b.height / 2, e.clientX - b.left - b.width / 2);
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {hud.score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {hud.level}</span>
        <span className="badge">{t.health} {'❤'.repeat(Math.max(0, hud.health))}</span>
        {hud.combo > 1 && <span className="badge">{t.combo} {hud.combo}</span>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <p>{phase === 'over' ? t.over + ' — ' + t.score + ' ' + hud.score : t.help}</p>
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      <canvas ref={canvas} width={o.size} height={o.size} style={{ width: '100%', borderRadius: 12, touchAction: 'none' }}
        onPointerDown={aim} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') aim(e); }} />
      <div className="row" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="primary" style={{ flex: 1 }} onPointerDown={() => { game.current.turn = -1; game.current.aim = null; }}
          onPointerUp={() => { game.current.turn = 0; }}>⟲</button>
        <button className="primary" style={{ flex: 1 }} disabled={hud.charge < o.blastCharge} onClick={blast}>{t.blast}</button>
        <button className="primary" style={{ flex: 1 }} onPointerDown={() => { game.current.turn = 1; game.current.aim = null; }}
          onPointerUp={() => { game.current.turn = 0; }}>⟳</button>
      </div>
    </div>
  );
}
`;
