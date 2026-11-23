// Three Leaves — the three-card showdown library template. PLAY COINS ONLY, never real money. Our own code: a real
// 52-card deck, the full three-card ranking (trail, pure sequence, sequence, colour, pair, high card) with tie-breaks and
// A-K-Q / A-2-3 runs, dealt-in cards, show / raise / fold, and a computer that judges its hand and sometimes bluffs. Named
// OPTIONS / RANKING / COPY blocks keep every part editable by chat. Ideas studied (no code taken): pixijs/pixijs (MIT)
// card-tween patterns.
export const threeLeavesAppTsx = `// __TITLE__ — three cards each against the computer: show, raise or fold; the better hand takes the pot. PLAY COINS ONLY —
// pretend coins for fun, never real money, nothing to pay in and no prize. Our own code. Every part is a named block below,
// so any of it can be changed by asking: the OPTIONS (coins, stakes, how bold the computer is), the RANKING names, the
// COPY. Ideas studied (no code taken): a real 52-card deck, the full three-card ranking with tie-breaks, a dealt-in card
// animation, and a computer that judges its hand and sometimes bluffs.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'three-leaves-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  startCoins: 500,      // play coins at the start (pretend coins — never money)
  boot: 10,             // each side puts this in before the deal
  show: 20,             // the stake to see the computer's cards
  raise: 40,            // the stake when you raise
  boldness: 0.5,        // 0 = the computer folds weak hands, 1 = it calls almost anything
  bluff: 0.12,          // how often the computer stays in with a weak hand anyway
  dealMs: 120,          // card deal animation, per card
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Coins', best: 'Best', level: 'Round', deal: 'Deal',
    show: 'Show', raise: 'Raise', fold: 'Fold', you: 'You', cpu: 'Computer', won: 'You win the pot', lost: 'Computer wins',
    tie: 'Tie — pot split', cpuFold: 'Computer folds — pot is yours', youFold: 'You folded', note: 'Play coins only — no real money', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'सिक्के', best: 'सर्वश्रेष्ठ', level: 'दौर', deal: 'बाँटो',
    show: 'शो', raise: 'बढ़ाओ', fold: 'छोड़ो', you: 'आप', cpu: 'कंप्यूटर', won: 'पॉट आपका', lost: 'कंप्यूटर जीता',
    tie: 'बराबर — पॉट बँटा', cpuFold: 'कंप्यूटर ने छोड़ा — पॉट आपका', youFold: 'आपने छोड़ा', note: 'सिर्फ़ खेल के सिक्के — असली पैसा नहीं', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── RANKING — best first ────────────────────────────────────────────────────
export const RANKING = {
  en: ['Trail (three of a kind)', 'Pure sequence', 'Sequence', 'Colour', 'Pair', 'High card'],
  hi: ['ट्रेल (तीन एक जैसे)', 'शुद्ध सीक्वेंस', 'सीक्वेंस', 'कलर', 'जोड़ी', 'बड़ा पत्ता'],
};

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Card { rank: number; suit: '♠' | '♥' | '♦' | '♣' }   // rank 2 … 14 (A)
export const SUITS: Card['suit'][] = ['♠', '♥', '♦', '♣'];
export const rankName = (r: number) => (r <= 10 ? String(r) : ['J', 'Q', 'K', 'A'][r - 11]);

export function deck(r: () => number = Math.random): Card[] {
  const d: Card[] = [];
  for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) d.push({ rank, suit });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/**
 * category 0 (trail) … 5 (high card), then tie-break ranks high to low. Runs: A-K-Q is the best (15), A-2-3 the second
 * best (13.5, above K-Q-J at 13), then by the top card.
 */
export function handValue(h: Card[]): { category: number; tiebreak: number[] } {
  const ranks = h.map((c) => c.rank).sort((a, b) => b - a);
  const flush = h.every((c) => c.suit === h[0].suit);
  const isA23 = ranks[0] === 14 && ranks[1] === 3 && ranks[2] === 2;
  const run = isA23 || (ranks[0] - ranks[1] === 1 && ranks[1] - ranks[2] === 1);
  if (ranks[0] === ranks[2]) return { category: 0, tiebreak: ranks };
  if (run && flush) return { category: 1, tiebreak: isA23 ? [13.5] : [ranks[0] === 14 ? 15 : ranks[0]] };
  if (run) return { category: 2, tiebreak: isA23 ? [13.5] : [ranks[0] === 14 ? 15 : ranks[0]] };
  if (flush) return { category: 3, tiebreak: ranks };
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    const pair = ranks[1], kicker = ranks[0] === ranks[1] ? ranks[2] : ranks[0];
    return { category: 4, tiebreak: [pair, kicker] };
  }
  return { category: 5, tiebreak: ranks };
}

/** > 0: a beats b; < 0: b beats a; 0: a tie. */
export function compareHands(a: Card[], b: Card[]): number {
  const x = handValue(a), y = handValue(b);
  if (x.category !== y.category) return y.category - x.category;
  for (let i = 0; i < Math.max(x.tiebreak.length, y.tiebreak.length); i++) {
    const d = (x.tiebreak[i] ?? 0) - (y.tiebreak[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** How good a hand is, 0 (worst) … 1 (best), for the computer's choice. */
export function strength(h: Card[]): number {
  const v = handValue(h);
  return (5 - v.category) / 5 * 0.8 + (v.tiebreak[0] - 2) / 13 * 0.2;
}

/** Does the computer stay in against a stake? Stronger hands and bolder settings call; sometimes it bluffs. */
export function computerCalls(h: Card[], stake: number, o = OPTIONS, r: () => number = Math.random): boolean {
  const need = 0.42 - o.boldness * 0.3 + (stake >= o.raise ? 0.12 : 0);
  return strength(h) >= need || r() < o.bluff;
}

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.06);
  } catch { /* sound can be blocked */ }
}

function CardView({ card, hidden, delay }: { card: Card; hidden: boolean; delay: number }) {
  const red = card.suit === '♥' || card.suit === '♦';
  return (
    <div className="tl-card" style={{ animationDelay: delay + 'ms', background: hidden ? ACCENT : '#ffffff', color: red ? '#dc2626' : '#111827' }}>
      {hidden ? '🍃' : rankName(card.rank) + card.suit}
    </div>
  );
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'decide' | 'result' | 'over'>('menu');
  const [coins, setCoins] = useState(OPTIONS.startCoins);
  const [best, setBest] = useState(0);
  const [round, setRound] = useState(0);
  const [mine, setMine] = useState<Card[]>([]);
  const [theirs, setTheirs] = useState<Card[]>([]);
  const [pot, setPot] = useState(0);
  const [message, setMessage] = useState('');
  const [reveal, setReveal] = useState(false);
  const t = COPY[lang];

  useEffect(() => {
    try { const v = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(v)) setBest(v); } catch { /* ignore */ }
  }, []);

  function record(c: number) {
    setBest((prev) => { const next = Math.max(prev, c); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
  }

  function dealRound(have: number) {
    if (have < OPTIONS.boot) { setPhase('over'); return; }
    const d = deck();
    setMine([d[0], d[2], d[4]]); setTheirs([d[1], d[3], d[5]]);
    setCoins(have - OPTIONS.boot); setPot(OPTIONS.boot * 2); setReveal(false); setMessage('');
    setRound((r) => r + 1); setPhase('decide'); beep(500);
  }

  function settle(stake: number) {
    const have = coins - stake, total = pot + stake;
    if (!computerCalls(theirs, stake)) {
      const after = have + total; setCoins(after); record(after); setMessage(t.cpuFold); setPhase('result'); beep(880); return;
    }
    const all = total + stake;                                   // the computer matches the stake
    const c = compareHands(mine, theirs);
    const after = c > 0 ? have + all : c === 0 ? have + all / 2 : have;
    setCoins(after); record(after); setReveal(true);
    setMessage(c > 0 ? t.won : c === 0 ? t.tie : t.lost); setPhase(after < OPTIONS.boot ? 'over' : 'result'); beep(c > 0 ? 880 : 240);
  }

  function fold() { setMessage(t.youFold); setReveal(true); setPhase(coins < OPTIONS.boot ? 'over' : 'result'); beep(240); }

  const label = (h: Card[]) => RANKING[lang][handValue(h).category];
  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 16 }}>
      <style>{'@keyframes tl-in{from{transform:translateY(-40px) rotate(-12deg);opacity:0}to{transform:none;opacity:1}}'
        + '.tl-card{width:64px;height:90px;border-radius:8px;display:grid;place-items:center;font-size:22px;font-weight:700;'
        + 'box-shadow:0 2px 6px rgba(0,0,0,.25);animation:tl-in .3s both}'}</style>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 6, margin: '10px 0', flexWrap: 'wrap' }}>
        <span className="badge">{t.score} {coins}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {round}</span>
        {pot > 0 && phase === 'decide' && <span className="badge">Pot {pot}</span>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      <p style={{ fontSize: 12, opacity: 0.75, margin: '4px 0' }}>{t.note}</p>
      {phase === 'menu' && <button className="primary" onClick={() => dealRound(OPTIONS.startCoins)}>{t.play}</button>}
      {phase === 'over' && <p>{t.over} <button className="primary" onClick={() => { setRound(0); dealRound(OPTIONS.startCoins); }}>{t.again}</button></p>}
      {mine.length > 0 && (
        <>
          <p style={{ margin: '8px 0 4px' }}>{t.cpu}{reveal ? ' — ' + label(theirs) : ''}</p>
          <div className="row" style={{ display: 'flex', gap: 8 }} key={'c' + round}>{theirs.map((c, i) => <CardView key={i} card={c} hidden={!reveal} delay={(i * 2 + 1) * OPTIONS.dealMs} />)}</div>
          <p style={{ margin: '12px 0 4px' }}>{t.you} — {label(mine)}</p>
          <div className="row" style={{ display: 'flex', gap: 8 }} key={'m' + round}>{mine.map((c, i) => <CardView key={i} card={c} hidden={false} delay={i * 2 * OPTIONS.dealMs} />)}</div>
        </>
      )}
      {message && <p><b>{message}</b></p>}
      {phase === 'decide' && (
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="primary" onClick={() => settle(OPTIONS.show)} disabled={coins < OPTIONS.show}>{t.show} {OPTIONS.show}</button>
          <button className="primary" onClick={() => settle(OPTIONS.raise)} disabled={coins < OPTIONS.raise}>{t.raise} {OPTIONS.raise}</button>
          <button className="primary" onClick={fold}>{t.fold}</button>
        </div>
      )}
      {phase === 'result' && <button className="primary" style={{ marginTop: 12 }} onClick={() => dealRound(coins)}>{t.deal}</button>}
    </div>
  );
}
`;
