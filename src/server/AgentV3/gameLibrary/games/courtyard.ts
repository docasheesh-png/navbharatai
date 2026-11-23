// Courtyard — the two-player race-and-capture board game (library Board template). Our own code: a 7×7 courtyard with 24
// squares round the edge and a path into the centre, a six to come out, safe starred squares, captures that send a token
// back, exact finish, house rules as switches, a computer that weighs captures and danger, legal tokens that glow, hopping
// tokens, and pass-and-play. Named OPTIONS / SIDES / COPY blocks keep every part editable by chat. Ideas studied (no code
// taken): britzl/ludobits (MIT), smokelaboratory/fludo (Apache-2.0).
export const courtyardAppTsx = `// __TITLE__ — a courtyard race for two: bring all your tokens round the courtyard and into the centre. A six brings a token
// out, landing on a rival sends it back, the starred squares are safe. Play the computer or pass the phone. Our own code.
// Every part is a named block below, so any of it can be changed by asking: the OPTIONS (tokens, rules, computer, speed),
// the SIDES (names and colours), the COPY. Ideas studied (no code taken): Ludo-style rules as switches, a computer that
// thinks about captures and safety, legal tokens highlighted, a token that hops, and pass-and-play.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'courtyard-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  tokens: 3,              // tokens per side (1 … 4)
  enterOn: [6],           // rolls that bring a token out of the yard ([1, 6] is a common house rule)
  sixAgain: true,         // a six rolls again
  captureAgain: true,     // a capture rolls again
  threeSixesForfeit: true,// a third six in a row loses the turn
  computer: true,         // false = two people pass the phone
  smartComputer: true,    // false = the computer picks any legal token
  hopMs: 150,
};

export const SIDES = [
  { name: { en: 'You', hi: 'आप' }, color: ACCENT },
  { name: { en: 'Computer', hi: 'कंप्यूटर' }, color: '#f59e0b' },
];

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', roll: 'Roll',
    pick: 'Tap a glowing token', none: 'No move — next turn', captured: 'Captured! Roll again', six: 'Six — roll again',
    wins: 'wins!', forfeit: 'Three sixes — turn lost', lang: 'हिंदी', friend: 'Player 2' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', roll: 'पासा फेंको',
    pick: 'चमकती गोटी चुनो', none: 'कोई चाल नहीं — अगली बारी', captured: 'काट दिया! फिर फेंको', six: 'छक्का — फिर फेंको',
    wins: 'जीत गए!', forfeit: 'तीन छक्के — बारी गई', lang: 'English', friend: 'खिलाड़ी 2' },
} as const;
type Lang = keyof typeof COPY;

// ── BOARD — a 7×7 courtyard: 24 squares round the edge, a short path in to the centre ─────────
export const LOOP = 24;
export const HOME = LOOP + 3;                 // progress: 0 yard, 1…24 round the edge, 25–26 the path in, 27 home
export const START = [0, 12];                 // each side's first square on the loop
export const SAFE = new Set([0, 6, 12, 18]);  // loop squares where nobody can be captured
const RING: [number, number][] = [];
for (let c = 3; c >= 0; c--) RING.push([6, c]);
for (let r = 5; r >= 0; r--) RING.push([r, 0]);
for (let c = 1; c <= 6; c++) RING.push([0, c]);
for (let r = 1; r <= 6; r++) RING.push([r, 6]);
for (let c = 5; c >= 4; c--) RING.push([6, c]);
const PATH_IN: [number, number][][] = [[[5, 3], [4, 3], [3, 3]], [[1, 3], [2, 3], [3, 3]]];

/** The loop square of a token, or null in the yard, on the path in, or home. */
export const loopSquare = (side: number, progress: number) => (progress >= 1 && progress <= LOOP ? (START[side] + progress - 1) % LOOP : null);

/** Where a token is drawn: [row, col] on the 7×7 grid, or null in the yard. */
export function cellOf(side: number, progress: number): [number, number] | null {
  if (progress <= 0) return null;
  const sq = loopSquare(side, progress);
  return sq !== null ? RING[sq] : PATH_IN[side][Math.min(2, progress - LOOP - 1)];
}

// ── RULES — pure ────────────────────────────────────────────────────────────
export type Tokens = number[][];               // tokens[side][i] = progress
export interface Result { tokens: Tokens; path: number[]; captured: boolean; home: boolean; won: boolean; again: boolean }

export function legalMoves(tokens: Tokens, side: number, roll: number, o = OPTIONS): number[] {
  const out: number[] = [];
  tokens[side].forEach((p, i) => {
    if (p === 0) { if (o.enterOn.includes(roll)) out.push(i); return; }
    if (p + roll <= HOME) out.push(i);
  });
  return out;
}

export function moveToken(tokens: Tokens, side: number, i: number, roll: number, o = OPTIONS): Result {
  const from = tokens[side][i];
  const to = from === 0 ? 1 : from + roll;
  const path = from === 0 ? [1] : Array.from({ length: roll }, (_, k) => from + k + 1);
  const next = tokens.map((t) => t.slice());
  next[side][i] = to;
  let captured = false;
  const sq = loopSquare(side, to);
  if (sq !== null && !SAFE.has(sq)) {
    next.forEach((t, s) => {
      if (s === side) return;
      t.forEach((p, k) => { if (loopSquare(s, p) === sq) { t[k] = 0; captured = true; } });
    });
  }
  const home = to === HOME, won = next[side].every((p) => p === HOME);
  return { tokens: next, path, captured, home, won, again: !won && ((o.sixAgain && roll === 6) || (o.captureAgain && captured) || home) };
}

/** The computer's choice: win, capture, reach home, get out of danger, bring a token out, else run the leader. */
export function chooseMove(tokens: Tokens, side: number, roll: number, o = OPTIONS, r: () => number = Math.random): number | null {
  const moves = legalMoves(tokens, side, roll, o);
  if (!moves.length) return null;
  if (!o.smartComputer) return moves[Math.floor(r() * moves.length)];
  const danger = (t: Tokens, s: number, p: number) => {
    const sq = loopSquare(s, p);
    if (sq === null || SAFE.has(sq)) return false;
    return t.some((row, rs) => rs !== s && row.some((q) => {
      const rq = loopSquare(rs, q); if (rq === null) return false;
      const gap = (sq - rq + LOOP) % LOOP; return gap >= 1 && gap <= 6;
    }));
  };
  let best = moves[0], bestScore = -Infinity;
  for (const i of moves) {
    const res = moveToken(tokens, side, i, roll, o), from = tokens[side][i], to = res.tokens[side][i];
    let s = to;                                                   // progress made
    if (res.won) s += 10000;
    if (res.captured) s += 500;
    if (res.home) s += 300;
    if (from === 0) s += 200;
    if (danger(tokens, side, from) && !danger(res.tokens, side, to)) s += 250;
    if (danger(res.tokens, side, to)) s -= 150;
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.06);
  } catch { /* sound can be blocked */ }
}

const DOTS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'roll' | 'pick' | 'moving' | 'over'>('menu');
  const [tokens, setTokens] = useState<Tokens>([[], []]);
  const [turn, setTurn] = useState(0);
  const [die, setDie] = useState(6);
  const [sixes, setSixes] = useState(0);
  const [note, setNote] = useState('');
  const [winner, setWinner] = useState<number | null>(null);
  const [wins, setWins] = useState(0);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const live = useRef({ tokens, turn, die, sixes });
  live.current = { tokens, turn, die, sixes };
  const cpu = (side: number) => OPTIONS.computer && side === 1;
  const sideName = (s: number) => (s === 1 && !OPTIONS.computer ? t.friend : SIDES[s].name[lang]);

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  function start() {
    const n = Math.max(1, Math.min(4, OPTIONS.tokens));
    setTokens([Array(n).fill(0), Array(n).fill(0)]); setTurn(0); setSixes(0); setNote(''); setWinner(null); setPhase('roll');
  }

  function nextTurn(side: number) { setSixes(0); setTurn(1 - side); setPhase('roll'); }

  function roll() {
    const { tokens: tk, turn: side, sixes: s6 } = live.current;
    const r = 1 + Math.floor(Math.random() * 6);
    setDie(r); beep(440);
    const run = r === 6 ? s6 + 1 : 0;
    if (OPTIONS.threeSixesForfeit && run >= 3) { setNote(t.forfeit); window.setTimeout(() => nextTurn(side), 700); return; }
    setSixes(run);
    const moves = legalMoves(tk, side, r);
    if (!moves.length) { setNote(t.none); window.setTimeout(() => nextTurn(side), 700); return; }
    setNote('');
    if (cpu(side)) { const i = chooseMove(tk, side, r); window.setTimeout(() => play(i!, r), 500); return; }
    if (moves.length === 1) { play(moves[0], r); return; }
    setPhase('pick'); setNote(t.pick);
  }

  function play(i: number, r = live.current.die) {
    const { tokens: tk, turn: side } = live.current;
    if (!legalMoves(tk, side, r).includes(i)) return;
    const res = moveToken(tk, side, i, r);
    setPhase('moving');
    res.path.forEach((p, k) => window.setTimeout(() => {
      setTokens((cur) => cur.map((row, s) => (s === side ? row.map((v, j) => (j === i ? p : v)) : row))); beep(520);
    }, (k + 1) * OPTIONS.hopMs));
    window.setTimeout(() => {
      setTokens(res.tokens);
      if (res.won) {
        setWinner(side); setPhase('over'); beep(990);
        if (!cpu(side) && side === 0) {
          const w = wins + 1; setWins(w);
          setBest((prev) => { const next = Math.max(prev, w); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
        }
        return;
      }
      if (res.captured) { setNote(t.captured); beep(880); } else if (r === 6 && res.again) setNote(t.six); else setNote('');
      if (res.again) setPhase('roll'); else nextTurn(side);
    }, (res.path.length + 1) * OPTIONS.hopMs);
  }

  useEffect(() => {
    if (phase !== 'roll' || !cpu(turn)) return;
    const id = window.setTimeout(roll, 650);
    return () => window.clearTimeout(id);
  }, [phase, turn]);

  const legal = phase === 'pick' ? legalMoves(tokens, turn, die) : [];
  const SZ = 100 / 7;
  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 16 }}>
      <style>{'@keyframes cy-glow{50%{stroke-width:1.6}}.cy-legal{animation:cy-glow .8s infinite;cursor:pointer}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {wins}</span>
        <span className="badge">{t.best} {best}</span>
        {phase !== 'menu' && <span className="badge" style={{ background: SIDES[turn].color, color: '#fff' }}>{sideName(turn)}</span>}
        <span className="badge" style={{ fontSize: 20 }}>{DOTS[die]}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase === 'menu' && <button className="primary" onClick={start}>{t.play}</button>}
      {phase === 'over' && winner !== null && <p>{sideName(winner)} {t.wins} {t.over}. <button className="primary" onClick={start}>{t.again}</button></p>}
      {phase === 'roll' && !cpu(turn) && <button className="primary" onClick={roll}>{t.roll} ({sideName(turn)})</button>}
      {note && <p style={{ margin: '6px 0' }}>{note}</p>}
      <svg viewBox="-2 -2 104 120" style={{ width: '100%', marginTop: 8, userSelect: 'none' }}>
        {RING.map(([r, c], i) => (
          <g key={i}>
            <rect x={c * SZ} y={r * SZ} width={SZ} height={SZ} fill={i === START[0] ? SIDES[0].color : i === START[1] ? SIDES[1].color : '#fef3c7'}
              opacity={i === START[0] || i === START[1] ? 0.45 : 1} stroke="#92400e" strokeWidth={0.4} />
            {SAFE.has(i) && <text x={c * SZ + SZ / 2} y={r * SZ + SZ / 2 + 2.2} fontSize={6} textAnchor="middle">★</text>}
          </g>
        ))}
        {PATH_IN.map((path, s) => path.map(([r, c], k) => (
          <rect key={s + '-' + k} x={c * SZ} y={r * SZ} width={SZ} height={SZ} fill={k === 2 ? '#fde68a' : SIDES[s].color} opacity={k === 2 ? 1 : 0.3} stroke="#92400e" strokeWidth={0.4} />
        )))}
        {tokens.map((row, s) => row.map((p, i) => {
          const cell = cellOf(s, p);
          const x = cell ? cell[1] * SZ + SZ / 2 + (i - (row.length - 1) / 2) * 2.4 : 8 + i * 9 + s * 52;
          const y = cell ? cell[0] * SZ + SZ / 2 + (s ? -2 : 2) : 108;
          const can = s === turn && legal.includes(i);
          return <circle key={s + '-' + i} cx={x} cy={y} r={3.2} fill={SIDES[s].color} stroke={can ? '#111827' : '#ffffff'} strokeWidth={0.8}
            className={can ? 'cy-legal' : undefined} onClick={() => can && play(i)} />;
        }))}
      </svg>
    </div>
  );
}
`;
