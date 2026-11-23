// Count Garden — the library number garden: counting, adding, taking away and comparing with flowers, a level that adapts
// both ways, a second try with a hint, and number names in English and Hindi.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const countGardenAppTsx = `// __TITLE__ — a number garden for young learners: count the flowers, add and take away, and say which is more. The game
// moves up when you are doing well and back when it gets hard. Our own code. Every part is a named block below, so any of it
// can be changed by asking: the OPTIONS (rounds, how fast it moves up), the LEVELS (what each one asks), the NUMBER NAMES
// (English and Hindi), the LOOKS, the COPY. Ideas studied (no code taken): counting with real objects before symbols,
// answers that are close numbers (so guessing does not work), a level that adapts both ways, a gentle second try with a
// hint, spoken-style number names in both languages, and stars instead of a harsh score.
import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'count-garden-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  rounds: 12,              // questions in one game
  upAfter: 3,              // right answers in a row to move up a level
  downAfter: 2,            // mistakes in a row to move back a level
  choices: 4,              // answer buttons
  secondTry: true,         // a wrong first answer gives a hint and one more try
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Stars', best: 'Best', level: 'Level', count: 'How many flowers?',
    add: 'How many altogether?', take: 'How many are left?', more: 'Which side has more?', left: 'Left', right: 'Right', same: 'Same',
    great: 'Well done!', again1: 'Try once more —', hint: 'count them one by one', answer: 'It was', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'तारे', best: 'सर्वश्रेष्ठ', level: 'स्तर', count: 'कितने फूल हैं?',
    add: 'कुल कितने हुए?', take: 'कितने बचे?', more: 'किस तरफ़ ज़्यादा हैं?', left: 'बाएँ', right: 'दाएँ', same: 'बराबर',
    great: 'शाबाश!', again1: 'एक बार और —', hint: 'एक-एक करके गिनो', answer: 'जवाब था', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── NUMBER NAMES ────────────────────────────────────────────────────────────
export const NUMBER_NAMES = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
    'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'],
  hi: ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह',
    'अठारह', 'उन्नीस', 'बीस'],
};

// ── LEVELS — what each level asks ───────────────────────────────────────────
export type Kind = 'count' | 'add' | 'take' | 'more';
export const LEVELS: { kind: Kind; max: number }[] = [
  { kind: 'count', max: 5 }, { kind: 'count', max: 10 }, { kind: 'more', max: 10 }, { kind: 'add', max: 10 },
  { kind: 'take', max: 10 }, { kind: 'add', max: 20 }, { kind: 'take', max: 20 },
];

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Question { kind: Kind; a: number; b: number; answer: number | 'left' | 'right' | 'same'; options: (number | string)[] }
const int = (r: () => number, lo: number, hi: number) => lo + (Math.floor(r() * (hi - lo + 1)) % (hi - lo + 1));

/** Close wrong answers around the right one, all different, never below zero, shuffled. */
export function numberOptions(answer: number, n: number, max: number, r: () => number = Math.random): number[] {
  const set = new Set<number>([answer]);
  for (let d = 1; set.size < n && d < 40; d++) for (const c of [answer - d, answer + d]) if (set.size < n && c >= 0 && c <= max + 2) set.add(c);
  const out = [...set];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function makeQuestion(level: number, r: () => number = Math.random, o = OPTIONS): Question {
  const L = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))];
  if (L.kind === 'count') { const a = int(r, 1, L.max); return { kind: 'count', a, b: 0, answer: a, options: numberOptions(a, o.choices, L.max, r) }; }
  if (L.kind === 'add') { const a = int(r, 1, L.max - 1), b = int(r, 1, L.max - a); return { kind: 'add', a, b, answer: a + b, options: numberOptions(a + b, o.choices, L.max, r) }; }
  if (L.kind === 'take') { const a = int(r, 2, L.max), b = int(r, 1, a - 1); return { kind: 'take', a, b, answer: a - b, options: numberOptions(a - b, o.choices, L.max, r) }; }
  const a = int(r, 1, L.max), b = int(r, 1, L.max);
  return { kind: 'more', a, b, answer: a > b ? 'left' : a < b ? 'right' : 'same', options: ['left', 'same', 'right'] };
}

/** The level after an answer: up after a run of right answers, down after a run of mistakes. */
export function adapt(level: number, rightRun: number, wrongRun: number, o = OPTIONS): number {
  if (rightRun >= o.upAfter) return Math.min(LEVELS.length - 1, level + 1);
  if (wrongRun >= o.downAfter) return Math.max(0, level - 1);
  return level;
}

/** Stars for an answer: 2 on the first try, 1 on the second, 0 otherwise. */
export const starsFor = (rightFirstTry: boolean, rightSecondTry: boolean) => (rightFirstTry ? 2 : rightSecondTry ? 1 : 0);

function beep(freq: number, len = 0.1) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.05; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { flower: '🌼', gone: '🍂', size: 30 };
function Patch({ n, faded = 0 }: { n: number; faded?: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', maxWidth: 5 * (LOOKS.size + 8), margin: '0 auto' }}>
      {Array.from({ length: n }, (_, i) => <span key={i} style={{ fontSize: LOOKS.size, opacity: i >= n - faded ? 0.35 : 1 }}>
        {i >= n - faded ? LOOKS.gone : LOOKS.flower}</span>)}
    </div>
  );
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [level, setLevel] = useState(0);
  const [q, setQ] = useState<Question>(() => makeQuestion(0));
  const [round, setRound] = useState(0);
  const [stars, setStars] = useState(0);
  const [best, setBest] = useState(0);
  const [runs, setRuns] = useState({ right: 0, wrong: 0 });
  const [tries, setTries] = useState(0);
  const [note, setNote] = useState('');
  const [locked, setLocked] = useState(false);
  const t = COPY[lang];

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  function start() { setLevel(0); setQ(makeQuestion(0)); setRound(1); setStars(0); setRuns({ right: 0, wrong: 0 }); setTries(0); setNote(''); setPhase('play'); }

  function pick(opt: number | string) {
    if (locked) return;
    const ok = opt === q.answer;
    if (!ok && OPTIONS.secondTry && tries === 0) { setTries(1); setNote(t.again1 + ' ' + t.hint); beep(260); return; }
    const got = starsFor(ok && tries === 0, ok && tries === 1);
    const nr = ok ? { right: runs.right + 1, wrong: 0 } : { right: 0, wrong: runs.wrong + 1 };
    const nl = adapt(level, nr.right, nr.wrong);
    setStars(stars + got); setRuns(nl !== level ? { right: 0, wrong: 0 } : nr);
    setNote(ok ? t.great : t.answer + ' ' + (typeof q.answer === 'number' ? q.answer + ' (' + NUMBER_NAMES[lang][q.answer] + ')' : t[q.answer]));
    beep(ok ? 880 : 200, ok ? 0.15 : 0.3); setLocked(true);
    setTimeout(() => {
      setLocked(false); setTries(0); setNote('');
      if (round >= OPTIONS.rounds) {
        setPhase('over');
        setBest((b) => { const n = Math.max(b, stars + got); try { localStorage.setItem(BEST, String(n)); } catch { /* ignore */ } return n; });
        return;
      }
      setRound(round + 1); setLevel(nl); setQ(makeQuestion(nl));
    }, 1300);
  }

  const label = (o: number | string) => (typeof o === 'number' ? String(o) : t[o as 'left' | 'right' | 'same']);
  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {'⭐'.repeat(Math.min(5, Math.floor(stars / 5)))} {stars}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {level + 1}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16 }}>
          {phase === 'over' && <p>{t.over} — {t.score} {stars}</p>}
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {phase === 'play' && (
        <div className="card" style={{ padding: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 18 }}>{q.kind === 'count' ? t.count : q.kind === 'add' ? t.add : q.kind === 'take' ? t.take : t.more}</p>
          {q.kind === 'count' && <Patch n={q.a} />}
          {q.kind === 'add' && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Patch n={q.a} /><b>+</b><Patch n={q.b} /></div>}
          {q.kind === 'take' && <Patch n={q.a} faded={q.b} />}
          {q.kind === 'more' && <div style={{ display: 'flex', justifyContent: 'space-around' }}><Patch n={q.a} /><Patch n={q.b} /></div>}
          {q.kind !== 'more' && q.kind !== 'count' && <p style={{ fontSize: 20 }}>{q.a} {q.kind === 'add' ? '+' : '−'} {q.b} = ?</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            {q.options.map((o) => <button key={String(o)} className="primary" style={{ minWidth: 64, fontSize: 20, background: ACCENT }}
              onClick={() => pick(o)}>{label(o)}</button>)}
          </div>
          <p style={{ minHeight: 24 }}>{note}</p>
        </div>
      )}
    </div>
  );
}
`;
