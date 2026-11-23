// High Card — higher or lower (library Card template). PLAY COINS ONLY, never real money. Our own code: a real deck that
// runs down, the odds shown for each guess, ties as a switch, a streak that grows and can be kept, lives, and a card flip.
// Named OPTIONS / COPY blocks keep every part editable by chat. Ideas studied (no code taken): open-source hi-lo card games.
export const highCardAppTsx = `// __TITLE__ — higher or lower: guess whether the next card beats the one showing, and build a streak. PLAY COINS ONLY —
// pretend coins, never real money. Our own code. Every part is a named block below, so any of it can be changed by asking:
// the OPTIONS (coins, stake, lives, ties), the COPY. Ideas studied (no code taken): a real deck that runs down (so a player
// who remembers cards gains an edge), the odds shown for each guess, a streak multiplier, a cash-in of the streak, and a
// flip animation for the next card.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'high-card-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  startCoins: 100,      // pretend play coins (never money)
  stake: 10,            // what a streak starts at; each right guess grows it
  lives: 3,             // wrong guesses before the game ends
  tieWins: false,       // true = the same rank counts as right
  showOdds: true,       // show the chance of higher / lower
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Coins', best: 'Best', level: 'Streak', higher: 'Higher',
    lower: 'Lower', bank: 'Keep', lives: 'Lives', left: 'Cards left', right: 'Right!', wrong: 'Wrong', tie: 'Same rank',
    note: 'Play coins only — no real money', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'सिक्के', best: 'सर्वश्रेष्ठ', level: 'लगातार', higher: 'बड़ा',
    lower: 'छोटा', bank: 'रख लो', lives: 'जान', left: 'बचे पत्ते', right: 'सही!', wrong: 'गलत', tie: 'बराबर',
    note: 'सिर्फ़ खेल के सिक्के — असली पैसा नहीं', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Card { rank: number; suit: '♠' | '♥' | '♦' | '♣' }      // rank 2 … 14 (A high)
const SUITS: Card['suit'][] = ['♠', '♥', '♦', '♣'];
export const rankName = (r: number) => (r <= 10 ? String(r) : ['J', 'Q', 'K', 'A'][r - 11]);

export function shuffled(r: () => number = Math.random): Card[] {
  const d: Card[] = [];
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) d.push({ rank, suit });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** The chance the next card (from what is left) is higher / lower / the same rank as this one. */
export function odds(current: Card, left: Card[]): { higher: number; lower: number; same: number } {
  if (!left.length) return { higher: 0, lower: 0, same: 0 };
  const n = left.length;
  return {
    higher: left.filter((c) => c.rank > current.rank).length / n,
    lower: left.filter((c) => c.rank < current.rank).length / n,
    same: left.filter((c) => c.rank === current.rank).length / n,
  };
}

/** Was the guess right? A tie counts only with tieWins. */
export function judge(current: Card, next: Card, guess: 'higher' | 'lower', o = OPTIONS): 'right' | 'wrong' | 'tie' {
  if (next.rank === current.rank) return o.tieWins ? 'right' : 'tie';
  return (next.rank > current.rank) === (guess === 'higher') ? 'right' : 'wrong';
}

/** What a streak pays: the stake grows by half for each right guess in a row. */
export function streakValue(stake: number, streak: number): number {
  return Math.round(stake * Math.pow(1.5, streak));
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.06);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [pile, setPile] = useState<Card[]>([]);
  const [current, setCurrent] = useState<Card | null>(null);
  const [coins, setCoins] = useState(OPTIONS.startCoins);
  const [streak, setStreak] = useState(0);
  const [lives, setLives] = useState(OPTIONS.lives);
  const [best, setBest] = useState(0);
  const [note, setNote] = useState('');
  const [flip, setFlip] = useState(0);
  const t = COPY[lang];

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  function record(c: number) {
    setBest((prev) => { const next = Math.max(prev, c); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  function start() {
    const d = shuffled();
    setCurrent(d[0]); setPile(d.slice(1)); setCoins(OPTIONS.startCoins); setStreak(0); setLives(OPTIONS.lives); setNote(''); setPhase('play');
  }

  function guess(g: 'higher' | 'lower') {
    if (!current || phase !== 'play') return;
    let rest = pile;
    if (!rest.length) rest = shuffled();                       // a fresh deck when this one runs out
    const next = rest[0];
    const verdict = judge(current, next, g);
    setCurrent(next); setPile(rest.slice(1)); setFlip((f) => f + 1);
    if (verdict === 'right') { setStreak((s) => s + 1); setNote(t.right); beep(660 + streak * 60); return; }
    if (verdict === 'tie') { setNote(t.tie); beep(440); return; }
    const l = lives - 1;
    setStreak(0); setLives(l); setNote(t.wrong + ' — ' + rankName(next.rank) + next.suit); beep(200);
    if (l <= 0) { record(coins); setPhase('over'); }
  }

  function bank() {
    if (!streak) return;
    const c = coins + streakValue(OPTIONS.stake, streak);
    setCoins(c); record(c); setStreak(0); setNote('+' + streakValue(OPTIONS.stake, streak)); beep(990);
  }

  const o = current ? odds(current, pile) : null;
  const red = current && (current.suit === '♥' || current.suit === '♦');
  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 16 }}>
      <style>{'@keyframes hc-flip{from{transform:rotateY(90deg)}to{transform:none}}.hc-card{animation:hc-flip .25s ease-out}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {coins}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {streak} (+{streak ? streakValue(OPTIONS.stake, streak) : 0})</span>
        <span className="badge">{t.lives} {'❤'.repeat(Math.max(0, lives))}</span>
        <span className="badge">{t.left} {pile.length}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.75, margin: '4px 0' }}>{t.note}</p>
      {phase === 'menu' && <button className="primary" onClick={start}>{t.play}</button>}
      {phase === 'over' && <p>{t.over} <button className="primary" onClick={start}>{t.again}</button></p>}
      {current && (
        <div key={flip} className="hc-card" style={{ width: 120, height: 170, margin: '16px auto', borderRadius: 12, background: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,.25)', display: 'grid', placeItems: 'center', fontSize: 44, fontWeight: 800,
          color: red ? '#dc2626' : '#111827', border: '3px solid ' + ACCENT }}>
          {rankName(current.rank)}{current.suit}
        </div>
      )}
      {note && <p style={{ textAlign: 'center' }}><b>{note}</b></p>}
      {phase === 'play' && (
        <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
          <button className="primary" onClick={() => guess('higher')}>▲ {t.higher}{OPTIONS.showOdds && o ? ' ' + Math.round(o.higher * 100) + '%' : ''}</button>
          <button className="primary" onClick={() => guess('lower')}>▼ {t.lower}{OPTIONS.showOdds && o ? ' ' + Math.round(o.lower * 100) + '%' : ''}</button>
          <button className="primary" onClick={bank} disabled={!streak}>{t.bank}</button>
        </div>
      )}
    </div>
  );
}
`;
