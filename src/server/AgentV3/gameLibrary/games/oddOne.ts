// Odd One — the library odd-one-out: bilingual sets that get harder, the reason shown after each answer, a clock that
// speeds up, lives, hints and a streak.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const oddOneAppTsx = `// __TITLE__ — four things, one does not belong: tap the odd one out, then see why. Our own code. Every part is a named
// block below, so any of it can be changed by asking: the OPTIONS (lives, seconds, rounds), the SETS bank (English and
// Hindi side by side, each with its reason and a difficulty), the COPY. Ideas studied (no code taken): sets that get harder
// as you go, the reason shown after every answer so the player learns, a clock that speeds up, lives instead of an instant
// end, a hint that names the group, and a streak.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'odd-one-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  lives: 3,             // wrong answers before the game ends
  seconds: 12,          // time for the first set
  fastest: 6,           // the clock never goes below this
  speedUp: 0.5,         // seconds taken off after each right answer
  points: 10,           // per right answer, plus the streak
  hints: 2,             // hints per game (shows what the other three share)
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Level', lives: 'Lives',
    hint: 'Hint', ask: 'Which one does not belong?', right: 'Right!', wrong: 'Not quite —', late: "Time's up —", lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'स्तर', lives: 'जान',
    hint: 'संकेत', ask: 'इनमें से कौन अलग है?', right: 'सही!', wrong: 'नहीं —', late: 'समय खत्म —', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── SETS — the first item is the odd one (they are shuffled on screen). level 1 easy … 3 hard ──────────────────────
export interface OddSet { level: 1 | 2 | 3; items: { en: string; hi: string }[]; group: { en: string; hi: string };
  why: { en: string; hi: string } }
const s = (level: 1 | 2 | 3, items: [string, string][], group: [string, string], why: [string, string]): OddSet =>
  ({ level, items: items.map(([en, hi]) => ({ en, hi })), group: { en: group[0], hi: group[1] }, why: { en: why[0], hi: why[1] } });
export const SETS: OddSet[] = [
  s(1, [['🚗 Car', '🚗 कार'], ['🍎 Apple', '🍎 सेब'], ['🍌 Banana', '🍌 केला'], ['🥭 Mango', '🥭 आम']], ['Fruits', 'फल'], ['A car is not a fruit', 'कार फल नहीं है']),
  s(1, [['🐟 Fish', '🐟 मछली'], ['🐄 Cow', '🐄 गाय'], ['🐐 Goat', '🐐 बकरी'], ['🐕 Dog', '🐕 कुत्ता']], ['Animals with legs', 'पैरों वाले जानवर'],
    ['A fish has no legs', 'मछली के पैर नहीं होते']),
  s(1, [['🔺 Triangle', '🔺 त्रिभुज'], ['🔴 Red', '🔴 लाल'], ['🔵 Blue', '🔵 नीला'], ['🟢 Green', '🟢 हरा']], ['Colours', 'रंग'],
    ['A triangle is a shape', 'त्रिभुज एक आकार है']),
  s(1, [['✏️ Pencil', '✏️ पेंसिल'], ['👕 Shirt', '👕 कमीज़'], ['👖 Jeans', '👖 जींस'], ['🧦 Socks', '🧦 मोज़े']], ['Clothes', 'कपड़े'],
    ['A pencil is not worn', 'पेंसिल पहनी नहीं जाती']),
  s(1, [['🌙 Moon', '🌙 चाँद'], ['🌹 Rose', '🌹 गुलाब'], ['🌻 Sunflower', '🌻 सूरजमुखी'], ['🌷 Tulip', '🌷 ट्यूलिप']], ['Flowers', 'फूल'],
    ['The moon is not a flower', 'चाँद फूल नहीं है']),
  s(1, [['🥛 Milk', '🥛 दूध'], ['🚌 Bus', '🚌 बस'], ['🚂 Train', '🚂 रेल'], ['✈️ Plane', '✈️ हवाई जहाज़']], ['Ways to travel', 'सफ़र के साधन'],
    ['Milk is a drink', 'दूध पीने की चीज़ है']),
  s(2, [['9', '9'], ['2', '2'], ['4', '4'], ['8', '8']], ['Even numbers', 'सम संख्याएँ'], ['9 is odd; the rest are even', '9 विषम है, बाकी सम हैं']),
  s(2, [['Whale', 'व्हेल'], ['Shark', 'शार्क'], ['Tuna', 'टूना'], ['Rohu', 'रोहू']], ['Fish', 'मछलियाँ'],
    ['A whale is a mammal, not a fish', 'व्हेल स्तनधारी है, मछली नहीं']),
  s(2, [['Tomato', 'टमाटर'], ['Potato', 'आलू'], ['Carrot', 'गाजर'], ['Radish', 'मूली']], ['Grow under the ground', 'ज़मीन के नीचे उगते हैं'],
    ['A tomato grows on a plant above the ground', 'टमाटर ज़मीन के ऊपर पौधे पर उगता है']),
  s(2, [['Bat', 'चमगादड़'], ['Sparrow', 'गौरैया'], ['Crow', 'कौआ'], ['Pigeon', 'कबूतर']], ['Birds', 'पक्षी'],
    ['A bat flies but is a mammal', 'चमगादड़ उड़ता है पर स्तनधारी है']),
  s(2, [['Football', 'फ़ुटबॉल'], ['Chess', 'शतरंज'], ['Carrom', 'कैरम'], ['Ludo', 'लूडो']], ['Played on a board', 'बोर्ड पर खेले जाते हैं'],
    ['Football is played on a field', 'फ़ुटबॉल मैदान में खेला जाता है']),
  s(2, [['Mumbai', 'मुंबई'], ['Nepal', 'नेपाल'], ['Bhutan', 'भूटान'], ['China', 'चीन']], ['Countries', 'देश'],
    ['Mumbai is a city', 'मुंबई एक शहर है']),
  s(2, [['Venus', 'शुक्र'], ['Moon', 'चाँद'], ['Titan', 'टाइटन'], ['Phobos', 'फ़ोबोस']], ['Moons', 'उपग्रह'],
    ['Venus is a planet', 'शुक्र एक ग्रह है']),
  s(3, [['15', '15'], ['7', '7'], ['11', '11'], ['13', '13']], ['Prime numbers', 'अभाज्य संख्याएँ'], ['15 = 3 × 5', '15 = 3 × 5 होता है']),
  s(3, [['Mercury', 'बुध'], ['Gold', 'सोना'], ['Silver', 'चाँदी'], ['Copper', 'ताँबा']], ['Solid metals at room temperature', 'कमरे के तापमान पर ठोस धातुएँ'],
    ['Mercury is a liquid at room temperature', 'पारा कमरे के तापमान पर तरल होता है']),
  s(3, [['Square', 'वर्ग'], ['Circle', 'वृत्त'], ['Sphere', 'गोला'], ['Cylinder', 'बेलन']], ['Round', 'गोल'],
    ['A square has corners', 'वर्ग में कोने होते हैं']),
  s(3, [['Spider', 'मकड़ी'], ['Ant', 'चींटी'], ['Bee', 'मधुमक्खी'], ['Butterfly', 'तितली']], ['Insects (six legs)', 'कीट (छह पैर)'],
    ['A spider has eight legs', 'मकड़ी के आठ पैर होते हैं']),
  s(3, [['Tomato', 'टमाटर'], ['Cabbage', 'पत्तागोभी'], ['Spinach', 'पालक'], ['Lettuce', 'सलाद पत्ता']], ['Leaves we eat', 'खाने वाले पत्ते'],
    ['A tomato is a fruit of the plant', 'टमाटर पौधे का फल है']),
  s(3, [['Penguin', 'पेंगुइन'], ['Eagle', 'चील'], ['Parrot', 'तोता'], ['Owl', 'उल्लू']], ['Birds that fly', 'उड़ने वाले पक्षी'],
    ['A penguin cannot fly', 'पेंगुइन उड़ नहीं सकता']),
  s(3, [['Ganga', 'गंगा'], ['Aravalli', 'अरावली'], ['Vindhya', 'विंध्य'], ['Satpura', 'सतपुड़ा']], ['Hill ranges of India', 'भारत की पर्वत श्रेणियाँ'],
    ['The Ganga is a river', 'गंगा एक नदी है']),
];

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Round { set: OddSet; order: number[]; odd: number }   // order[place] = item index; odd = the odd one's place

export function shuffle<T>(list: T[], r: () => number = Math.random): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** The level for this many right answers: easy sets first, then harder ones. */
export const levelFor = (right: number): 1 | 2 | 3 => (right < 4 ? 1 : right < 9 ? 2 : 3);

/** The next set: from the current level, never one already seen (falls back to any unseen, then any). */
export function nextRound(seen: Set<number>, right: number, bank = SETS, r: () => number = Math.random): { round: Round; index: number } {
  const ids = bank.map((_, i) => i);
  const fresh = ids.filter((i) => !seen.has(i));
  const pool = fresh.filter((i) => bank[i].level === levelFor(right));
  const pickFrom = pool.length ? pool : fresh.length ? fresh : ids;
  const index = pickFrom[Math.floor(r() * pickFrom.length) % pickFrom.length];
  const order = shuffle(bank[index].items.map((_, i) => i), r);
  return { index, round: { set: bank[index], order, odd: order.indexOf(0) } };
}

/** Seconds for the next set: the clock speeds up with each right answer, never below 'fastest'. */
export const secondsFor = (right: number, o = OPTIONS) => Math.max(o.fastest, Math.round(o.seconds - o.speedUp * right));

export const pointsFor = (streak: number, o = OPTIONS) => o.points + 2 * Math.max(0, streak);

function beep(freq: number, len = 0.08) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = freq; gain.gain.value = 0.05; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + len);
  } catch { /* sound can be blocked */ }
}

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [round, setRound] = useState<Round | null>(null);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [right, setRight] = useState(0);
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [lives, setLives] = useState(OPTIONS.lives);
  const [left, setLeft] = useState(OPTIONS.seconds);
  const [picked, setPicked] = useState<number | null>(null);
  const [hints, setHints] = useState(OPTIONS.hints);
  const [showHint, setShowHint] = useState(false);
  const t = COPY[lang];
  const live = useRef({ phase, picked, left });
  live.current = { phase, picked, left };

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    const id = setInterval(() => {
      const st = live.current;
      if (st.picked !== null || st.phase !== 'play') return;
      if (st.left <= 1) { setLeft(0); pick(-1); } else setLeft(st.left - 1);
    }, 1000);
    return () => clearInterval(id);
  });

  function deal(nowSeen: Set<number>, nowRight: number) {
    const { round: r, index } = nextRound(nowSeen, nowRight);
    setRound(r); setSeen(new Set(nowSeen).add(index)); setPicked(null); setShowHint(false); setLeft(secondsFor(nowRight));
  }

  function start() {
    setRight(0); setStreak(0); setScore(0); setLives(OPTIONS.lives); setHints(OPTIONS.hints); setPhase('play'); deal(new Set(), 0);
  }

  function pick(place: number) {
    if (!round || picked !== null) return;
    const ok = place === round.odd;
    setPicked(place);
    const nextScore = ok ? score + pointsFor(streak) : score;
    const nextLives = ok ? lives : lives - 1;
    setScore(nextScore); setLives(nextLives); setStreak(ok ? streak + 1 : 0);
    if (ok) setRight(right + 1);
    beep(ok ? 700 : 180, ok ? 0.1 : 0.3);
    setTimeout(() => {
      if (nextLives <= 0) {
        setPhase('over');
        setBest((prev) => { const b = Math.max(prev, nextScore); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
      } else deal(seen, ok ? right + 1 : right);
    }, 1600);
  }

  function onKey(e: { key: string }) {
    const n = '1234'.indexOf(e.key);
    if (phase === 'play' && n >= 0) pick(n);
  }

  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {levelFor(right)}</span>
        <span className="badge">{t.lives} {'❤'.repeat(Math.max(0, lives))}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over} — {t.score} {score}</p>}
      {phase === 'play' && round && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ height: 6, background: '#0002', borderRadius: 3, marginBottom: 10 }}>
            <div style={{ width: (100 * left) / secondsFor(right) + '%', height: 6, borderRadius: 3, background: left <= 3 ? '#dc2626' : ACCENT }} />
          </div>
          <p style={{ fontSize: 18 }}>{t.ask}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {round.order.map((item, place) => {
              const done = picked !== null;
              const bg = !done ? ACCENT : place === round.odd ? '#16a34a' : place === picked ? '#dc2626' : '#64748b';
              return (
                <button key={place} className="primary" disabled={done} onClick={() => pick(place)}
                  style={{ minHeight: 72, fontSize: 18, background: bg, transform: done && place === round.odd ? 'scale(1.06)' : 'none',
                    transition: 'transform .2s' }}>{round.set.items[item][lang]}</button>
              );
            })}
          </div>
          {showHint && picked === null && <p>💡 {round.set.group[lang]}</p>}
          {picked !== null && (
            <p>{picked === round.odd ? t.right : picked < 0 ? t.late : t.wrong} {round.set.why[lang]}</p>
          )}
          <button className="badge" style={{ marginTop: 10 }} disabled={!hints || showHint || picked !== null}
            onClick={() => { setHints(hints - 1); setShowHint(true); }}>{t.hint} ×{hints}</button>
        </div>
      )}
    </div>
  );
}
`;
