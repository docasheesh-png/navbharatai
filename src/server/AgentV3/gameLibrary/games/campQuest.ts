// Camp Quest — the library turn-based adventure: three heroes in speed order, a skill each, guard and potions,
// five camps of foes, levels between fights, and a cave dragon.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const campQuestAppTsx = `// __TITLE__ — a small turn-based adventure: lead three heroes through five camps of foes, choose each hero's move in speed
// order, level up after every win, and beat the cave dragon. Our own code. Every part is a named block below, so any of it
// can be changed by asking: the OPTIONS, the HEROES (stats and skills), the FOES, the CAMPS (who you meet where), the RULES
// (damage, guard, healing, levels), the LOOKS, the COPY. Ideas studied (no code taken): turns in speed order shown as a queue,
// a skill per hero that costs magic, guarding to halve the next hit, foes that pick on the weakest hero, potions as a shared
// supply, experience and levels between fights, and a short battle log.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'camp-quest-best-v1';

// ── OPTIONS ────────────────────────────────────────────────────────────────
export const OPTIONS = { potions: 3, potionHeal: 0.5, potionsPerCamp: 1, foeDelayMs: 650, logLines: 4 };

const COPY = {
  en: { play: 'Start the quest', again: 'Play again', over: 'Game over', won: 'The dragon is beaten — quest complete!', camp: 'Camp', best: 'Best camp',
    attack: 'Attack', guard: 'Guard', potion: 'Potion', pickFoe: 'Pick a foe', pickHero: 'Pick a hero', turn: 'Turn', next: 'Next camp',
    win: 'Camp cleared!', level: 'Lv', foesTurn: 'Foes are moving…', lang: 'हिंदी' },
  hi: { play: 'सफ़र शुरू करो', again: 'फिर खेलो', over: 'खेल खत्म', won: 'ड्रैगन हार गया — सफ़र पूरा!', camp: 'पड़ाव', best: 'सबसे आगे',
    attack: 'वार', guard: 'बचाव', potion: 'दवा', pickFoe: 'दुश्मन चुनो', pickHero: 'नायक चुनो', turn: 'बारी', next: 'अगला पड़ाव',
    win: 'पड़ाव जीत लिया!', level: 'स्तर', foesTurn: 'दुश्मन चल रहे हैं…', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── HEROES — base stats at level 1, and how much each level adds ───────────────
export const HEROES = {
  warrior: { en: 'Warrior', hi: 'योद्धा', icon: '🛡️', hp: 42, mp: 8, atk: 9, def: 6, spd: 4, grow: { hp: 7, mp: 1, atk: 2, def: 1, spd: 0 },
    skill: { en: 'Cleave', hi: 'चौतरफ़ा वार', cost: 4, kind: 'all', power: 0.75 } },
  healer: { en: 'Healer', hi: 'वैद्य', icon: '🌿', hp: 30, mp: 14, atk: 5, def: 4, spd: 6, grow: { hp: 4, mp: 2, atk: 1, def: 1, spd: 1 },
    skill: { en: 'Mend', hi: 'मरहम', cost: 3, kind: 'heal', power: 0.45 } },
  archer: { en: 'Archer', hi: 'तीरंदाज़', icon: '🏹', hp: 32, mp: 9, atk: 8, def: 3, spd: 8, grow: { hp: 5, mp: 1, atk: 2, def: 0, spd: 1 },
    skill: { en: 'Aimed shot', hi: 'निशाना', cost: 3, kind: 'one', power: 2 } },
};
export type HeroKind = keyof typeof HEROES;

// ── FOES ───────────────────────────────────────────────────────────────────
export const FOES = {
  wolf: { en: 'Wolf', hi: 'भेड़िया', icon: '🐺', hp: 18, atk: 7, def: 2, spd: 7, xp: 6 },
  bandit: { en: 'Bandit', hi: 'डाकू', icon: '🥷', hp: 26, atk: 8, def: 4, spd: 5, xp: 9 },
  bat: { en: 'Bat', hi: 'चमगादड़', icon: '🦇', hp: 12, atk: 6, def: 1, spd: 10, xp: 4 },
  troll: { en: 'Troll', hi: 'दानव', icon: '👹', hp: 80, atk: 13, def: 6, spd: 2, xp: 24, breath: 0.6, breathEvery: 4 },
  dragon: { en: 'Cave dragon', hi: 'गुफ़ा ड्रैगन', icon: '🐉', hp: 160, atk: 15, def: 7, spd: 6, xp: 0, breath: 0.8, breathEvery: 3 },
};
export type FoeKind = keyof typeof FOES;

// ── CAMPS — who waits at each camp ───────────────────────────────────────────
export const CAMPS: FoeKind[][] = [['wolf', 'wolf'], ['bandit', 'wolf', 'bandit'], ['bat', 'bat', 'bat', 'bandit'], ['troll', 'bandit'], ['dragon', 'bat']];

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Unit {
  key: string; side: 'hero' | 'foe'; kind: string; icon: string; en: string; hi: string;
  hp: number; maxHp: number; mp: number; maxMp: number; atk: number; def: number; spd: number; guard: boolean;
}
export interface Battle { units: Unit[]; queue: number[]; round: number; potions: number; log: string[] }
export type Action = { kind: 'attack' | 'skill' | 'guard' | 'potion'; target?: number };

/** Total experience needed to pass each level: 20, 60, 120, 200… */
export const xpFor = (level: number) => 10 * level * (level + 1);
export function levelOf(xp: number) { let l = 1; while (xp >= xpFor(l)) l++; return l; }

export function makeHero(kind: HeroKind, level: number): Unit {
  const h = HEROES[kind], up = level - 1;
  const hp = h.hp + h.grow.hp * up, mp = h.mp + h.grow.mp * up;
  return { key: kind, side: 'hero', kind, icon: h.icon, en: h.en, hi: h.hi, hp, maxHp: hp, mp, maxMp: mp,
    atk: h.atk + h.grow.atk * up, def: h.def + h.grow.def * up, spd: h.spd + h.grow.spd * up, guard: false };
}
export function makeFoe(kind: FoeKind, n: number): Unit {
  const f = FOES[kind];
  return { key: kind + n, side: 'foe', kind, icon: f.icon, en: f.en, hi: f.hi, hp: f.hp, maxHp: f.hp, mp: 0, maxMp: 0, atk: f.atk, def: f.def, spd: f.spd, guard: false };
}

/** Living units in speed order (heroes first on a tie). */
export const roundOrder = (units: Unit[]) =>
  units.map((u, i) => i).filter((i) => units[i].hp > 0).sort((a, b) => units[b].spd - units[a].spd || (units[a].side === 'hero' ? -1 : 1));

export function newBattle(camp: number, heroes: Unit[], potions: number): Battle {
  const units = [...heroes.map((h) => ({ ...h, guard: false })), ...CAMPS[camp].map((k, n) => makeFoe(k, n))];
  return { units, queue: roundOrder(units), round: 1, potions, log: [] };
}

/** A hit: attack times power, a small random spread, minus half the defence; never under 1; guarding halves it. */
export function damage(att: Unit, def: Unit, power: number, roll: number): number {
  const raw = Math.max(1, Math.round(att.atk * power * (0.85 + 0.3 * roll) - def.def / 2));
  return def.guard ? Math.max(1, Math.floor(raw / 2)) : raw;
}
export const living = (b: Battle, side: Unit['side']) => b.units.map((u, i) => i).filter((i) => b.units[i].side === side && b.units[i].hp > 0);
export const outcome = (b: Battle): 'won' | 'lost' | null => (!living(b, 'foe').length ? 'won' : !living(b, 'hero').length ? 'lost' : null);
export const actor = (b: Battle) => b.queue[0];

/** Can this action be taken right now? */
export function allowed(b: Battle, a: Action): boolean {
  const me = b.units[actor(b)], t = a.target !== undefined ? b.units[a.target] : undefined;
  if (a.kind === 'guard') return true;
  if (a.kind === 'potion') return me.side === 'hero' && b.potions > 0 && !!t && t.side === 'hero' && t.hp > 0;
  if (a.kind === 'attack') return !!t && t.side !== me.side && t.hp > 0;
  if (me.side === 'foe') return a.kind === 'skill' && !!(FOES[me.kind as FoeKind] as { breath?: number }).breath;
  const s = HEROES[me.kind as HeroKind]?.skill;
  if (!s || me.mp < s.cost) return false;
  if (s.kind === 'one') return !!t && t.side === 'foe' && t.hp > 0;
  if (s.kind === 'heal') return !!t && t.side === 'hero' && t.hp > 0;
  return true;
}

/** Do one action for whoever's turn it is, then move the queue on (a new round when it empties). */
export function act(b0: Battle, a: Action, rnd: () => number = Math.random): Battle {
  const b: Battle = { ...b0, units: b0.units.map((u) => ({ ...u })), queue: b0.queue.slice(), log: b0.log.slice() };
  const me = b.units[actor(b)], t = a.target !== undefined ? b.units[a.target] : undefined;
  me.guard = false;
  if (a.kind === 'guard') { me.guard = true; b.log.push(me.icon + ' 🛡'); }
  else if (a.kind === 'potion' && t) { b.potions--; const heal = Math.round(t.maxHp * OPTIONS.potionHeal); t.hp = Math.min(t.maxHp, t.hp + heal); b.log.push('🧪 ' + t.icon + ' +' + heal); }
  else if (a.kind === 'attack' && t) { const d = damage(me, t, 1, rnd()); t.hp = Math.max(0, t.hp - d); b.log.push(me.icon + ' → ' + t.icon + ' −' + d); }
  else if (a.kind === 'skill' && me.side === 'foe') {
    const power = (FOES[me.kind as FoeKind] as { breath?: number }).breath ?? 1;
    for (const i of living(b, 'hero')) { const h = b.units[i], d = damage(me, h, power, rnd()); h.hp = Math.max(0, h.hp - d); b.log.push(me.icon + ' 🔥 ' + h.icon + ' −' + d); }
  }
  else if (a.kind === 'skill') {
    const s = HEROES[me.kind as HeroKind].skill; me.mp -= s.cost;
    if (s.kind === 'heal' && t) { const heal = Math.round(t.maxHp * s.power); t.hp = Math.min(t.maxHp, t.hp + heal); b.log.push(me.icon + ' ✚ ' + t.icon + ' +' + heal); }
    if (s.kind === 'one' && t) { const d = damage(me, t, s.power, rnd()); t.hp = Math.max(0, t.hp - d); b.log.push(me.icon + ' ◎ ' + t.icon + ' −' + d); }
    if (s.kind === 'all') for (const i of living(b, 'foe')) { const f = b.units[i], d = damage(me, f, s.power, rnd()); f.hp = Math.max(0, f.hp - d); b.log.push(me.icon + ' ✦ ' + f.icon + ' −' + d); }
  }
  b.queue.shift();
  b.queue = b.queue.filter((i) => b.units[i].hp > 0);
  if (!b.queue.length && !outcome(b)) { b.queue = roundOrder(b.units); b.round++; }
  b.log = b.log.slice(-OPTIONS.logLines);
  return b;
}

/** What a foe does: big foes breathe on everyone every few rounds; otherwise go for the weakest hero, sometimes anyone. */
export function foeChoice(b: Battle, rnd: () => number = Math.random): Action {
  const me = b.units[actor(b)], heroes = living(b, 'hero'), f = FOES[me.kind as FoeKind] as { breath?: number; breathEvery?: number };
  if (f.breath && f.breathEvery && b.round % f.breathEvery === 0) return { kind: 'skill' };
  if (me.kind === 'dragon' && me.hp < me.maxHp / 3 && rnd() < 0.2) return { kind: 'guard' };
  const weakest = heroes.slice().sort((x, y) => b.units[x].hp - b.units[y].hp)[0];
  return { kind: 'attack', target: rnd() < 0.6 ? weakest : heroes[Math.floor(rnd() * heroes.length)] };
}
export const xpFrom = (camp: number) => CAMPS[camp].reduce((s, k) => s + FOES[k].xp, 0);

// ── LOOKS ──────────────────────────────────────────────────────────────────
const LOOKS = { hp: '#16a34a', mp: '#2563eb', low: '#dc2626', panel: '#1f2937' };

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.08);
  } catch { /* sound can be blocked */ }
}

function Bar({ value, max, colour }: { value: number; max: number; colour: string }) {
  return <div style={{ height: 6, background: '#0003', borderRadius: 3 }}><div style={{ width: (100 * value) / Math.max(1, max) + '%', height: 6, background: colour, borderRadius: 3 }} /></div>;
}

// ── THE SCREEN ─────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'fight' | 'cleared' | 'over' | 'won'>('menu');
  const [camp, setCamp] = useState(0);
  const [xp, setXp] = useState(0);
  const [battle, setBattle] = useState<Battle | null>(null);
  const [pending, setPending] = useState<Action['kind'] | null>(null);
  const [best, setBest] = useState(0);
  const t = COPY[lang];

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);
  const saveBest = (v: number) => setBest((b) => { const n = Math.max(b, v); try { localStorage.setItem(BEST, String(n)); } catch { /* ignore */ } return n; });
  const party = (level: number) => (Object.keys(HEROES) as HeroKind[]).map((k) => makeHero(k, level));

  function start() { setCamp(0); setXp(0); setPending(null); setBattle(newBattle(0, party(1), OPTIONS.potions)); setPhase('fight'); }
  function nextCamp() {
    if (!battle) return;
    const c = camp + 1; setCamp(c); setPending(null);
    setBattle(newBattle(c, party(levelOf(xp)), battle.potions + OPTIONS.potionsPerCamp)); setPhase('fight');
  }
  function apply(a: Action) {
    if (!battle || !allowed(battle, a)) return;
    const nb = act(battle, a); setPending(null); beep(a.kind === 'attack' ? 300 : 600);
    const end = outcome(nb); setBattle(nb);
    if (end === 'won') {
      saveBest(camp + 1);
      if (camp === CAMPS.length - 1) setPhase('won'); else { setXp((x) => x + xpFrom(camp)); setPhase('cleared'); }
    }
    if (end === 'lost') { saveBest(camp); setPhase('over'); }
  }

  const current = battle && phase === 'fight' ? battle.units[actor(battle)] : null;
  useEffect(() => {
    if (!battle || phase !== 'fight' || !current || current.side !== 'foe') return;
    const id = setTimeout(() => apply(foeChoice(battle)), OPTIONS.foeDelayMs);
    return () => clearTimeout(id);
  });   // eslint-disable-line react-hooks/exhaustive-deps

  function tapUnit(i: number) {
    if (!battle || !pending) return;
    apply({ kind: pending, target: i });
  }
  const skill = current && current.side === 'hero' ? HEROES[current.kind as HeroKind].skill : null;
  const level = levelOf(xp);

  function unitCard(u: Unit, i: number) {
    const isTurn = battle !== null && actor(battle) === i && phase === 'fight';
    return (
      <button key={u.key} className="card" onClick={() => tapUnit(i)} disabled={u.hp <= 0}
        style={{ padding: 8, minWidth: 92, opacity: u.hp > 0 ? 1 : 0.35, outline: isTurn ? '2px solid ' + ACCENT : 'none', textAlign: 'left' }}>
        <div style={{ fontSize: 26 }}>{u.icon}{u.guard ? '🛡' : ''}</div>
        <div style={{ fontSize: 12 }}>{u[lang]} {u.side === 'hero' ? t.level + ' ' + level : ''}</div>
        <Bar value={u.hp} max={u.maxHp} colour={u.hp < u.maxHp / 3 ? LOOKS.low : LOOKS.hp} />
        <div style={{ fontSize: 11 }}>{u.hp}/{u.maxHp}</div>
        {u.maxMp > 0 && <Bar value={u.mp} max={u.maxMp} colour={LOOKS.mp} />}
      </button>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
        <span className="badge">{t.camp} {camp + 1}/{CAMPS.length}</span>
        <span className="badge">{t.level} {level} · XP {xp}</span>
        <span className="badge">🧪 {battle ? battle.potions : OPTIONS.potions}</span>
        <span className="badge">{t.best} {best}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase === 'menu' && <button className="primary" onClick={start}>{t.play}</button>}
      {battle && phase !== 'menu' && (
        <>
          <div className="row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {battle.units.map((u, i) => (u.side === 'foe' ? unitCard(u, i) : null))}
          </div>
          <div style={{ fontSize: 12, minHeight: 64, margin: '8px 0', padding: 6, background: LOOKS.panel, color: '#e5e7eb', borderRadius: 6 }}>
            {battle.log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
          <div className="row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {battle.units.map((u, i) => (u.side === 'hero' ? unitCard(u, i) : null))}
          </div>
          <div style={{ fontSize: 12, margin: '6px 0' }}>{t.turn}: {battle.queue.map((i) => battle.units[i].icon).join(' ')}</div>
        </>
      )}
      {phase === 'fight' && current && current.side === 'hero' && skill && (
        <div className="row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="badge" onClick={() => setPending('attack')}>{t.attack}</button>
          <button className="badge" disabled={current.mp < skill.cost} onClick={() => (skill.kind === 'all' ? apply({ kind: 'skill' }) : setPending('skill'))}>
            {skill[lang]} ({skill.cost})
          </button>
          <button className="badge" onClick={() => apply({ kind: 'guard' })}>{t.guard}</button>
          <button className="badge" disabled={!battle || battle.potions <= 0} onClick={() => setPending('potion')}>{t.potion}</button>
          {pending && <span style={{ fontSize: 12 }}>{pending === 'attack' || (pending === 'skill' && skill.kind === 'one') ? t.pickFoe : t.pickHero}</span>}
        </div>
      )}
      {phase === 'fight' && current && current.side === 'foe' && <p style={{ fontSize: 13 }}>{t.foesTurn}</p>}
      {phase === 'cleared' && <div className="card" style={{ padding: 12 }}><p>{t.win} +{xpFrom(camp)} XP</p><button className="primary" onClick={nextCamp}>{t.next}</button></div>}
      {(phase === 'over' || phase === 'won') && (
        <div className="card" style={{ padding: 12, marginTop: 8 }}><p>{phase === 'won' ? t.won : t.over}</p><button className="primary" onClick={start}>{t.again}</button></div>
      )}
    </div>
  );
}
`;
