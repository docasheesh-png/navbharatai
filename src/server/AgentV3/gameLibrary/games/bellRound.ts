// Bell Round — an original quiz. A starting point: a later request may change any of it.
export const bellRoundAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'bell-round-best-v1';
const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

const ROUNDS = [
  { q: { en: 'How many days are in a week?', hi: 'एक हफ्ते में कितने दिन होते हैं?' }, options: ['5', '7', '10'], answer: 1 },
  { q: { en: 'Which one is a river?', hi: 'इनमें से नदी कौन सी है?' }, options: ['Ganga', 'Table', 'Shoe'], answer: 0 },
  { q: { en: 'What do plants need to grow?', hi: 'पौधों को बढ़ने के लिए क्या चाहिए?' }, options: ['Water', 'Sandals', 'Chalk'], answer: 0 },
  { q: { en: 'How many wheels does a bicycle have?', hi: 'साइकिल में कितने पहिये होते हैं?' }, options: ['1', '2', '8'], answer: 1 },
  { q: { en: 'Which month comes after March?', hi: 'मार्च के बाद कौन सा महीना आता है?' }, options: ['April', 'July', 'Monday'], answer: 0 },
  { q: { en: 'A triangle has how many sides?', hi: 'त्रिभुज की कितनी भुजाएँ होती हैं?' }, options: ['3', '4', '6'], answer: 0 },
];

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [at, setAt] = useState(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const t = COPY[lang];
  const level = at < 3 ? 1 : 2;
  const card = ROUNDS[Math.min(at, ROUNDS.length - 1)];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function beep(freq: number) {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.07);
    } catch { /* optional */ }
  }

  function choose(i: number) {
    if (phase !== 'play') return;
    const right = i === card.answer;
    const next = score + (right ? 10 : 0);
    beep(right ? 660 : 220);
    if (at + 1 >= ROUNDS.length) {
      setScore(next);
      setPhase('over');
      setBest((prev) => { const bestNext = Math.max(prev, next); try { localStorage.setItem(BEST, String(bestNext)); } catch { /* ignore */ } return bestNext; });
      return;
    }
    setScore(next);
    setAt(at + 1);
  }

  function onKey(e: { key: string }) {
    if (e.key === '1' || e.key === 'a') choose(0);
    if (e.key === '2' || e.key === 'b') choose(1);
    if (e.key === '3' || e.key === 'c') choose(2);
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={() => { setAt(0); setScore(0); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      {phase === 'play' && (
        <div className="card" style={{ padding: 16 }}>
          <p>{card.q[lang]}</p>
          {card.options.map((option, i) => <button key={option} className="primary" style={{ display: 'block', marginTop: 8, background: ACCENT }} onClick={() => choose(i)}>{i + 1}. {option}</button>)}
        </div>
      )}
    </div>
  );
}
`;
