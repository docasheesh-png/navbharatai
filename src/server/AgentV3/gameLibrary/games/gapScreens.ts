// The next library screens. Each call returns one complete game. A later request may change that file.
// Casino screens use play-coins only. There is no cash-out and no real-money wager.

const COPY = `{
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lang: 'English' },
}`;

export function gapScreen(kind: string, best: string): string {
  return `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = '${best}';
const KIND = '${kind}';
const COPY = ${COPY} as const;
type Lang = keyof typeof COPY;

const WORDS = ['MANGO', 'RIVER', 'TIGER', 'LOTUS'];
const QUIZ = [
  { q: { en: 'How many colours are in a rainbow?', hi: 'इंद्रधनुष में कितने रंग होते हैं?' }, options: ['5', '7', '9'], answer: 1 },
  { q: { en: 'Which animal gives milk?', hi: 'दूध कौन सा जानवर देता है?' }, options: ['Cow', 'Crow', 'Fish'], answer: 0 },
  { q: { en: 'What do you drink when you are thirsty?', hi: 'प्यास लगने पर क्या पीते हैं?' }, options: ['Water', 'Sand', 'Paper'], answer: 0 },
  { q: { en: 'A week has how many days?', hi: 'एक सप्ताह में कितने दिन होते हैं?' }, options: ['7', '10', '4'], answer: 0 },
];

function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.06);
  } catch { /* sound can be blocked */ }
}

export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [score, setScore] = useState(KIND === 'coin-wheel' || KIND === 'coin-dice' || KIND === 'tea-stall' || KIND === 'high-card' || KIND === 'river-ferry' ? 20 : 0);
  const [level, setLevel] = useState(1);
  const [best, setBest] = useState(0);
  const [mark, setMark] = useState(0);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState('');
  const [hold, setHold] = useState(false);
  const t = COPY[lang];
  const word = WORDS[(level - 1) % WORDS.length];
  const quiz = QUIZ[step % QUIZ.length];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    if (KIND !== 'bolt-arena' && KIND !== 'beat-steps' && KIND !== 'tap-bloom' && KIND !== 'slope-ride') return;
    const id = window.setInterval(() => setMark((m) => (m + 3 + level) % 100), 50);
    return () => window.clearInterval(id);
  }, [phase, level]);

  function save(next: number) {
    setBest((prev) => {
      const high = Math.max(prev, next);
      try { localStorage.setItem(BEST, String(high)); } catch { /* ignore */ }
      return high;
    });
  }

  function lose() { save(score); setPhase('over'); beep(180); }
  function gain(n: number) {
    const next = score + n;
    setScore(next);
    beep(n >= 0 ? 640 : 240);
    if (next >= level * 30 && KIND !== 'coin-wheel' && KIND !== 'coin-dice' && KIND !== 'tea-stall' && KIND !== 'high-card' && KIND !== 'river-ferry') setLevel((lv) => lv + 1);
    if ((KIND === 'coin-wheel' || KIND === 'coin-dice' || KIND === 'tea-stall' || KIND === 'high-card' || KIND === 'river-ferry') && next <= 0) lose();
  }

  function tapZone() {
    if (phase !== 'play') return;
    const hit = mark > 40 && mark < 60;
    if (KIND === 'slope-ride') { setHold(true); return; }
    if (!hit && (KIND === 'bolt-arena' || KIND === 'beat-steps')) { lose(); return; }
    gain(hit ? 5 : 1);
  }

  function act(value: string) {
    if (phase !== 'play') return;
    if (KIND === 'letter-link') {
      const next = (picked + value).slice(0, word.length);
      setPicked(next);
      if (next === word) { gain(10); setPicked(''); setStep((s) => s + 1); }
      else if (!word.startsWith(next)) { setPicked(''); gain(-1); }
      return;
    }
    if (KIND === 'count-garden' || KIND === 'odd-one') {
      const right = value === String(KIND === 'count-garden' ? (level % 5) + 1 : quiz.answer);
      if (!right) { lose(); return; }
      gain(5);
      setStep((s) => s + 1);
      return;
    }
    if (KIND === 'camp-quest') { gain(value === 'rest' ? 2 : 4); setStep((s) => s + 1); return; }
    if (KIND === 'high-card') {
      const mine = Math.floor(Math.random() * 13);
      const theirs = Math.floor(Math.random() * 13);
      setPicked(String(mine) + ':' + String(theirs));
      gain(mine >= theirs ? 3 : -3);
      return;
    }
    if (KIND === 'coin-wheel') {
      const spin = Math.floor(Math.random() * 7) - 3;
      setPicked(String(spin));
      gain(spin);
      return;
    }
    if (KIND === 'tea-stall') { gain(value === 'serve' ? 4 : -1); return; }
    if (KIND === 'tower-line') { gain(2); setStep((s) => s + 1); if (step + 1 >= 6 + level) lose(); return; }
    if (KIND === 'cave-steps' || KIND === 'shield-rush' || KIND === 'drum-row' || KIND === 'seed-row') { gain(value === 'miss' ? -2 : 3); setStep((s) => s + 1); return; }
    if (KIND === 'shape-yard' || KIND === 'rhyme-pair') {
      if (value !== 'yes') { lose(); return; }
      gain(5);
      setStep((s) => s + 1);
      return;
    }
    if (KIND === 'road-tale') { gain(value === 'help' ? 3 : 2); setStep((s) => s + 1); return; }
    if (KIND === 'coin-dice') {
      const roll = 1 + Math.floor(Math.random() * 6);
      setPicked(String(roll));
      gain(roll % 2 === 0 ? roll : -roll);
      return;
    }
    if (KIND === 'river-ferry') { gain(value === 'load' ? 4 : -2); return; }
  }

  function onKey(e: { key: string }) {
    if (e.key === ' ' || e.key === 'Enter') tapZone();
    if (/^[1-4]$/.test(e.key)) act(e.key);
  }

  const dots = Array.from({ length: (level % 5) + 1 }, (_, i) => i);

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
      {phase !== 'play' && <button className="primary" onClick={() => { setScore(KIND === 'coin-wheel' || KIND === 'coin-dice' || KIND === 'tea-stall' || KIND === 'high-card' || KIND === 'river-ferry' ? 20 : 0); setStep(0); setPicked(''); setPhase('play'); }}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over}</p>}
      {phase === 'play' && (KIND === 'bolt-arena' || KIND === 'beat-steps' || KIND === 'tap-bloom' || KIND === 'slope-ride') && (
        <div>
          <div style={{ height: 18, background: '#e5e7eb', borderRadius: 8, position: 'relative' }}>
            <div style={{ position: 'absolute', left: '40%', width: '20%', top: 0, bottom: 0, background: ACCENT, opacity: 0.35 }} />
            <div style={{ position: 'absolute', left: mark + '%', width: 8, top: -4, bottom: -4, background: '#111827' }} />
          </div>
          <button className="primary" style={{ marginTop: 12 }} onMouseDown={tapZone} onMouseUp={() => setHold(false)} onTouchStart={tapZone}>{KIND === 'slope-ride' ? (hold ? 'Hold' : 'Go') : 'Tap'}</button>
        </div>
      )}
      {phase === 'play' && KIND === 'count-garden' && (
        <div>
          <p>{dots.map((d) => '●').join(' ')}</p>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} className="primary" style={{ marginRight: 8 }} onClick={() => act(String(n))}>{n}</button>)}
        </div>
      )}
      {phase === 'play' && KIND === 'odd-one' && (
        <div>
          <p>{quiz.q[lang]}</p>
          {quiz.options.map((option, i) => <button key={option} className="primary" style={{ display: 'block', marginTop: 8 }} onClick={() => act(String(i))}>{option}</button>)}
        </div>
      )}
      {phase === 'play' && KIND === 'letter-link' && (
        <div>
          <p>{word}</p>
          <p>{picked || '—'}</p>
          {word.split('').map((ch) => <button key={ch} className="primary" style={{ marginRight: 8 }} onClick={() => act(ch)}>{ch}</button>)}
        </div>
      )}
      {phase === 'play' && (KIND === 'shape-yard' || KIND === 'rhyme-pair') && (
        <div>
          <p>{KIND === 'shape-yard' ? 'How many sides does a square have?' : 'Which word rhymes with play?'}</p>
          <button className="primary" onClick={() => act('yes')}>{KIND === 'shape-yard' ? '4' : 'day'}</button>
          <button className="primary" style={{ marginLeft: 8 }} onClick={() => act('no')}>{KIND === 'shape-yard' ? '3' : 'boat'}</button>
        </div>
      )}
      {phase === 'play' && (KIND === 'high-card' || KIND === 'coin-wheel' || KIND === 'coin-dice' || KIND === 'tea-stall' || KIND === 'river-ferry' || KIND === 'tower-line' || KIND === 'camp-quest' || KIND === 'cave-steps' || KIND === 'shield-rush' || KIND === 'drum-row' || KIND === 'seed-row' || KIND === 'road-tale') && (
        <div>
          {(KIND === 'coin-wheel' || KIND === 'coin-dice') && <p>Play coins only. Nothing here pays real money.</p>}
          <p>{picked || KIND}</p>
          <button className="primary" onClick={() => act(KIND === 'camp-quest' ? 'rest' : KIND === 'tea-stall' ? 'serve' : KIND === 'river-ferry' ? 'load' : KIND === 'road-tale' ? 'help' : KIND === 'shield-rush' ? 'block' : 'go')}>Go</button>
          {(KIND === 'camp-quest' || KIND === 'road-tale' || KIND === 'drum-row' || KIND === 'seed-row') && <button className="primary" style={{ marginLeft: 8 }} onClick={() => act(KIND === 'drum-row' || KIND === 'seed-row' ? 'miss' : 'fight')}>Onward</button>}
        </div>
      )}
    </div>
  );
}
`;
}
