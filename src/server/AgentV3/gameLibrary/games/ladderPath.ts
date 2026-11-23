// Ladder Path — the snakes-and-ladders library template. Our own code: 2–4 players (computer or pass-and-play), the snakes
// and ladders drawn on the board, a token that hops square by square then climbs or slides, a six that rolls again, and
// house rules (exact finish, bounce back) as switches. Named OPTIONS / JUMPS / PLAYERS / COPY blocks keep every part editable
// by chat. Ideas studied (no code taken): britzl/ludobits (MIT) and smokelaboratory/fludo (Apache-2.0) for turn flow.
export const ladderPathAppTsx = `// __TITLE__ — snakes and ladders for 2 to 4 players: you against the computer, or friends passing one phone. Our own code.
// Every part is a named block below, so any of it can be changed by asking: the OPTIONS (players, house rules, speed), the
// JUMPS (every snake and ladder), the PLAYERS (names and colours), the COPY. Ideas studied (no code taken): a board with the
// snakes and ladders drawn on it, a token that hops square by square, then slides or climbs, a six that rolls again,
// house rules as switches, and pass-and-play.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'ladder-path-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  players: 2,             // 2 … 4
  computers: 1,           // how many of the players the computer plays (the rest pass the phone)
  exactFinish: true,      // you must land exactly on 100
  bounceBack: false,      // with exactFinish: an overshoot bounces back from 100 instead of not moving
  sixAgain: true,         // a six rolls again
  hopMs: 140,             // speed of a token's hop
};

// ── JUMPS — from → to (a ladder goes up, a snake comes down) ────────────────
export const JUMPS: Record<number, number> = {
  4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100,
  16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78,
};

export const PLAYERS = [
  { name: { en: 'You', hi: 'आप' }, color: ACCENT },
  { name: { en: 'Computer', hi: 'कंप्यूटर' }, color: '#f59e0b' },
  { name: { en: 'Player 3', hi: 'खिलाड़ी 3' }, color: '#0ea5e9' },
  { name: { en: 'Player 4', hi: 'खिलाड़ी 4' }, color: '#a855f7' },
];

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', roll: 'Roll',
    turn: 'Turn', wins: 'wins!', ladder: 'Ladder!', snake: 'Snake!', six: 'Six — roll again', stay: 'Too far — stay', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', roll: 'पासा फेंको',
    turn: 'बारी', wins: 'जीत गए!', ladder: 'सीढ़ी!', snake: 'साँप!', six: 'छक्का — फिर फेंको', stay: 'ज़्यादा — वहीं रहो', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Move { from: number; path: number[]; landed: number; to: number; via: 'ladder' | 'snake' | null; won: boolean; again: boolean }

/** Problems in a JUMPS table: off the board, a jump from 1 or 100, a jump that starts where another lands. */
export function checkJumps(j: Record<number, number>): string[] {
  const out: string[] = [];
  for (const [a, b] of Object.entries(j).map(([k, v]) => [Number(k), v])) {
    if (a <= 1 || a >= 100 || b < 1 || b > 100 || a === b) out.push(a + ' → ' + b + ' is not a jump on the board');
    if (j[b] !== undefined) out.push(a + ' → ' + b + ' lands on another jump');
  }
  return out;
}

export function takeTurn(pos: number, roll: number, o = OPTIONS, jumps = JUMPS): Move {
  const path: number[] = [];
  let p = pos, dir = 1;
  for (let k = 0; k < roll; k++) {
    if (p === 100) { if (!o.exactFinish || !o.bounceBack) break; dir = -1; }
    p += dir; path.push(p);
  }
  let landed = p;
  if (o.exactFinish && !o.bounceBack && pos + roll > 100) { landed = pos; path.length = 0; }
  if (!o.exactFinish) landed = Math.min(100, landed);
  const to = jumps[landed] ?? landed;
  const via = to > landed ? 'ladder' : to < landed ? 'snake' : null;
  return { from: pos, path, landed, to, via, won: to === 100, again: o.sixAgain && roll === 6 && to !== 100 };
}

/** Square n → grid cell, row 0 at the top; the rows snake left-right, right-left from 1 at the bottom left. */
export function cellOf(n: number): { row: number; col: number } {
  const i = n - 1, fromBottom = Math.floor(i / 10), k = i % 10;
  return { row: 9 - fromBottom, col: fromBottom % 2 === 0 ? k : 9 - k };
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
  const [phase, setPhase] = useState<'menu' | 'play' | 'moving' | 'over'>('menu');
  const [pos, setPos] = useState<number[]>([]);
  const [turn, setTurn] = useState(0);
  const [die, setDie] = useState(1);
  const [note, setNote] = useState('');
  const [winner, setWinner] = useState<number | null>(null);
  const [wins, setWins] = useState(0);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const count = Math.max(2, Math.min(4, OPTIONS.players));
  const isComputer = (i: number) => i >= count - Math.min(count - 1, OPTIONS.computers);
  const live = useRef({ pos, turn });
  live.current = { pos, turn };

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  function start() { setPos(Array(count).fill(1)); setTurn(0); setWinner(null); setNote(''); setPhase('play'); }

  function roll() {
    const { pos: p, turn: who } = live.current;
    const r = 1 + Math.floor(Math.random() * 6);
    setDie(r); beep(440); setPhase('moving');
    const m = takeTurn(p[who], r);
    const frames = [...m.path, ...(m.via ? [m.to] : [])];
    if (!frames.length) setNote(t.stay);
    frames.forEach((sq, k) => window.setTimeout(() => {
      setPos((cur) => cur.map((v, i) => (i === who ? sq : v)));
      beep(k === m.path.length ? (m.via === 'ladder' ? 880 : 180) : 520);
    }, (k + 1) * OPTIONS.hopMs));
    window.setTimeout(() => {
      setNote(m.via === 'ladder' ? t.ladder : m.via === 'snake' ? t.snake : m.again ? t.six : frames.length ? '' : t.stay);
      if (m.won) {
        setWinner(who); setPhase('over'); beep(990);
        if (!isComputer(who)) {
          const w = wins + 1; setWins(w);
          setBest((prev) => { const next = Math.max(prev, w); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
        }
        return;
      }
      if (!m.again) setTurn((who + 1) % count);
      setPhase('play');
    }, (frames.length + 1) * OPTIONS.hopMs + 120);
  }

  // The computer rolls by itself after a short pause.
  useEffect(() => {
    if (phase !== 'play' || !isComputer(turn)) return;
    const id = window.setTimeout(roll, 700);
    return () => window.clearTimeout(id);
  }, [phase, turn]);

  const name = (i: number) => PLAYERS[i].name[lang];
  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {wins}</span>
        <span className="badge">{t.best} {best}</span>
        {phase !== 'menu' && <span className="badge" style={{ background: PLAYERS[turn].color, color: '#fff' }}>{t.turn}: {name(turn)}</span>}
        <span className="badge" style={{ fontSize: 20 }}>{DOTS[die]}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase === 'menu' && <button className="primary" onClick={start}>{t.play}</button>}
      {phase === 'over' && winner !== null && <p>{name(winner)} {t.wins} {t.over}. <button className="primary" onClick={start}>{t.again}</button></p>}
      {phase === 'play' && !isComputer(turn) && <button className="primary" onClick={roll}>{t.roll} ({name(turn)})</button>}
      {note && <p style={{ margin: '6px 0' }}>{note}</p>}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1', marginTop: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', position: 'absolute', inset: 0 }}>
          {Array.from({ length: 100 }, (_, i) => {
            const row = Math.floor(i / 10), col = i % 10;
            const sq = Array.from({ length: 100 }, (__, k) => k + 1).find((n) => { const c = cellOf(n); return c.row === row && c.col === col; })!;
            return <div key={i} style={{ background: (row + col) % 2 ? '#fef3c7' : '#fde68a', fontSize: 10, padding: 2, color: '#78350f' }}>{sq}</div>;
          })}
        </div>
        <svg viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {Object.entries(JUMPS).map(([a, b]) => {
            const s = cellOf(Number(a)), e = cellOf(b), up = b > Number(a);
            const x1 = s.col * 10 + 5, y1 = s.row * 10 + 5, x2 = e.col * 10 + 5, y2 = e.row * 10 + 5;
            return up
              ? <g key={a} stroke="#92400e" strokeWidth={1.2}><line x1={x1 - 1.5} y1={y1} x2={x2 - 1.5} y2={y2} /><line x1={x1 + 1.5} y1={y1} x2={x2 + 1.5} y2={y2} /></g>
              : <path key={a} d={'M' + x1 + ' ' + y1 + ' Q ' + ((x1 + x2) / 2 + 8) + ' ' + ((y1 + y2) / 2) + ' ' + x2 + ' ' + y2}
                  stroke="#16a34a" strokeWidth={2.2} fill="none" strokeLinecap="round" opacity={0.85} />;
          })}
          {pos.map((p, i) => {
            const c = cellOf(p);
            return <circle key={i} cx={c.col * 10 + 3 + (i % 2) * 4} cy={c.row * 10 + 3 + Math.floor(i / 2) * 4} r={2.6}
              fill={PLAYERS[i].color} stroke="#fff" strokeWidth={0.6} style={{ transition: 'cx 120ms, cy 120ms' }} />;
          })}
        </svg>
      </div>
    </div>
  );
}
`;
