// Tap Bloom — the Casual library template: tap each flower in full bloom before it wilts, leave the bees alone. Our own
// code: a bud → bloom → wilt window with a visible timer, a rare golden flower, bees that sting, a combo, lives, and a pace
// that rises each level. Named OPTIONS / LOOKS / COPY blocks keep every part editable by chat. Ideas studied (no code
// taken): open-source whack-a-mole timing games.
export const tapBloomAppTsx = `// __TITLE__ — flowers open all over the garden; tap each one while it is in full bloom, before it wilts. Leave the bees
// alone. Our own code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS (plots, lives,
// speeds, the golden flower, bees), the LOOKS, the COPY. Ideas studied (no code taken): whack-a-mole style timing games —
// a window to hit, a rare golden bonus, something you must NOT tap, a combo, and a pace that rises level by level.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'tap-bloom-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  plots: 9,             // flower beds (9 = 3×3, 12 = 4×3, 16 = 4×4)
  lives: 3,             // wilted flowers (or stung taps) before the end
  budSeconds: 0.7,      // a bud grows this long before it blooms (a tap on a bud does nothing)
  bloomSeconds: 1.6,    // the bloom lasts this long on level 1, then it wilts
  spawnEvery: 0.9,      // seconds between new buds on level 1
  speedUp: 0.88,        // each level multiplies bloom time and spawn gap by this
  perLevel: 15,         // blooms tapped to reach the next level
  goldenChance: 0.08,   // a golden flower: 5× points
  beeChance: 0.12,      // a bee: tapping it costs a life
  comboMax: 5,
};

// ── LOOKS ───────────────────────────────────────────────────────────────────
export const LOOKS = { bud: '🌱', bloom: '🌸', golden: '🌻', bee: '🐝', wilted: '🥀', soil: '#92400e', bed: '#a3e635' };

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lives: 'Lives',
    combo: 'Combo', how: 'Tap flowers in full bloom. Not the bees!', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lives: 'जान',
    combo: 'लगातार', how: 'खिले फूल पर टैप करो। मधुमक्खी पर नहीं!', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── RULES — pure ────────────────────────────────────────────────────────────
export type Kind = 'flower' | 'golden' | 'bee';
export interface Plot { kind: Kind; age: number; life: number }
export interface Garden {
  plots: (Plot | null)[]; score: number; lives: number; level: number; tapped: number; combo: number; untilNext: number; over: boolean;
}

export const newGarden = (o = OPTIONS): Garden =>
  ({ plots: Array(o.plots).fill(null), score: 0, lives: o.lives, level: 1, tapped: 0, combo: 0, untilNext: 0.3, over: false });

export const pace = (level: number, o = OPTIONS) => Math.pow(o.speedUp, level - 1);
export const stage = (p: Plot, o = OPTIONS): 'bud' | 'bloom' | 'gone' =>
  p.age < o.budSeconds ? 'bud' : p.age < o.budSeconds + p.life ? 'bloom' : 'gone';

/** Time passes: things grow, a bloom left too long wilts (a flower costs a life, a bee just flies off), new buds appear. */
export function grow(g: Garden, dt: number, r: () => number = Math.random, o = OPTIONS): { garden: Garden; wilted: number[] } {
  if (g.over) return { garden: g, wilted: [] };
  dt = Math.max(0, Math.min(0.1, dt));
  const plots = g.plots.map((p) => (p ? { ...p, age: p.age + dt } : null));
  const wilted: number[] = [];
  let lives = g.lives, combo = g.combo;
  plots.forEach((p, i) => {
    if (!p || stage(p, o) !== 'gone') return;
    if (p.kind !== 'bee') { lives--; combo = 0; wilted.push(i); }
    plots[i] = null;
  });
  let untilNext = g.untilNext - dt;
  if (untilNext <= 0) {
    untilNext += o.spawnEvery * pace(g.level, o);
    const free = plots.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
    if (free.length) {
      const q = r();
      const kind: Kind = q < o.beeChance ? 'bee' : q < o.beeChance + o.goldenChance ? 'golden' : 'flower';
      plots[free[Math.floor(r() * free.length)]] = { kind, age: 0, life: o.bloomSeconds * pace(g.level, o) * (kind === 'golden' ? 0.7 : 1) };
    }
  }
  return { garden: { ...g, plots, lives: Math.max(0, lives), combo, untilNext, over: lives <= 0 }, wilted };
}

/** A tap on one plot. */
export function tapPlot(g: Garden, i: number, o = OPTIONS): { garden: Garden; result: 'picked' | 'golden' | 'stung' | 'early' | 'empty' } {
  const p = g.plots[i];
  if (g.over || !p) return { garden: g, result: 'empty' };
  const plots = g.plots.slice(); plots[i] = null;
  if (p.kind === 'bee') {                               // a bee stings whenever it is tapped
    const lives = g.lives - 1;
    return { garden: { ...g, plots, lives, combo: 0, over: lives <= 0 }, result: 'stung' };
  }
  if (stage(p, o) === 'bud') return { garden: g, result: 'early' };
  const combo = Math.min(o.comboMax, g.combo + 1), tapped = g.tapped + 1;
  const score = g.score + 10 * combo * (p.kind === 'golden' ? 5 : 1) * g.level;
  const level = 1 + Math.floor(tapped / o.perLevel);
  return { garden: { ...g, plots, combo, tapped, score, level }, result: p.kind === 'golden' ? 'golden' : 'picked' };
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.07);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [garden, setGarden] = useState<Garden>(newGarden());
  const [best, setBest] = useState(0);
  const [flash, setFlash] = useState<Record<number, string>>({});
  const t = COPY[lang];
  const live = useRef(garden);

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  function end(g: Garden) {
    setPhase('over'); beep(200);
    setBest((prev) => { const next = Math.max(prev, g.score); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  useEffect(() => {
    if (phase !== 'play') return;
    let last = performance.now(), raf = 0, running = true;
    const frame = (now: number) => {
      if (!running) return;
      const r = grow(live.current, (now - last) / 1000); last = now;
      live.current = r.garden; setGarden(r.garden);
      if (r.wilted.length) { beep(260); setFlash((f) => ({ ...f, ...Object.fromEntries(r.wilted.map((i) => [i, LOOKS.wilted])) })); }
      if (r.garden.over) { running = false; end(r.garden); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, [phase]);

  useEffect(() => {
    if (!Object.keys(flash).length) return;
    const id = window.setTimeout(() => setFlash({}), 400);
    return () => window.clearTimeout(id);
  }, [flash]);

  function tap(i: number) {
    if (phase !== 'play') return;
    const r = tapPlot(live.current, i);
    if (r.result === 'empty' || r.result === 'early') return;
    live.current = r.garden; setGarden(r.garden);
    if (r.result === 'stung') { beep(180); setFlash((f) => ({ ...f, [i]: LOOKS.bee })); if (r.garden.over) end(r.garden); }
    else beep(r.result === 'golden' ? 990 : 600 + r.garden.combo * 60);
  }

  const cols = OPTIONS.plots <= 9 ? 3 : 4;
  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 16 }}>
      <style>{'@keyframes tb-open{from{transform:scale(.4)}to{transform:scale(1)}}.tb-bloom{animation:tb-open .18s ease-out}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {garden.score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {garden.level}</span>
        <span className="badge">{t.lives} {'❤'.repeat(garden.lives)}</span>
        {garden.combo > 1 && <span className="badge">{t.combo} ×{garden.combo}</span>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <p>{phase === 'over' ? t.over + ' ' : t.how + ' '}
          <button className="primary" onClick={() => { live.current = newGarden(); setGarden(live.current); setPhase('play'); }}>
            {phase === 'over' ? t.again : t.play}
          </button>
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', 1fr)', gap: 10, touchAction: 'manipulation', userSelect: 'none' }}>
        {garden.plots.map((p, i) => {
          const s = p ? stage(p) : null;
          const face = flash[i] ?? (!p ? '' : p.kind === 'bee' ? LOOKS.bee : s === 'bud' ? LOOKS.bud : p.kind === 'golden' ? LOOKS.golden : LOOKS.bloom);
          const left = p && s === 'bloom' ? 1 - (p.age - OPTIONS.budSeconds) / p.life : 0;
          return (
            <button key={i} onPointerDown={() => tap(i)}
              style={{ aspectRatio: '1', borderRadius: 14, border: '3px solid ' + LOOKS.soil, background: LOOKS.bed, fontSize: 40, position: 'relative', padding: 0 }}>
              <span key={face + (p ? p.kind : '')} className={s === 'bloom' ? 'tb-bloom' : undefined}>{face}</span>
              {left > 0 && <span style={{ position: 'absolute', left: 6, right: 6, bottom: 6, height: 5, borderRadius: 3, background: 'rgba(0,0,0,.15)' }}>
                <span style={{ display: 'block', height: '100%', width: Math.round(left * 100) + '%', borderRadius: 3, background: ACCENT }} />
              </span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
`;
