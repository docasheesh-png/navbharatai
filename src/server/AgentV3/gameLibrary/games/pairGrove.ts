// Pair Grove — the library screen for the Memory match starter. A starting point: a later request may change any of it.
export const pairGroveAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'pair-grove-best-v1';
const FACES = ['🦚', '🐯', '🪷', '🥭', '🛺', '🪔', '🎨', '🪕'];
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;
type Card = { id: number; face: string; done: boolean };

function deckFor(pairs: number): Card[] {
  const cards: Card[] = [];
  FACES.slice(0, pairs).forEach((face, i) => {
    cards.push({ id: i * 2, face, done: false }, { id: i * 2 + 1, face, done: false });
  });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = cards[i]; cards[i] = cards[j]; cards[j] = t;
  }
  return cards;
}

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [level, setLevel] = useState(1);
  const [deck, setDeck] = useState<Card[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const pairs = Math.min(8, 3 + level);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n) && n > 0) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open.length !== 2) return;
    const [a, b] = open;
    const ca = deck.find((c) => c.id === a);
    const cb = deck.find((c) => c.id === b);
    const id = window.setTimeout(() => {
      if (ca && cb && ca.face === cb.face) setDeck((d) => d.map((c) => c.id === a || c.id === b ? { ...c, done: true } : c));
      setOpen([]);
    }, 500);
    return () => window.clearTimeout(id);
  }, [open, deck]);

  useEffect(() => {
    if (phase === 'play' && deck.length > 0 && deck.every((c) => c.done)) {
      try { const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 660; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.08); } catch { /* optional */ }
      setBest((prev) => { const next = prev === 0 ? moves : Math.min(prev, moves); try { localStorage.setItem(BEST, String(next)); } catch { /* ignore */ } return next; });
      setPhase('over');
    }
  }, [deck, phase, moves]);

  function start(nextLevel = level) {
    setLevel(nextLevel);
    setDeck(deckFor(Math.min(8, 3 + nextLevel)));
    setOpen([]);
    setMoves(0);
    setPhase('play');
  }

  function flip(card: Card) {
    if (phase !== 'play' || card.done || open.includes(card.id) || open.length === 2) return;
    setOpen((o) => [...o, card.id]);
    if (open.length === 1) setMoves((m) => m + 1);
  }

  function onKey(e: { key: string }) {
    if (e.key === 'Enter') start(phase === 'over' ? level + 1 : level);
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {moves}</span>
        <span className="badge">{t.best} {best || '–'}</span>
        <span className="badge">{t.level} {level}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={() => start(phase === 'over' ? level + 1 : 1)}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {deck.map((card) => {
          const face = card.done || open.includes(card.id);
          return <button key={card.id} onClick={() => flip(card)} style={{ aspectRatio: '1', fontSize: 28, borderRadius: 10, background: face ? ACCENT : '#e5e7eb' }}>{face ? card.face : ''}</button>;
        })}
      </div>
      <p className="muted">{pairs} pairs</p>
    </div>
  );
}
`;
