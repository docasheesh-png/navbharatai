// Rhyme Pair — the library rhyme matcher: English and Hindi sound families, boards where every card has one partner,
// levels, combos, hints and a time cost for misses.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const rhymePairAppTsx = `// __TITLE__ — a board of word cards: tap two that rhyme to clear them, before the clock runs out. Our own code. Every part
// is a named block below, so any of it can be changed by asking: the OPTIONS (pairs per board, seconds, mistakes allowed),
// the RHYMES banks (English and Hindi, in sound families), the COPY. Ideas studied (no code taken): boards built so every
// card has exactly one partner on the board, levels that add pairs and take time away, a combo for quick matches, a hint that
// lights one pair, mistakes that cost time, and a board that shakes on a miss.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'rhyme-pair-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  firstPairs: 4,        // pairs on the first board
  morePairs: 1,         // pairs added each level
  mostPairs: 8,         // never more than this
  seconds: 40,          // time for a board
  missCost: 3,          // seconds lost for a wrong pair
  points: 10,           // per pair, times the combo
  comboWindow: 4,       // seconds between matches to keep a combo going
  hints: 2,             // hints per game
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', time: 'Time',
    hint: 'Hint', combo: 'Combo', ask: 'Tap two words that rhyme', clear: 'Board cleared!', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', time: 'समय',
    hint: 'संकेत', combo: 'कॉम्बो', ask: 'तुकबंदी वाले दो शब्द चुनो', clear: 'बोर्ड साफ़!', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── RHYMES — each line is one sound family; any two words in a family rhyme ──────────────────────────────────────
export const RHYMES: Record<Lang, string[][]> = {
  en: [
    ['cat', 'hat', 'bat', 'mat', 'rat'], ['cake', 'lake', 'make', 'bake', 'snake'], ['sun', 'fun', 'run', 'bun'],
    ['star', 'car', 'jar', 'far'], ['ring', 'sing', 'king', 'wing'], ['boat', 'coat', 'goat', 'float'],
    ['rain', 'train', 'brain', 'chain'], ['ball', 'tall', 'wall', 'call'], ['moon', 'spoon', 'soon', 'noon'],
    ['bed', 'red', 'head', 'bread'], ['tree', 'bee', 'sea', 'key'], ['night', 'light', 'kite', 'bright'],
    ['fish', 'dish', 'wish'], ['frog', 'log', 'dog', 'fog'], ['bear', 'chair', 'pear', 'hair'], ['clock', 'sock', 'rock', 'block'],
  ],
  hi: [
    ['पानी', 'रानी', 'नानी', 'कहानी'], ['दिल', 'मिल', 'तिल', 'खिल'], ['मोर', 'चोर', 'शोर', 'डोर'], ['आम', 'काम', 'नाम', 'शाम'],
    ['गाना', 'खाना', 'जाना', 'दाना'], ['हाथी', 'साथी', 'बाती'], ['घर', 'डर', 'पर', 'सर'], ['बात', 'रात', 'सात', 'मात'],
    ['मेला', 'केला', 'ठेला', 'अकेला'], ['गोल', 'ढोल', 'बोल', 'मोल'], ['झूला', 'भूला', 'फूला'], ['मछली', 'तितली', 'बिजली'],
    ['चिड़िया', 'गुड़िया', 'पुड़िया'], ['बादल', 'पागल', 'काजल'], ['भालू', 'आलू', 'चालू', 'बालू'], ['रोटी', 'चोटी', 'मोटी', 'छोटी'],
  ],
};

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Tile { id: number; word: string; family: number }

export function shuffle<T>(list: T[], r: () => number = Math.random): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Do two words rhyme? True when both sit in the same sound family (and are not the same word). */
export function rhymes(a: string, b: string, bank: string[][]): boolean {
  return a !== b && bank.some((fam) => fam.includes(a) && fam.includes(b));
}

/** Pairs on the board for a level. */
export const pairsFor = (level: number, o = OPTIONS) => Math.min(o.mostPairs, o.firstPairs + o.morePairs * (level - 1));

/** A board: 'pairs' families, two words from each, so every card has exactly one partner. */
export function buildBoard(pairs: number, bank: string[][], r: () => number = Math.random): Tile[] {
  const families = shuffle(bank.map((_, i) => i).filter((i) => bank[i].length >= 2), r).slice(0, pairs);
  const tiles: Tile[] = [];
  for (const f of families) for (const word of shuffle(bank[f], r).slice(0, 2)) tiles.push({ id: tiles.length, word, family: f });
  return shuffle(tiles, r).map((tile, id) => ({ ...tile, id }));
}

/** Points for a match: base times the combo (the combo grows while matches come quickly). */
export const pointsFor = (combo: number, o = OPTIONS) => o.points * Math.max(1, combo);
export const nextCombo = (combo: number, secondsSinceLast: number, o = OPTIONS) => (secondsSinceLast <= o.comboWindow ? combo + 1 : 1);

/** A pair still on the board, for the hint. */
export function findPair(tiles: Tile[], gone: Set<number>): [number, number] | null {
  const left = tiles.filter((x) => !gone.has(x.id));
  for (const a of left) { const b = left.find((x) => x.id !== a.id && x.family === a.family); if (b) return [a.id, b.id]; }
  return null;
}

function beep(freq: number, len = 0.08) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.05; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [level, setLevel] = useState(1);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [gone, setGone] = useState<Set<number>>(new Set());
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [left, setLeft] = useState(OPTIONS.seconds);
  const [combo, setCombo] = useState(0);
  const [lastAt, setLastAt] = useState(0);
  const [hints, setHints] = useState(OPTIONS.hints);
  const [lit, setLit] = useState<number[]>([]);
  const [shake, setShake] = useState(false);
  const t = COPY[lang];
  const live = useRef({ phase, left, score });
  live.current = { phase, left, score };

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    const id = setInterval(() => {
      const st = live.current;
      if (st.phase !== 'play') return;
      if (st.left <= 1) { setLeft(0); end(st.score); } else setLeft(st.left - 1);
    }, 1000);
    return () => clearInterval(id);
  });

  function deal(lv: number, words = lang) {
    setLevel(lv); setTiles(buildBoard(pairsFor(lv), RHYMES[words])); setGone(new Set()); setChosen(null); setLit([]);
    setLeft(Math.max(15, OPTIONS.seconds - 2 * (lv - 1))); setCombo(0); setLastAt(OPTIONS.seconds);
  }

  function start() { setScore(0); setHints(OPTIONS.hints); setPhase('play'); deal(1); }

  function end(final: number) {
    setPhase('over');
    setBest((prev) => { const b = Math.max(prev, final); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
  }

  function tap(tile: Tile) {
    if (phase !== 'play' || gone.has(tile.id)) return;
    if (chosen === null || chosen === tile.id) { setChosen(chosen === tile.id ? null : tile.id); beep(500, 0.04); return; }
    const other = tiles.find((x) => x.id === chosen)!;
    setChosen(null);
    if (rhymes(other.word, tile.word, RHYMES[lang]) || other.family === tile.family) {
      const c = nextCombo(combo, lastAt - left);
      const nextScore = score + pointsFor(c);
      const nowGone = new Set(gone).add(tile.id).add(other.id);
      setGone(nowGone); setCombo(c); setLastAt(left); setScore(nextScore); setLit([]);
      beep(600 + 80 * c, 0.1);
      if (nowGone.size === tiles.length) { beep(990, 0.3); setTimeout(() => deal(level + 1), 700); }
    } else {
      setLeft(Math.max(1, left - OPTIONS.missCost)); setCombo(0); setShake(true); beep(160, 0.25);
      setTimeout(() => setShake(false), 300);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 24 }}>
      <style>{'@keyframes rp-shake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        {phase === 'play' && <span className="badge">{t.time} {left}</span>}
        {combo > 1 && <span className="badge">{t.combo} ×{combo}</span>}
        <button className="badge" disabled={phase === 'play'} onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over} — {t.score} {score}</p>}
      {phase === 'play' && (
        <>
          <p>{gone.size === tiles.length ? t.clear : t.ask}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, animation: shake ? 'rp-shake .3s' : 'none' }}>
            {tiles.map((tile) => {
              const off = gone.has(tile.id);
              return (
                <button key={tile.id} onClick={() => tap(tile)} disabled={off}
                  style={{ minHeight: 64, fontSize: 18, borderRadius: 10, border: '2px solid ' + (lit.includes(tile.id) ? '#f59e0b' : ACCENT),
                    background: chosen === tile.id ? ACCENT : 'transparent', color: chosen === tile.id ? '#fff' : 'inherit',
                    opacity: off ? 0 : 1, transform: off ? 'scale(.6)' : 'none', transition: 'opacity .3s, transform .3s' }}>{tile.word}</button>
              );
            })}
          </div>
          <button className="badge" style={{ marginTop: 10 }} disabled={!hints}
            onClick={() => { const p = findPair(tiles, gone); if (p) { setLit(p); setHints(hints - 1); } }}>{t.hint} ×{hints}</button>
        </>
      )}
    </div>
  );
}
`;
