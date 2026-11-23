// Tower Line — the library tower defence: one winding road, three towers (arrow, frost, cannon), upgrades
// and selling, ten waves you start yourself, a wave preview.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const towerLineAppTsx = `// __TITLE__ — a tower defence on one winding road: place towers on the grass, start a wave, and stop the walkers before they
// reach the gate. Our own code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS (coins,
// lives), the ROAD (the path as grid points), the TOWERS (cost, range, damage, rate, special), the WAVES, the LOOKS, the COPY.
// Ideas studied (no code taken): a path written as a few corner points, towers that aim at the walker furthest along the
// road, a slowing tower and a splash tower so choices matter, upgrades and selling, a range circle while placing, waves you
// start yourself (with a bonus for calling early), and a preview of the next wave.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'tower-line-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = { cols: 12, rows: 9, cell: 30, coins: 120, lives: 15, sellBack: 0.6 };

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Coins', best: 'Best wave', level: 'Wave', lives: 'Gate',
    start: 'Start wave', next: 'Next', upgrade: 'Upgrade', sell: 'Sell', pick: 'Pick a tower, then tap the grass', won: 'All waves held!', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'सिक्के', best: 'सबसे आगे', level: 'लहर', lives: 'दरवाज़ा',
    start: 'लहर शुरू', next: 'अगली', upgrade: 'बेहतर करो', sell: 'बेचो', pick: 'एक मीनार चुनो, फिर घास पर टैप करो', won: 'सारी लहरें रोक लीं!', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── ROAD — corner points on the grid; walkers follow straight lines between them ─────────────────────────────────
export const ROAD: [number, number][] = [[0, 1], [9, 1], [9, 4], [2, 4], [2, 7], [11, 7]];

// ── TOWERS ──────────────────────────────────────────────────────────────────
export const TOWERS = {
  arrow: { en: 'Arrow', hi: 'तीर', icon: '🏹', cost: 40, range: 2.6, damage: 3, every: 0.5, slow: 0, splash: 0 },
  frost: { en: 'Frost', hi: 'पाला', icon: '❄️', cost: 50, range: 2.2, damage: 1, every: 0.8, slow: 0.5, splash: 0 },
  cannon: { en: 'Cannon', hi: 'तोप', icon: '💣', cost: 80, range: 2.4, damage: 6, every: 1.4, slow: 0, splash: 1.1 },
};
export type TowerKind = keyof typeof TOWERS;
export interface Tower { kind: TowerKind; col: number; row: number; level: number; cool: number }
export interface Walker { hp: number; max: number; speed: number; dist: number; slowFor: number; reward: number }

// ── WAVES — count, health and speed grow each wave ───────────────────────────
export const WAVE_COUNT = 10;
export const waveOf = (n: number) => ({ count: 6 + n * 2, hp: Math.round(6 * Math.pow(1.28, n - 1)), speed: 1.1 + n * 0.06, reward: 4 + Math.floor(n / 3) });

// ── RULES — pure ────────────────────────────────────────────────────────────
/** Total road length in cells. */
export const roadLength = () => ROAD.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - ROAD[i][0], p[1] - ROAD[i][1]), 0);

/** Where on the grid a walker is, given how far along the road it has gone. */
export function pointAt(dist: number): [number, number] {
  let left = dist;
  for (let i = 1; i < ROAD.length; i++) {
    const [ax, ay] = ROAD[i - 1], [bx, by] = ROAD[i], len = Math.hypot(bx - ax, by - ay);
    if (left <= len) return [ax + ((bx - ax) * left) / len, ay + ((by - ay) * left) / len];
    left -= len;
  }
  return ROAD[ROAD.length - 1];
}

/** Every grid cell the road passes through (towers cannot stand there). */
export function roadCells(): Set<string> {
  const out = new Set<string>();
  for (let d = 0; d <= roadLength(); d += 0.25) { const [x, y] = pointAt(d); out.add(Math.round(x) + ',' + Math.round(y)); }
  return out;
}

export const canBuild = (col: number, row: number, towers: Tower[], o = OPTIONS) =>
  col >= 0 && row >= 0 && col < o.cols && row < o.rows && !roadCells().has(col + ',' + row) && !towers.some((t) => t.col === col && t.row === row);

/** A tower's numbers at its level: each upgrade adds a third more damage and a little range. */
export function statsOf(t: Tower) {
  const s = TOWERS[t.kind], k = 1 + (t.level - 1) / 3;
  return { ...s, damage: s.damage * k, range: s.range + (t.level - 1) * 0.3 };
}
export const upgradeCost = (t: Tower) => Math.round(TOWERS[t.kind].cost * 0.75 * t.level);
export const sellValue = (t: Tower, o = OPTIONS) => {
  let spent = TOWERS[t.kind].cost; for (let l = 1; l < t.level; l++) spent += upgradeCost({ ...t, level: l });
  return Math.floor(spent * o.sellBack);
};

/** The walker a tower aims at: in range, and furthest along the road. */
export function target(t: Tower, walkers: Walker[]): Walker | null {
  const range = statsOf(t).range;
  let best: Walker | null = null;
  for (const w of walkers) {
    if (w.hp <= 0) continue;
    const [x, y] = pointAt(w.dist);
    if (Math.hypot(x - t.col, y - t.row) <= range && (!best || w.dist > best.dist)) best = w;
  }
  return best;
}

/** A shot: damage the target (and others nearby for a splash tower); a frost tower also slows. */
export function shoot(t: Tower, aim: Walker, walkers: Walker[]): void {
  const s = statsOf(t), [ax, ay] = pointAt(aim.dist);
  const hit = s.splash ? walkers.filter((w) => { const [x, y] = pointAt(w.dist); return w.hp > 0 && Math.hypot(x - ax, y - ay) <= s.splash; }) : [aim];
  for (const w of hit) { w.hp -= s.damage; if (s.slow) w.slowFor = 1.5; }
}

export const walkerSpeed = (w: Walker) => w.speed * (w.slowFor > 0 ? TOWERS.frost.slow : 1);

export interface Field { towers: Tower[]; walkers: Walker[]; coins: number; lives: number; wave: number; toSpawn: number; spawnIn: number }
export const SPAWN_GAP = 0.8;
export const waveBonus = (wave: number) => 10 + wave * 2;

/** One moment of a wave: spawn, walk, shoot, pay for knocked-out walkers, lose a life for each one at the gate. */
export function stepWave(g: Field, dt: number) {
  const spec = waveOf(g.wave), len = roadLength(), fired: { tower: Tower; at: number }[] = [];
  g.spawnIn -= dt;
  if (g.toSpawn > 0 && g.spawnIn <= 0) {
    g.walkers.push({ hp: spec.hp, max: spec.hp, speed: spec.speed, dist: 0, slowFor: 0, reward: spec.reward }); g.toSpawn--; g.spawnIn = SPAWN_GAP;
  }
  for (const w of g.walkers) { w.dist += walkerSpeed(w) * dt; w.slowFor = Math.max(0, w.slowFor - dt); }
  for (const tw of g.towers) {
    tw.cool -= dt;
    const aim = tw.cool <= 0 ? target(tw, g.walkers) : null;
    if (aim) { shoot(tw, aim, g.walkers); tw.cool = statsOf(tw).every; fired.push({ tower: tw, at: aim.dist }); }
  }
  let leaked = 0;
  for (const w of g.walkers) { if (w.hp <= 0) g.coins += w.reward; else if (w.dist >= len) { g.lives--; leaked++; } }
  g.walkers = g.walkers.filter((w) => w.hp > 0 && w.dist < len);
  const cleared = g.lives > 0 && !g.toSpawn && !g.walkers.length;
  if (cleared) g.coins += waveBonus(g.wave);
  return { fired, leaked, cleared };
}

function beep(freq: number, len = 0.04) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.03; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { grass: '#3f6212', road: '#a16207', walker: '#dc2626', gate: '#f8fafc', range: '#ffffff33' };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'build' | 'wave' | 'over'>('menu');
  const [hud, setHud] = useState({ coins: OPTIONS.coins, lives: OPTIONS.lives, wave: 0 });
  const [best, setBest] = useState(0);
  const [choice, setChoice] = useState<TowerKind>('arrow');
  const [selected, setSelected] = useState<number | null>(null);
  const [won, setWon] = useState(false);
  const t = COPY[lang];
  const o = OPTIONS, C = o.cell;
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Field & { shots: { x1: number; y1: number; x2: number; y2: number; life: number }[] }>({ towers: [], walkers: [], coins: o.coins, lives: o.lives,
    wave: 0, toSpawn: 0, spawnIn: 0, shots: [] });

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);
  const sync = () => { const g = game.current; setHud({ coins: g.coins, lives: g.lives, wave: g.wave }); };

  function start() {
    game.current = { towers: [], walkers: [], coins: o.coins, lives: o.lives, wave: 0, toSpawn: 0, spawnIn: 0, shots: [] };
    setWon(false); setSelected(null); sync(); setPhase('build');
  }
  function startWave() { const g = game.current; g.wave++; g.toSpawn = waveOf(g.wave).count; g.spawnIn = 0; sync(); setPhase('wave'); }
  function end(all: boolean) {
    const g = game.current; setWon(all); setPhase('over');
    setBest((b) => { const v = Math.max(b, all ? g.wave : g.wave - 1); try { localStorage.setItem(BEST, String(v)); } catch { /* ignore */ } return v; });
  }

  function tapCell(col: number, row: number) {
    const g = game.current, at = g.towers.findIndex((x) => x.col === col && x.row === row);
    if (at >= 0) { setSelected(at); return; }
    setSelected(null);
    if (phase === 'menu' || phase === 'over' || !canBuild(col, row, g.towers) || g.coins < TOWERS[choice].cost) return;
    g.towers.push({ kind: choice, col, row, level: 1, cool: 0 }); g.coins -= TOWERS[choice].cost; beep(500); sync(); draw();
  }
  function upgrade() {
    const g = game.current, tw = selected !== null ? g.towers[selected] : null;
    if (!tw || tw.level >= 3 || g.coins < upgradeCost(tw)) return;
    g.coins -= upgradeCost(tw); tw.level++; beep(800); sync(); draw();
  }
  function sell() {
    const g = game.current; if (selected === null) return;
    g.coins += sellValue(g.towers[selected]); g.towers.splice(selected, 1); setSelected(null); sync(); draw();
  }

  function draw() {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const g = game.current;
    ctx.fillStyle = LOOKS.grass; ctx.fillRect(0, 0, o.cols * C, o.rows * C);
    ctx.strokeStyle = LOOKS.road; ctx.lineWidth = C * 0.8; ctx.lineJoin = 'round'; ctx.beginPath();
    ROAD.forEach(([x, y], i) => (i ? ctx.lineTo(x * C + C / 2, y * C + C / 2) : ctx.moveTo(x * C + C / 2, y * C + C / 2))); ctx.stroke();
    const [gx, gy] = ROAD[ROAD.length - 1]; ctx.fillStyle = LOOKS.gate; ctx.fillRect(gx * C + 4, gy * C + 2, C - 8, C - 4);
    ctx.font = C * 0.7 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    g.towers.forEach((tw, i) => {
      if (i === selected) { ctx.fillStyle = LOOKS.range; ctx.beginPath(); ctx.arc(tw.col * C + C / 2, tw.row * C + C / 2, statsOf(tw).range * C, 0, 7); ctx.fill(); }
      ctx.fillText(TOWERS[tw.kind].icon, tw.col * C + C / 2, tw.row * C + C / 2);
      for (let l = 1; l < tw.level; l++) { ctx.fillStyle = '#facc15'; ctx.fillRect(tw.col * C + 3 + l * 6, tw.row * C + C - 5, 4, 4); }
    });
    for (const w of g.walkers) {
      const [x, y] = pointAt(w.dist);
      ctx.fillStyle = w.slowFor > 0 ? '#38bdf8' : LOOKS.walker; ctx.beginPath(); ctx.arc(x * C + C / 2, y * C + C / 2, C * 0.28, 0, 7); ctx.fill();
      ctx.fillStyle = '#16a34a'; ctx.fillRect(x * C + 4, y * C + 2, (C - 8) * Math.max(0, w.hp / w.max), 3);
    }
    ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2;
    for (const s of g.shots) { ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); }
  }

  useEffect(() => { draw(); });

  useEffect(() => {
    if (phase !== 'wave') return;
    let raf = 0, last = performance.now(), hudAt = 0;
    const step = (now: number) => {
      const g = game.current, dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      const ev = stepWave(g, dt);
      if (ev.fired.length) beep(1200, 0.02);
      if (ev.leaked) beep(150, 0.2);
      for (const f of ev.fired) {
        const [x, y] = pointAt(f.at); g.shots.push({ x1: f.tower.col * C + C / 2, y1: f.tower.row * C + C / 2, x2: x * C + C / 2, y2: y * C + C / 2, life: 0.08 });
      }
      for (const sh of g.shots) sh.life -= dt;
      g.shots = g.shots.filter((sh) => sh.life > 0);
      draw();
      if (now - hudAt > 120) { hudAt = now; sync(); }
      if (g.lives <= 0) { sync(); end(false); return; }
      if (ev.cleared) { sync(); if (g.wave >= WAVE_COUNT) end(true); else setPhase('build'); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sel = selected !== null ? game.current.towers[selected] : null;
  const nextWave = waveOf(hud.wave + 1);
  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {hud.coins}</span>
        <span className="badge">{t.lives} {hud.lives}</span>
        <span className="badge">{t.level} {hud.wave}/{WAVE_COUNT}</span>
        <span className="badge">{t.best} {best}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {(phase === 'menu' || phase === 'over') && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          {phase === 'over' && <p>{won ? t.won : t.over + ' — ' + t.level + ' ' + hud.wave}</p>}
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      <canvas ref={canvas} width={o.cols * C} height={o.rows * C} style={{ width: '100%', borderRadius: 8, touchAction: 'none' }}
        onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(), k = (o.cols * C) / b.width;
          tapCell(Math.floor(((e.clientX - b.left) * k) / C), Math.floor(((e.clientY - b.top) * k) / C)); }} />
      {phase !== 'menu' && phase !== 'over' && (
        <>
          <p style={{ fontSize: 13, margin: '6px 0' }}>{t.pick}</p>
          <div className="row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(TOWERS) as TowerKind[]).map((k) => <button key={k} className="badge" onClick={() => setChoice(k)}
              style={{ outline: k === choice ? '2px solid ' + ACCENT : 'none' }}>{TOWERS[k].icon} {TOWERS[k][lang]} {TOWERS[k].cost}</button>)}
          </div>
          {sel && (
            <div className="row" style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button className="badge" disabled={sel.level >= 3 || hud.coins < upgradeCost(sel)} onClick={upgrade}>{t.upgrade} {sel.level < 3 ? upgradeCost(sel) : '★'}</button>
              <button className="badge" onClick={sell}>{t.sell} +{sellValue(sel)}</button>
            </div>
          )}
          {phase === 'build' && <button className="primary" style={{ marginTop: 8 }} onClick={startWave}>{t.start} · {t.next}: {nextWave.count} × ❤{nextWave.hp}</button>}
        </>
      )}
    </div>
  );
}
`;
