import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

const FACES = ['🦚', '🐯', '🪷', '🥭', '🛺', '🪔', '🎨', '🪕'];
const BEST_KEY = 'memory-best-moves-v1';

interface Card { id: number; face: string; done: boolean }

function newDeck(): Card[] {
  const deck: Card[] = [];
  FACES.forEach((face, i) => {
    deck.push({ id: i * 2, face, done: false });
    deck.push({ id: i * 2 + 1, face, done: false });
  });
  // Fisher-Yates: an unbiased shuffle. sort(() => Math.random() - 0.5) is NOT one — it clusters.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  return deck;
}

export default function App() {
  const [deck, setDeck] = useState<Card[]>(newDeck);
  const [open, setOpen] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [best, setBest] = useState<number | null>(() => {
    try {
      const raw = parseInt(localStorage.getItem(BEST_KEY) || '', 10);
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    } catch { return null; }
  });

  const won = useMemo(() => deck.every((c) => c.done), [deck]);

  useEffect(() => {
    if (open.length !== 2) return;
    const [a, b] = open;
    const ca = deck.find((c) => c.id === a);
    const cb = deck.find((c) => c.id === b);
    // A pair stays face-up for a beat either way, so the player can actually see the second card.
    const id = setTimeout(() => {
      if (ca && cb && ca.face === cb.face) {
        setDeck((d) => d.map((c) => (c.id === a || c.id === b ? { ...c, done: true } : c)));
      }
      setOpen([]);
    }, 620);
    return () => clearTimeout(id);
  }, [open, deck]);

  useEffect(() => {
    if (!won) return;
    setBest((prev) => {
      if (prev !== null && prev <= moves) return prev;
      try { localStorage.setItem(BEST_KEY, String(moves)); } catch { /* storage blocked — score just is not kept */ }
      return moves;
    });
  }, [won, moves]);

  function flip(card: Card) {
    if (card.done || open.includes(card.id) || open.length === 2) return;
    setOpen((o) => [...o, card.id]);
    if (open.length === 1) setMoves((m) => m + 1);
  }

  function restart() {
    setDeck(newDeck());
    setOpen([]);
    setMoves(0);
  }

  return (
    <div className="container" style={{ maxWidth: 480, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Memory match</h1>
        <ThemeToggle />
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <span className="badge">Moves {moves}</span>
        <span className="muted">{best === null ? 'No best yet' : 'Best ' + best}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {deck.map((card) => {
          const face = card.done || open.includes(card.id);
          return (
            <button
              key={card.id}
              onClick={() => flip(card)}
              aria-label={face ? card.face : 'Hidden card'}
              style={{
                aspectRatio: '1 / 1', fontSize: 30, borderRadius: 12, cursor: card.done ? 'default' : 'pointer',
                background: face ? 'var(--accent-soft)' : 'var(--card)',
                border: '1px solid var(--border)', opacity: card.done ? 0.45 : 1,
                display: 'grid', placeItems: 'center', transition: 'background .15s, opacity .2s',
              }}
            >
              {face ? card.face : ''}
            </button>
          );
        })}
      </div>

      {won && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          Cleared in {moves} moves{best === moves ? ' — a new best!' : ''}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
        <button className="primary" onClick={restart}>{won ? 'Play again' : 'Restart'}</button>
      </div>
    </div>
  );
}
