// Letter Link — the library five-letter word hunt: repeated-letter scoring, a keyboard that remembers, hard mode, a
// word of the day, English and Hindi (in English letters) word banks, and a guess chart.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const letterLinkAppTsx = `// __TITLE__ — find the hidden five-letter word in six tries; each try links you closer with green (right place), yellow
// (in the word) and grey (not in it). Our own code. Every part is a named block below, so any of it can be changed by
// asking: the OPTIONS (word length, tries, hard mode, a daily word), the WORDS banks (English, and Hindi words written in
// English letters), the COPY. Ideas studied (no code taken): correct handling of repeated letters, an on-screen keyboard that
// remembers what each letter showed, a hard mode that makes you use what you found, a word of the day, flip-in tiles, and a
// guess-count chart with a win streak.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'letter-link-best-v1';         // saves the stats: played, won, streak, best streak, guess chart

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  tries: 6,                                    // guesses allowed
  words: 'english' as keyof typeof WORDS,      // which bank: 'english' or 'hinglish'
  hardMode: false,                             // true = every found letter must be used in later guesses
  daily: false,                                // true = everyone gets the same word each day
  onlyBankWords: false,                        // true = a guess must be a word from the bank
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', won: 'You found it!', lost: 'The word was', score: 'Won',
    best: 'Best streak', streak: 'Streak', short: 'Not enough letters', unknown: 'Not in the word list', hard: 'Hard mode: use',
    enter: 'Enter', del: '⌫', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', won: 'आपने ढूँढ लिया!', lost: 'शब्द था', score: 'जीते',
    best: 'सबसे लंबी लय', streak: 'लगातार', short: 'अक्षर कम हैं', unknown: 'यह शब्द सूची में नहीं है', hard: 'कठिन मोड: इस्तेमाल करो',
    enter: 'भेजो', del: '⌫', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── WORDS — five letters each; add or remove freely ─────────────────────────
export const WORDS = {
  english: ['APPLE', 'BREAD', 'CHAIR', 'DANCE', 'EARTH', 'FLAME', 'GRAPE', 'HOUSE', 'LIGHT', 'MONEY', 'NIGHT', 'OCEAN', 'PLANT',
    'QUEEN', 'RIVER', 'SMILE', 'TABLE', 'WATER', 'YOUTH', 'ZEBRA', 'BRAIN', 'CLOUD', 'DREAM', 'FIELD', 'GLASS', 'HEART', 'KNIFE',
    'LEMON', 'MUSIC', 'NURSE', 'PAINT', 'RADIO', 'SHEEP', 'STONE', 'TIGER', 'TRAIN', 'WHEAT', 'WORLD', 'SPOON', 'BRICK', 'CROWN',
    'EAGLE', 'FRUIT', 'HONEY', 'JUICE', 'MANGO', 'PIANO', 'SUGAR', 'TOWER', 'STORM', 'CANDY', 'CLOCK', 'SHIRT', 'BEACH', 'GREEN',
    'SLEEP', 'SWEET', 'TEETH', 'BOOKS', 'LLAMA'],
  hinglish: ['KAMAL', 'BADAL', 'MAHAL', 'NAGAR', 'SAMAY', 'PAPAD', 'KALAM', 'MANDI', 'CHAAT', 'DHABA', 'TABLA', 'SITAR', 'KURTA',
    'PAANI', 'KHANA', 'GHADI', 'SAPNA', 'DOSTI', 'LASSI', 'BINDI', 'CHAND', 'PATTA', 'KITAB', 'DUNIA', 'JALDI', 'SADAK'],
};

// ── RULES — pure ────────────────────────────────────────────────────────────
export type Mark = 'green' | 'yellow' | 'grey';

/** Mark a guess against the answer. Greens first; a repeated letter only gets yellow while unmatched copies remain. */
export function scoreGuess(guess: string, answer: string): Mark[] {
  const g = guess.toUpperCase(), a = answer.toUpperCase();
  const marks: Mark[] = Array.from({ length: g.length }, () => 'grey');
  const spare: Record<string, number> = {};
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) marks[i] = 'green';
    else spare[a[i]] = (spare[a[i]] || 0) + 1;
  }
  for (let i = 0; i < g.length; i++) {
    if (marks[i] === 'green') continue;
    if (spare[g[i]] > 0) { marks[i] = 'yellow'; spare[g[i]]--; }
  }
  return marks;
}

/** Hard mode: a later guess must keep every green in place and use every yellow. Returns what is missing, or null. */
export function hardModeProblem(guess: string, history: { guess: string; marks: Mark[] }[]): string | null {
  const g = guess.toUpperCase();
  for (const h of history) {
    for (let i = 0; i < h.marks.length; i++) {
      if (h.marks[i] === 'green' && g[i] !== h.guess[i]) return h.guess[i] + ' @' + (i + 1);
    }
    const need: Record<string, number> = {};
    h.marks.forEach((m, i) => { if (m !== 'grey') need[h.guess[i]] = (need[h.guess[i]] || 0) + 1; });
    for (const ch of Object.keys(need)) if (g.split(ch).length - 1 < need[ch]) return ch;
  }
  return null;
}

/** What the keyboard shows for each letter: the best mark it has had (green beats yellow beats grey). */
export function keyStates(history: { guess: string; marks: Mark[] }[]): Record<string, Mark> {
  const rank: Record<Mark, number> = { grey: 0, yellow: 1, green: 2 };
  const out: Record<string, Mark> = {};
  for (const h of history) h.marks.forEach((m, i) => {
    const ch = h.guess[i];
    if (!out[ch] || rank[m] > rank[out[ch]]) out[ch] = m;
  });
  return out;
}

/** The word of the day: the same for everyone on the same date. */
export function dailyIndex(date: Date, n: number): number {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  return ((day * 7919) % n + n) % n;
}

export function pickWord(o = OPTIONS, r: () => number = Math.random, now = new Date()): string {
  const bank = WORDS[o.words];
  return bank[o.daily ? dailyIndex(now, bank.length) : Math.floor(r() * bank.length) % bank.length];
}

export interface Stats { played: number; won: number; streak: number; bestStreak: number; chart: number[] }
export const emptyStats = (o = OPTIONS): Stats => ({ played: 0, won: 0, streak: 0, bestStreak: 0, chart: Array(o.tries).fill(0) });
/** Stats after a game: 'guesses' is how many tries it took, or 0 for a loss. */
export function recordGame(s: Stats, guesses: number): Stats {
  const chart = s.chart.slice();
  if (guesses > 0) chart[guesses - 1] = (chart[guesses - 1] || 0) + 1;
  const streak = guesses > 0 ? s.streak + 1 : 0;
  return { played: s.played + 1, won: s.won + (guesses > 0 ? 1 : 0), streak, bestStreak: Math.max(s.bestStreak, streak), chart };
}

function beep(freq: number, len = 0.06) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.04; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── LOOKS ───────────────────────────────────────────────────────────────────
const COLOURS: Record<Mark, string> = { green: '#16a34a', yellow: '#ca8a04', grey: '#64748b' };
const KEYS = ['QWERTYUIOP', 'ASDFGHJKL', '+ZXCVBNM-'];

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [answer, setAnswer] = useState('');
  const [history, setHistory] = useState<{ guess: string; marks: Mark[] }[]>([]);
  const [typing, setTyping] = useState('');
  const [note, setNote] = useState('');
  const [stats, setStats] = useState<Stats>(emptyStats());
  const t = COPY[lang];
  const size = answer.length || 5;
  const won = history.some((h) => h.marks.every((m) => m === 'green'));
  const live = useRef({ typing, history });      // fast typing: always build on the latest letters
  live.current = { typing, history };

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(BEST) || 'null'); if (s && Array.isArray(s.chart)) setStats(s); } catch { /* ignore */ }
  }, []);

  function start() { setAnswer(pickWord()); setHistory([]); setTyping(''); setNote(''); setPhase('play'); }

  function finish(guesses: number) {
    setPhase('over');
    setStats((s) => { const n = recordGame(s, guesses); try { localStorage.setItem(BEST, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  }

  function press(k: string) {
    if (phase !== 'play') return;
    const { typing, history } = live.current;
    const type = (v: string) => { live.current = { ...live.current, typing: v }; setTyping(v); };
    setNote('');
    if (k === '-' || k === 'BACKSPACE') { type(typing.slice(0, -1)); return; }
    if (k === '+' || k === 'ENTER') {
      if (typing.length < size) { setNote(t.short); beep(150); return; }
      if (OPTIONS.onlyBankWords && !WORDS[OPTIONS.words].includes(typing)) { setNote(t.unknown); beep(150); return; }
      const miss = OPTIONS.hardMode ? hardModeProblem(typing, history) : null;
      if (miss) { setNote(t.hard + ' ' + miss); beep(150); return; }
      const marks = scoreGuess(typing, answer);
      const next = [...history, { guess: typing, marks }];
      live.current = { typing: '', history: next }; setHistory(next); setTyping('');
      marks.forEach((m, i) => setTimeout(() => beep(m === 'green' ? 880 : m === 'yellow' ? 620 : 330), i * 120));
      if (marks.every((m) => m === 'green')) finish(next.length);
      else if (next.length >= OPTIONS.tries) finish(0);
      return;
    }
    if (/^[A-Z]$/.test(k) && typing.length < size) type(typing + k);
  }

  const keys = keyStates(history);
  const rows = Array.from({ length: OPTIONS.tries }, (_, r) => history[r] || { guess: r === history.length ? typing : '', marks: [] as Mark[] });
  const maxChart = Math.max(1, ...stats.chart);
  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 24 }} tabIndex={0} onKeyDown={(e) => press(e.key.toUpperCase())}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {stats.won}/{stats.played}</span>
        <span className="badge">{t.streak} {stats.streak}</span>
        <span className="badge">{t.best} {stats.bestStreak}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over} — {won ? t.won : t.lost + ' ' + answer}</p>}
      {phase === 'over' && (
        <div style={{ margin: '8px 0' }}>
          {stats.chart.map((n, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 2 }}>
              <span style={{ width: 12 }}>{i + 1}</span>
              <div style={{ width: 8 + (180 * n) / maxChart, background: won && history.length === i + 1 ? '#16a34a' : ACCENT, color: '#fff',
                fontSize: 12, padding: '0 4px', borderRadius: 3 }}>{n}</div>
            </div>
          ))}
        </div>
      )}
      {phase !== 'menu' && (
        <div style={{ display: 'grid', gap: 6, justifyContent: 'center', margin: '12px 0' }}>
          {rows.map((row, r) => (
            <div key={r} style={{ display: 'flex', gap: 6 }}>
              {Array.from({ length: size }, (_, i) => {
                const m = row.marks[i];
                return (
                  <div key={i} style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 700,
                    border: '2px solid ' + (m ? COLOURS[m] : row.guess[i] ? ACCENT : '#94a3b8'), background: m ? COLOURS[m] : 'transparent',
                    color: m ? '#fff' : 'inherit', transform: m ? 'rotateX(360deg)' : 'none', transition: 'transform .5s ' + i * 0.12 + 's' }}>
                    {row.guess[i] || ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {note && <p style={{ textAlign: 'center' }}>{note}</p>}
      {phase === 'play' && KEYS.map((line) => (
        <div key={line} style={{ display: 'flex', justifyContent: 'center', gap: 4, margin: 4 }}>
          {line.split('').map((k) => (
            <button key={k} onClick={() => press(k)} style={{ minWidth: k === '+' || k === '-' ? 52 : 30, height: 44, border: 0, borderRadius: 4,
              background: keys[k] ? COLOURS[keys[k]] : '#cbd5e1', color: keys[k] ? '#fff' : '#0f172a', fontWeight: 700 }}>
              {k === '+' ? t.enter : k === '-' ? t.del : k}</button>
          ))}
        </div>
      ))}
    </div>
  );
}
`;
