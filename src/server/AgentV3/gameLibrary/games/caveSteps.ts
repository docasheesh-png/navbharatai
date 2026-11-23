// Cave Steps — the library cave crawler: grown-and-smoothed caves with reachable stairs, field of view with memory,
// turn-based bump-to-fight, creatures that wake when they see you, potions and gold, deeper floors. Our own code; every
// part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const caveStepsAppTsx = `// __TITLE__ — step through a dark cave one square at a time: find the stairs down, bump into creatures to fight them, pick
// up potions and gold. Every step you take, the creatures take one too. Our own code. Every part is a named block below, so
// any of it can be changed by asking: the OPTIONS (cave size, sight, health), the CREATURES, the ITEMS, the LOOKS, the COPY.
// Ideas studied (no code taken): caves grown from noise and smoothed so they look natural, a check that the stairs can always
// be reached, a field of view with remembered squares, turn-based moves where bumping is attacking, creatures that wake when
// they see you, and deeper floors that get harder.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'cave-steps-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  width: 24, height: 18,
  wallChance: 0.44,      // starting noise; more = tighter caves
  smoothing: 4,          // smoothing passes
  sight: 5,              // squares you can see
  health: 12,
  attack: 3,
  creaturesPerFloor: 4,  // plus one more per floor
  potions: 2, gold: 4,
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Gold', best: 'Deepest', level: 'Floor', health: 'Health',
    help: 'Arrow keys / WASD or the pad. Find > to go deeper.', down: 'You go down the stairs', hit: 'You hit', hurt: 'hits you',
    beat: 'You beat', potion: 'A potion: +5 health', gold: 'Gold!', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'सोना', best: 'सबसे गहरा', level: 'मंज़िल', health: 'जान',
    help: 'तीर / WASD या बटन। नीचे जाने के लिए > ढूँढो।', down: 'आप सीढ़ियों से नीचे गए', hit: 'आपने मारा', hurt: 'ने आपको मारा',
    beat: 'आपने हराया', potion: 'दवा: +5 जान', gold: 'सोना!', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── CREATURES AND ITEMS ─────────────────────────────────────────────────────
export const CREATURES = {
  bat: { glyph: '🦇', hp: 3, attack: 1, en: 'the bat', hi: 'चमगादड़', from: 1 },
  rat: { glyph: '🐀', hp: 5, attack: 2, en: 'the rat', hi: 'चूहा', from: 1 },
  snake: { glyph: '🐍', hp: 7, attack: 3, en: 'the snake', hi: 'साँप', from: 3 },
  troll: { glyph: '👹', hp: 12, attack: 4, en: 'the troll', hi: 'राक्षस', from: 5 },
};
export type CreatureKind = keyof typeof CREATURES;
export interface Creature { kind: CreatureKind; x: number; y: number; hp: number; awake: boolean }
export interface Item { kind: 'potion' | 'gold'; x: number; y: number }
export interface Floor { w: number; h: number; walls: boolean[]; stairs: [number, number]; start: [number, number]; creatures: Creature[]; items: Item[] }

// ── RULES — pure ────────────────────────────────────────────────────────────
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

const at = (f: { w: number }, x: number, y: number) => y * f.w + x;
export const isWall = (f: Floor, x: number, y: number) => x < 0 || y < 0 || x >= f.w || y >= f.h || f.walls[at(f, x, y)];

/** Grow a cave: noise, then smoothing (a square becomes wall when most neighbours are walls). The edge is always wall. */
export function growCave(w: number, h: number, r: () => number, o = OPTIONS): boolean[] {
  let walls = Array.from({ length: w * h }, (_, i) => { const x = i % w, y = Math.floor(i / w); return x === 0 || y === 0 || x === w - 1 || y === h - 1 || r() < o.wallChance; });
  for (let pass = 0; pass < o.smoothing; pass++) {
    walls = walls.map((_, i) => {
      const x = i % w, y = Math.floor(i / w);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return true;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && walls[(y + dy) * w + x + dx]) n++;
      return n >= 5 || (n <= 1 && pass < 2);       // early passes also fill lonely open specks with rock pillars
    });
  }
  return walls;
}

/** Every open square reachable from (x, y), as a list of [x, y]. */
export function reachable(f: { w: number; h: number; walls: boolean[] }, x: number, y: number): [number, number][] {
  const seen = new Set<number>([at(f, x, y)]), out: [number, number][] = [], queue: [number, number][] = [[x, y]];
  while (queue.length) {
    const [cx, cy] = queue.shift()!; out.push([cx, cy]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, k = at(f, nx, ny);
      if (nx > 0 && ny > 0 && nx < f.w - 1 && ny < f.h - 1 && !f.walls[k] && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
    }
  }
  return out;
}

/** A whole floor: the biggest open cave (cut off pockets are filled in), stairs far from the start, creatures and items. */
export function makeFloor(depth: number, seed: number, o = OPTIONS): Floor {
  const r = rng(seed * 7919 + depth);
  for (let attempt = 0; ; attempt++) {
    const w = o.width, h = o.height, walls = growCave(w, h, r, o), base = { w, h, walls };
    let biggest: [number, number][] = [];
    const done = new Set<number>();
    for (let i = 0; i < walls.length; i++) {
      if (walls[i] || done.has(i)) continue;
      const zone = reachable(base, i % w, Math.floor(i / w));
      zone.forEach(([x, y]) => done.add(at(base, x, y)));
      if (zone.length > biggest.length) biggest = zone;
    }
    if (biggest.length < w * h * 0.3 && attempt < 30) continue;
    const keep = new Set(biggest.map(([x, y]) => at(base, x, y)));
    const finalWalls = walls.map((_, i) => !keep.has(i));
    const start = biggest[Math.floor(r() * biggest.length)];
    const far = biggest.slice().sort((a, b) => Math.hypot(b[0] - start[0], b[1] - start[1]) - Math.hypot(a[0] - start[0], a[1] - start[1]));
    const stairs = far[Math.floor(r() * Math.max(1, Math.floor(far.length / 6)))];
    const free = biggest.filter(([x, y]) => (x !== start[0] || y !== start[1]) && (x !== stairs[0] || y !== stairs[1]) && Math.hypot(x - start[0], y - start[1]) > 3);
    const take = () => free.splice(Math.floor(r() * free.length), 1)[0];
    const kinds = (Object.keys(CREATURES) as CreatureKind[]).filter((k) => CREATURES[k].from <= depth);
    const creatures: Creature[] = [];
    for (let k = 0; k < o.creaturesPerFloor + depth - 1 && free.length; k++) {
      const kind = kinds[Math.floor(r() * kinds.length)], [x, y] = take();
      creatures.push({ kind, x, y, hp: CREATURES[kind].hp + Math.floor(depth / 3), awake: false });
    }
    const items: Item[] = [];
    for (let k = 0; k < o.potions && free.length; k++) { const [x, y] = take(); items.push({ kind: 'potion', x, y }); }
    for (let k = 0; k < o.gold && free.length; k++) { const [x, y] = take(); items.push({ kind: 'gold', x, y }); }
    return { w, h, walls: finalWalls, stairs, start, creatures, items };
  }
}

/** Can (x0, y0) see (x1, y1)? Within sight, and no wall on the line between. */
export function canSee(f: Floor, x0: number, y0: number, x1: number, y1: number, o = OPTIONS): boolean {
  if (Math.hypot(x1 - x0, y1 - y0) > o.sight) return false;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 1; i < n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
    if (isWall(f, x, y)) return false;
  }
  return true;
}

/** A creature's step toward the player (it never walks into walls, the player's square or another creature). */
export function creatureStep(f: Floor, c: Creature, px: number, py: number, others: Creature[]): [number, number] {
  const options: [number, number][] = [[c.x + Math.sign(px - c.x), c.y], [c.x, c.y + Math.sign(py - c.y)]];
  if (Math.abs(px - c.x) < Math.abs(py - c.y)) options.reverse();
  for (const [x, y] of options) {
    if ((x === c.x && y === c.y) || isWall(f, x, y) || (x === px && y === py) || others.some((o) => o !== c && o.hp > 0 && o.x === x && o.y === y)) continue;
    return [x, y];
  }
  return [c.x, c.y];
}

export const nextTo = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by) === 1;

function beep(freq: number, len = 0.06) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { cell: 16, wall: '#57534e', floor: '#292524', seen: '#1c1917', dark: '#0c0a09', stairs: '#facc15' };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [depth, setDepth] = useState(1);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [me, setMe] = useState<[number, number]>([0, 0]);
  const [health, setHealth] = useState(OPTIONS.health);
  const [gold, setGold] = useState(0);
  const [best, setBest] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [seed, setSeed] = useState(1);
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function enter(d: number, s: number) {
    const f = makeFloor(d, s);
    setFloor(f); setMe(f.start); setDepth(d); setSeen(new Set());
  }
  function start() {
    const s = Math.floor(Math.random() * 1e9);
    setSeed(s); setHealth(OPTIONS.health); setGold(0); setLog([]); setPhase('play'); enter(1, s);
  }
  const say = (line: string) => setLog((l) => [line, ...l].slice(0, 4));

  function move(dx: number, dy: number) {
    if (phase !== 'play' || !floor) return;
    const f = { ...floor, creatures: floor.creatures.map((c) => ({ ...c })), items: floor.items.slice() };
    let [x, y] = me, hp = health;
    const tx = x + dx, ty = y + dy;
    const foe = f.creatures.find((c) => c.hp > 0 && c.x === tx && c.y === ty);
    if (foe) {                                                     // bumping is attacking
      foe.hp -= OPTIONS.attack; foe.awake = true; beep(300);
      const name = CREATURES[foe.kind][lang === 'en' ? 'en' : 'hi'];
      say(foe.hp <= 0 ? t.beat + ' ' + name : t.hit + ' ' + name);
    } else if (!isWall(f, tx, ty)) { x = tx; y = ty; } else return;
    const item = f.items.find((i) => i.x === x && i.y === y);
    if (item) {
      f.items = f.items.filter((i) => i !== item);
      if (item.kind === 'potion') { hp = Math.min(OPTIONS.health + depth, hp + 5); say(t.potion); beep(700, 0.15); }
      else { setGold((g) => g + 10 * depth); say(t.gold); beep(1100, 0.05); }
    }
    if (x === f.stairs[0] && y === f.stairs[1]) {
      beep(500, 0.3); say(t.down); setHealth(hp);
      const d = depth + 1;
      setBest((prev) => { const b = Math.max(prev, d); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
      enter(d, seed); return;
    }
    for (const c of f.creatures) {                                 // the creatures' turn
      if (c.hp <= 0) continue;
      if (!c.awake && canSee(f, c.x, c.y, x, y)) c.awake = true;
      if (!c.awake) continue;
      if (nextTo(c.x, c.y, x, y)) { hp -= CREATURES[c.kind].attack; say(CREATURES[c.kind][lang === 'en' ? 'en' : 'hi'] + ' ' + t.hurt); beep(150, 0.15); }
      else { const [nx, ny] = creatureStep(f, c, x, y, f.creatures); c.x = nx; c.y = ny; }
    }
    f.creatures = f.creatures.filter((c) => c.hp > 0);
    setFloor(f); setMe([x, y]); setHealth(hp);
    if (hp <= 0) {
      setPhase('over');
      setBest((prev) => { const b = Math.max(prev, depth); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
    }
  }

  useEffect(() => {
    if (!floor) return;
    const s = new Set(seen);
    for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) if (canSee(floor, me[0], me[1], x, y)) s.add(y * floor.w + x);
    setSeen(s);
  }, [floor, me]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, [number, number]> = { ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1],
        ArrowDown: [0, 1], s: [0, 1] };
      if (map[e.key]) { e.preventDefault(); move(...map[e.key]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const L = LOOKS.cell;
  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.level} {depth}</span>
        <span className="badge">{t.health} {Math.max(0, health)}</span>
        <span className="badge">{t.score} {gold}</span>
        <span className="badge">{t.best} {best}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          <p>{phase === 'over' ? t.over + ' — ' + t.level + ' ' + depth : t.help}</p>
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {floor && (
        <div style={{ position: 'relative', width: floor.w * L, height: floor.h * L, background: LOOKS.dark, borderRadius: 8, overflow: 'hidden',
          margin: '0 auto', fontSize: L - 3, lineHeight: L + 'px' }}>
          {floor.walls.map((wall, i) => {
            const x = i % floor.w, y = Math.floor(i / floor.w), known = seen.has(i), lit = known && canSee(floor, me[0], me[1], x, y);
            if (!known) return null;
            const stairs = x === floor.stairs[0] && y === floor.stairs[1];
            return <div key={i} style={{ position: 'absolute', left: x * L, top: y * L, width: L, height: L, textAlign: 'center', opacity: lit ? 1 : 0.45,
              background: wall ? LOOKS.wall : lit ? LOOKS.floor : LOOKS.seen, color: LOOKS.stairs }}>{stairs ? '>' : ''}</div>;
          })}
          {floor.items.filter((i) => canSee(floor, me[0], me[1], i.x, i.y)).map((i) => (
            <div key={'i' + i.x + '-' + i.y} style={{ position: 'absolute', left: i.x * L, top: i.y * L, width: L, textAlign: 'center' }}>{i.kind === 'potion' ? '🧪' : '🪙'}</div>
          ))}
          {floor.creatures.filter((c) => canSee(floor, me[0], me[1], c.x, c.y)).map((c, k) => (
            <div key={'c' + k} style={{ position: 'absolute', left: c.x * L, top: c.y * L, width: L, textAlign: 'center', transition: 'left .1s, top .1s' }}>
              {CREATURES[c.kind].glyph}</div>
          ))}
          <div style={{ position: 'absolute', left: me[0] * L, top: me[1] * L, width: L, height: L, borderRadius: L, background: ACCENT,
            transition: 'left .1s, top .1s' }} />
        </div>
      )}
      {phase === 'play' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: 6, justifyContent: 'center', marginTop: 10 }}>
          <span /><button className="primary" onClick={() => move(0, -1)}>▲</button><span />
          <button className="primary" onClick={() => move(-1, 0)}>◀</button><span /><button className="primary" onClick={() => move(1, 0)}>▶</button>
          <span /><button className="primary" onClick={() => move(0, 1)}>▼</button><span />
        </div>
      )}
      {log.map((line, i) => <div key={i} style={{ opacity: 1 - i * 0.2, fontSize: 14 }}>{line}</div>)}
    </div>
  );
}
`;
