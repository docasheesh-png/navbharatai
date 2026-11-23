// Seed Row — the library sowing game (mancala, Kalah rules): seed-by-seed sowing, extra turns, captures,
// an end sweep, an easy or look-ahead computer, and a hint.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const seedRowAppTsx = `// __TITLE__ — a two-row seed-sowing game (the mancala family, played across India as pallanguzhi and others): pick a pit,
// sow its seeds one by one round the board, land in your store for another turn, land in an empty pit of yours to capture.
// Our own code. Every part is a named block below, so any of it can be changed by asking: the RULES (pits, seeds, capture,
// extra turn), the computer's strength, the LOOKS, the COPY. Ideas studied (no code taken): sowing shown seed by seed, the
// last-seed rules made visible, a computer that looks a few moves ahead (with a weaker setting for children), a hint, and
// a score line that shows who is ahead.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'seed-row-best-v1';

// ── RULES — change any of these ─────────────────────────────────────────────
export const RULES = {
  pits: 6,                 // pits on each side
  seeds: 4,                // seeds in each pit at the start
  extraTurn: true,         // last seed in your own store = go again
  capture: true,           // last seed in your own empty pit = take it and the seeds opposite
  lookAhead: 4,            // how many moves the computer thinks ahead (1 = easy, 6 = strong)
  sowMs: 160,              // time per seed in the sowing animation
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'You', best: 'Wins', level: 'Computer', you: 'Your turn',
    them: 'Computer is thinking…', again1: 'Last seed in your store — go again!', took: 'Capture!', won: 'You win!', lost: 'Computer wins',
    draw: 'A draw', hint: 'Hint', easy: 'Easy', hard: 'Hard', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'आप', best: 'जीत', level: 'कंप्यूटर', you: 'आपकी बारी',
    them: 'कंप्यूटर सोच रहा है…', again1: 'आख़िरी बीज आपके घर में — फिर से चलो!', took: 'कब्ज़ा!', won: 'आप जीते!', lost: 'कंप्यूटर जीता',
    draw: 'बराबरी', hint: 'संकेत', easy: 'आसान', hard: 'कठिन', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── THE BOARD — pure ────────────────────────────────────────────────────────
// board[0..n-1] = your pits (left to right), board[n] = your store, board[n+1..2n] = computer pits (right to left), board[2n+1] = its store
export type Board = number[];
export const newBoard = (r = RULES): Board => { const b = Array(2 * r.pits + 2).fill(r.seeds); b[r.pits] = 0; b[2 * r.pits + 1] = 0; return b; };
export const storeOf = (side: 0 | 1, r = RULES) => (side === 0 ? r.pits : 2 * r.pits + 1);
export const pitsOf = (side: 0 | 1, r = RULES) => Array.from({ length: r.pits }, (_, i) => (side === 0 ? i : r.pits + 1 + i));
export const opposite = (pit: number, r = RULES) => 2 * r.pits - pit;

export interface MoveResult { board: Board; again: boolean; captured: number; path: number[]; over: boolean }

/** Sow from a pit: one seed into each following hole, skipping the other side's store. */
export function sow(board: Board, pit: number, side: 0 | 1, r = RULES): MoveResult {
  const b = board.slice(), size = b.length, skip = storeOf(side === 0 ? 1 : 0, r), path: number[] = [];
  let seeds = b[pit], at = pit; b[pit] = 0;
  while (seeds > 0) { at = (at + 1) % size; if (at === skip) continue; b[at]++; seeds--; path.push(at); }
  let captured = 0;
  const mine = pitsOf(side, r);
  if (r.capture && mine.includes(at) && b[at] === 1 && b[opposite(at, r)] > 0) {
    captured = b[at] + b[opposite(at, r)]; b[storeOf(side, r)] += captured; b[at] = 0; b[opposite(at, r)] = 0;
  }
  const again = r.extraTurn && at === storeOf(side, r);
  const over = pitsOf(0, r).every((p) => b[p] === 0) || pitsOf(1, r).every((p) => b[p] === 0);
  if (over) for (const s of [0, 1] as const) for (const p of pitsOf(s, r)) { b[storeOf(s, r)] += b[p]; b[p] = 0; }
  return { board: b, again: again && !over, captured, path, over };
}

export const legal = (board: Board, side: 0 | 1, r = RULES) => pitsOf(side, r).filter((p) => board[p] > 0);
export const total = (board: Board) => board.reduce((a, b) => a + b, 0);

/** The computer's choice: the move with the best store difference looking 'depth' moves ahead (alpha-beta). */
export function bestMove(board: Board, side: 0 | 1, depth = RULES.lookAhead, r = RULES): number {
  const score = (b: Board) => b[storeOf(side, r)] - b[storeOf(side === 0 ? 1 : 0, r)];
  const search = (b: Board, turn: 0 | 1, d: number, alpha: number, beta: number): number => {
    const moves = legal(b, turn, r);
    if (d === 0 || !moves.length) return score(b);
    let best = turn === side ? -Infinity : Infinity;
    for (const m of moves) {
      const res = sow(b, m, turn, r), next: 0 | 1 = res.again ? turn : turn === 0 ? 1 : 0;
      const v = res.over ? score(res.board) : search(res.board, next, d - 1, alpha, beta);
      if (turn === side) { best = Math.max(best, v); alpha = Math.max(alpha, v); } else { best = Math.min(best, v); beta = Math.min(beta, v); }
      if (beta <= alpha) break;
    }
    return best;
  };
  let pick = legal(board, side, r)[0], top = -Infinity;
  for (const m of legal(board, side, r)) {
    const res = sow(board, m, side, r);
    const v = res.over ? score(res.board) : search(res.board, res.again ? side : side === 0 ? 1 : 0, depth - 1, -Infinity, Infinity);
    if (v > top) { top = v; pick = m; }
  }
  return pick;
}

function beep(freq: number, len = 0.04) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { wood: '#78350f', pit: '#451a03', seed: '#fde68a', glow: '#facc15' };
function Pit({ n, big, lit, onClick }: { n: number; big?: boolean; lit?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} style={{ width: big ? 46 : 42, height: big ? 110 : 46, borderRadius: 23, background: LOOKS.pit,
      color: LOOKS.seed, fontWeight: 700, fontSize: 16, border: lit ? '3px solid ' + LOOKS.glow : '3px solid transparent', cursor: onClick ? 'pointer' : 'default' }}>
      {n}
    </button>
  );
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [board, setBoard] = useState<Board>(newBoard());
  const [turn, setTurn] = useState<0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [wins, setWins] = useState(0);
  const [depth, setDepth] = useState(RULES.lookAhead);
  const t = COPY[lang];
  const n = RULES.pits;

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setWins(v); } catch { /* ignore */ }
  }, []);

  function start() { setBoard(newBoard()); setTurn(0); setBusy(false); setLit(null); setNote(''); setPhase('play'); }

  /** Play a move with the seed-by-seed animation, then hand over the turn. */
  function play(pit: number, side: 0 | 1, from: Board) {
    const res = sow(from, pit, side);
    setBusy(true);
    const shown = from.slice(); shown[pit] = 0; setBoard(shown.slice());
    res.path.forEach((hole, i) => setTimeout(() => { shown[hole]++; setBoard(shown.slice()); setLit(hole); beep(600 + (i % 8) * 40); }, (i + 1) * RULES.sowMs));
    setTimeout(() => {
      setBoard(res.board); setLit(null); setBusy(false);
      setNote(res.captured ? t.took + ' +' + res.captured : res.again ? (side === 0 ? t.again1 : '') : '');
      if (res.over) {
        const me = res.board[storeOf(0)], cpu = res.board[storeOf(1)];
        setPhase('over'); setNote(me > cpu ? t.won : me < cpu ? t.lost : t.draw);
        if (me > cpu) setWins((w) => { const v = w + 1; try { localStorage.setItem(BEST, String(v)); } catch { /* ignore */ } return v; });
        return;
      }
      setTurn(res.again ? side : side === 0 ? 1 : 0);
    }, (res.path.length + 1) * RULES.sowMs + 120);
  }

  useEffect(() => {
    if (phase !== 'play' || turn !== 1 || busy) return;
    const id = setTimeout(() => play(bestMove(board, 1, depth), 1, board), 500);
    return () => clearTimeout(id);
  });   // eslint-disable-line react-hooks/exhaustive-deps

  const mine = (p: number) => phase === 'play' && turn === 0 && !busy && board[p] > 0 ? () => play(p, 0, board) : undefined;
  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {board[storeOf(0)]} : {board[storeOf(1)]}</span>
        <span className="badge">{t.best} {wins}</span>
        <button className="badge" onClick={() => setDepth(depth > 2 ? 1 : RULES.lookAhead)}>{t.level}: {depth > 2 ? t.hard : t.easy}</button>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          {phase === 'over' && <p>{t.over} — {note}</p>}
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      <div style={{ background: LOOKS.wood, borderRadius: 24, padding: 10, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <Pit n={board[storeOf(1)]} big lit={lit === storeOf(1)} />
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {pitsOf(1).slice().reverse().map((p) => <Pit key={p} n={board[p]} lit={lit === p} />)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {pitsOf(0).map((p) => <Pit key={p} n={board[p]} lit={lit === p} onClick={mine(p)} />)}
          </div>
        </div>
        <Pit n={board[storeOf(0)]} big lit={lit === n} />
      </div>
      {phase === 'play' && <p>{busy ? '' : turn === 0 ? t.you : t.them} {note}</p>}
      {phase === 'play' && turn === 0 && !busy && (
        <button className="badge" style={{ background: ACCENT, color: '#fff' }} onClick={() => setLit(bestMove(board, 0, 4))}>{t.hint}</button>
      )}
    </div>
  );
}
`;
