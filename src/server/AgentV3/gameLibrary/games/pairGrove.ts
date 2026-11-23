// Pair Grove — the memory-pairs library template. Our own code: cards that flip in 3D, a peek at the start, a combo for
// matches in a row, a star rating from the turns, a clock, and a bigger grove each level (up to 18 pairs). Named OPTIONS /
// FACES / COPY blocks keep every part editable by chat. Ideas studied (no code taken): open-source memory games and
// gabrielecirulli/2048 (MIT) for the feel of short, snappy animations.
export const pairGroveAppTsx = `// __TITLE__ — turn two cards, keep them if they match, clear the grove. Our own code. Every part is a named block below, so
// any of it can be changed by asking: the OPTIONS (levels, peek time, flip-back time, combo), the FACES, the COPY.
// Ideas studied (no code taken): cards that really flip, a short peek at the start, a combo for matches in a row, a star
// rating from the number of turns, a clock, and bigger boards level by level.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'pair-grove-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  firstPairs: 4,        // pairs on level 1; each level adds 2, up to the number of FACES
  peekSeconds: 1.5,     // all cards shown face up at the start of a level (0 = no peek)
  flipBackMs: 700,      // how long a wrong pair stays open
  pairPoints: 50,       // points for a match, times the combo
  comboMax: 5,          // the combo stops growing here
  stars: [1.3, 1.8],    // turns ≤ pairs × 1.3 → 3 stars, ≤ pairs × 1.8 → 2 stars, else 1
};

// ── FACES — any emoji, picture or word ──────────────────────────────────────
export const FACES = ['🦚', '🐯', '🪷', '🥭', '🛺', '🪔', '🎨', '🪕', '🐘', '🌶️', '🍵', '🏏', '🪁', '🌼', '🐒', '🥥', '🛕', '🎉'];

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', turns: 'Turns',
    combo: 'Combo', time: 'Time', next: 'Next level', cleared: 'Grove cleared!', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', turns: 'चालें',
    combo: 'लगातार', time: 'समय', next: 'अगला स्तर', cleared: 'सब जोड़े मिल गए!', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Card { id: number; face: string; done: boolean }
export interface Round { deck: Card[]; open: number[]; turns: number; combo: number; score: number; matched: number }

export function makeDeck(pairs: number, r: () => number = Math.random, faces: readonly string[] = FACES): Card[] {
  const n = Math.max(1, Math.min(faces.length, pairs));
  const cards: Card[] = [];
  for (let i = 0; i < n; i++) cards.push({ id: i * 2, face: faces[i], done: false }, { id: i * 2 + 1, face: faces[i], done: false });
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}

export const newRound = (deck: Card[]): Round => ({ deck, open: [], turns: 0, combo: 0, score: 0, matched: 0 });

/**
 * Turn a card. A third card cannot be turned while two are open, nor a card already open or done. When the second card
 * of a turn is open, result says 'match' (they stay) or 'miss' (call closeMiss after flipBackMs).
 */
export function turnCard(s: Round, id: number, o = OPTIONS): { round: Round; result: 'open' | 'match' | 'miss' | 'ignored' } {
  const card = s.deck.find((c) => c.id === id);
  if (!card || card.done || s.open.includes(id) || s.open.length >= 2) return { round: s, result: 'ignored' };
  const open = [...s.open, id];
  if (open.length < 2) return { round: { ...s, open }, result: 'open' };
  const [a, b] = open.map((k) => s.deck.find((c) => c.id === k)!);
  const turns = s.turns + 1;
  if (a.face === b.face) {
    const combo = Math.min(o.comboMax, s.combo + 1);
    return {
      round: { ...s, open: [], turns, combo, score: s.score + o.pairPoints * combo, matched: s.matched + 1,
        deck: s.deck.map((c) => (c.id === a.id || c.id === b.id ? { ...c, done: true } : c)) },
      result: 'match',
    };
  }
  return { round: { ...s, open, turns, combo: 0 }, result: 'miss' };
}

export const closeMiss = (s: Round): Round => ({ ...s, open: [] });
export const cleared = (s: Round) => s.deck.length > 0 && s.deck.every((c) => c.done);
export function starsFor(turns: number, pairs: number, o = OPTIONS): 1 | 2 | 3 {
  return turns <= pairs * o.stars[0] ? 3 : turns <= pairs * o.stars[1] ? 2 : 1;
}
export const pairsFor = (level: number) => Math.min(FACES.length, OPTIONS.firstPairs + (level - 1) * 2);

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.frequency.value = freq; g.gain.value = 0.04; osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.07);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'peek' | 'play' | 'won'>('menu');
  const [level, setLevel] = useState(1);
  const [round, setRound] = useState<Round>(newRound([]));
  const [total, setTotal] = useState(0);
  const [best, setBest] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [shake, setShake] = useState(false);
  const t = COPY[lang];
  const timer = useRef(0);
  const live = useRef(round);              // the latest round, even for two taps before a re-render
  live.current = round;

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer.current);
  }, [phase]);

  function begin(nextLevel: number, carry: number) {
    setLevel(nextLevel); setTotal(carry); setSeconds(0);
    setRound(newRound(makeDeck(pairsFor(nextLevel))));
    if (OPTIONS.peekSeconds > 0) { setPhase('peek'); window.setTimeout(() => setPhase('play'), OPTIONS.peekSeconds * 1000); }
    else setPhase('play');
  }

  function tap(id: number) {
    if (phase !== 'play') return;
    const r = turnCard(live.current, id);
    if (r.result === 'ignored') return;
    live.current = r.round;
    setRound(r.round);
    if (r.result === 'open') beep(520);
    if (r.result === 'match') {
      beep(660 + r.round.combo * 80);
      if (cleared(r.round)) {
        const pairs = pairsFor(level), bonus = starsFor(r.round.turns, pairs) * 100 + Math.max(0, pairs * 10 - seconds);
        const sum = total + r.round.score + bonus;
        setTotal(sum); setPhase('won'); beep(990);
        setBest((prev) => { const next = Math.max(prev, sum); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
      }
    }
    if (r.result === 'miss') {
      beep(240); setShake(true);
      window.setTimeout(() => { live.current = closeMiss(live.current); setRound(live.current); setShake(false); }, OPTIONS.flipBackMs);
    }
  }

  const pairs = pairsFor(level), cols = round.deck.length <= 12 ? 4 : round.deck.length <= 20 ? 5 : 6;
  const stars = starsFor(round.turns, pairs);

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 16 }}>
      <style>{'.pg-card{perspective:600px;aspect-ratio:3/4;border:0;padding:0;background:none;cursor:pointer}'
        + '.pg-in{position:relative;width:100%;height:100%;transition:transform .35s;transform-style:preserve-3d}'
        + '.pg-up .pg-in{transform:rotateY(180deg)}'
        + '.pg-face{position:absolute;inset:0;border-radius:10px;display:grid;place-items:center;backface-visibility:hidden;font-size:30px}'
        + '.pg-front{transform:rotateY(180deg);background:#fff7ed;box-shadow:inset 0 0 0 2px #fdba74}'
        + '.pg-done .pg-front{opacity:.45}'
        + '@keyframes pg-shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}'
        + '.pg-shake{animation:pg-shake .25s 2}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {total + round.score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        <span className="badge">{t.turns} {round.turns}</span>
        {round.combo > 1 && <span className="badge">{t.combo} ×{round.combo}</span>}
        <span className="badge">{t.time} {seconds}s</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase === 'menu' && <button className="primary" onClick={() => begin(1, 0)}>{t.play}</button>}
      {phase === 'won' && (
        <p>{t.cleared} {'★'.repeat(stars)}{'☆'.repeat(3 - stars)}{' '}
          <button className="primary" onClick={() => begin(level + 1, total)}>{t.next}</button>{' '}
          <button className="primary" onClick={() => begin(1, 0)}>{t.again}</button>
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + cols + ', 1fr)', gap: 8 }}>
        {round.deck.map((c) => {
          const up = phase === 'peek' || c.done || round.open.includes(c.id);
          const cls = 'pg-card' + (up ? ' pg-up' : '') + (c.done ? ' pg-done' : '') + (shake && round.open.includes(c.id) ? ' pg-shake' : '');
          return (
            <button key={c.id} className={cls} onClick={() => tap(c.id)} aria-label={up ? c.face : '?'}>
              <div className="pg-in">
                <div className="pg-face" style={{ background: ACCENT, color: '#fff' }}>?</div>
                <div className="pg-face pg-front">{c.face}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
`;
