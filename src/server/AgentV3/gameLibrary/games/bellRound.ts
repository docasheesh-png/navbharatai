// Bell Round — the library quiz show: a bilingual bank by topic, shuffled answers, a countdown with speed and streak
// bonuses, 50:50 and skip, and a review of missed questions.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const bellRoundAppTsx = `// __TITLE__ — a quiz show: a bell rings, a question comes up, beat the clock. Our own code. Every part is a named block
// below, so any of it can be changed by asking: the OPTIONS (questions per game, seconds, lifelines), the QUESTIONS bank
// (English and Hindi side by side, by topic), the COPY. Ideas studied (no code taken): a large shuffled bank so no two games
// match, answers shuffled each time, a countdown with a speed bonus, a streak bonus, 50:50 and skip lifelines, and a review
// of the missed questions at the end.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'bell-round-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  perGame: 10,          // questions in one game
  seconds: 15,          // time for each question
  points: 10,           // for a right answer
  speedBonus: 10,       // up to this many extra points for answering fast
  streakBonus: 5,       // extra points per answer in a row (from the 2nd)
  fiftyFifty: 1,        // 50:50 lifelines per game
  skips: 1,             // skip lifelines per game
  topic: 'all' as Topic | 'all',
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Question', time: 'Time',
    half: '50:50', skip: 'Skip', right: 'Right!', wrong: 'The answer was', late: "Time's up — the answer was", missed: 'To learn',
    streak: 'In a row', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'सवाल', time: 'समय',
    half: '50:50', skip: 'छोड़ो', right: 'सही!', wrong: 'सही जवाब था', late: 'समय खत्म — सही जवाब था', missed: 'सीखने के लिए',
    streak: 'लगातार', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── QUESTIONS — add, remove or change any; the first option is the right one (they are shuffled on screen) ─────────
export type Topic = 'india' | 'science' | 'maths' | 'nature' | 'sport' | 'everyday';
export interface Question { topic: Topic; en: string; hi: string; options: { en: string; hi: string }[] }
const q = (topic: Topic, en: string, hi: string, ...opts: [string, string][]): Question =>
  ({ topic, en, hi, options: opts.map(([e, h]) => ({ en: e, hi: h })) });
export const QUESTIONS: Question[] = [
  q('india', 'What is the capital of India?', 'भारत की राजधानी क्या है?', ['New Delhi', 'नई दिल्ली'], ['Mumbai', 'मुंबई'], ['Kolkata', 'कोलकाता'], ['Chennai', 'चेन्नई']),
  q('india', 'Which is the national animal of India?', 'भारत का राष्ट्रीय पशु कौन सा है?', ['Tiger', 'बाघ'], ['Lion', 'शेर'], ['Elephant', 'हाथी'], ['Peacock', 'मोर']),
  q('india', 'Which is the national bird of India?', 'भारत का राष्ट्रीय पक्षी कौन सा है?', ['Peacock', 'मोर'], ['Parrot', 'तोता'], ['Sparrow', 'गौरैया'], ['Crow', 'कौआ']),
  q('india', 'The Taj Mahal is in which city?', 'ताजमहल किस शहर में है?', ['Agra', 'आगरा'], ['Jaipur', 'जयपुर'], ['Delhi', 'दिल्ली'], ['Lucknow', 'लखनऊ']),
  q('india', 'How many colours are in the Indian flag (not counting the wheel)?', 'भारतीय झंडे में कितने रंग हैं (चक्र छोड़कर)?', ['3', '3'], ['2', '2'], ['4', '4'], ['5', '5']),
  q('india', 'How many spokes does the wheel on the Indian flag have?', 'भारतीय झंडे के चक्र में कितनी तीलियाँ हैं?', ['24', '24'], ['12', '12'], ['16', '16'], ['32', '32']),
  q('india', 'Which river is the longest in India?', 'भारत की सबसे लंबी नदी कौन सी है?', ['Ganga', 'गंगा'], ['Yamuna', 'यमुना'], ['Godavari', 'गोदावरी'], ['Narmada', 'नर्मदा']),
  q('india', 'Diwali is known as the festival of…', 'दिवाली किसका त्योहार कहलाता है?', ['Lights', 'रोशनी'], ['Colours', 'रंगों'], ['Kites', 'पतंगों'], ['Harvest', 'फसल']),
  q('science', 'Which planet is called the Red Planet?', 'किस ग्रह को लाल ग्रह कहते हैं?', ['Mars', 'मंगल'], ['Venus', 'शुक्र'], ['Jupiter', 'बृहस्पति'], ['Saturn', 'शनि']),
  q('science', 'What gas do plants take in from the air?', 'पौधे हवा से कौन सी गैस लेते हैं?', ['Carbon dioxide', 'कार्बन डाइऑक्साइड'], ['Oxygen', 'ऑक्सीजन'],
    ['Nitrogen', 'नाइट्रोजन'], ['Helium', 'हीलियम']),
  q('science', 'Water boils at how many degrees Celsius (at sea level)?', 'समुद्र तल पर पानी कितने डिग्री सेल्सियस पर उबलता है?', ['100', '100'], ['50', '50'],
    ['90', '90'], ['212', '212']),
  q('science', 'Which is the largest planet?', 'सबसे बड़ा ग्रह कौन सा है?', ['Jupiter', 'बृहस्पति'], ['Earth', 'पृथ्वी'], ['Saturn', 'शनि'], ['Mars', 'मंगल']),
  q('science', 'How many bones does an adult human have?', 'एक वयस्क इंसान में कितनी हड्डियाँ होती हैं?', ['206', '206'], ['106', '106'], ['300', '300'], ['250', '250']),
  q('science', 'What does the heart pump?', 'दिल क्या पंप करता है?', ['Blood', 'खून'], ['Air', 'हवा'], ['Food', 'खाना'], ['Water', 'पानी']),
  q('science', 'Which star is closest to the Earth?', 'पृथ्वी के सबसे पास कौन सा तारा है?', ['The Sun', 'सूरज'], ['The Moon', 'चाँद'], ['Pole Star', 'ध्रुव तारा'], ['Sirius', 'व्याध']),
  q('maths', 'What is 7 × 8?', '7 × 8 कितना होता है?', ['56', '56'], ['54', '54'], ['64', '64'], ['48', '48']),
  q('maths', 'How many sides does a hexagon have?', 'षट्भुज की कितनी भुजाएँ होती हैं?', ['6', '6'], ['5', '5'], ['8', '8'], ['7', '7']),
  q('maths', 'What is half of 150?', '150 का आधा कितना है?', ['75', '75'], ['50', '50'], ['70', '70'], ['80', '80']),
  q('maths', 'How many minutes are in 2 hours?', '2 घंटे में कितने मिनट होते हैं?', ['120', '120'], ['100', '100'], ['60', '60'], ['200', '200']),
  q('maths', 'What is 15 + 27?', '15 + 27 कितना होता है?', ['42', '42'], ['32', '32'], ['43', '43'], ['52', '52']),
  q('maths', 'A triangle has how many sides?', 'त्रिभुज की कितनी भुजाएँ होती हैं?', ['3', '3'], ['4', '4'], ['6', '6'], ['2', '2']),
  q('nature', 'Which animal is called the ship of the desert?', 'रेगिस्तान का जहाज़ किसे कहते हैं?', ['Camel', 'ऊँट'], ['Horse', 'घोड़ा'], ['Elephant', 'हाथी'],
    ['Donkey', 'गधा']),
  q('nature', 'What do bees make?', 'मधुमक्खियाँ क्या बनाती हैं?', ['Honey', 'शहद'], ['Milk', 'दूध'], ['Silk', 'रेशम'], ['Wax paper', 'मोम कागज़']),
  q('nature', 'Which is the largest animal on Earth?', 'पृथ्वी का सबसे बड़ा जानवर कौन सा है?', ['Blue whale', 'नीली व्हेल'], ['Elephant', 'हाथी'],
    ['Giraffe', 'जिराफ़'], ['Shark', 'शार्क']),
  q('nature', 'How many legs does a spider have?', 'मकड़ी के कितने पैर होते हैं?', ['8', '8'], ['6', '6'], ['10', '10'], ['4', '4']),
  q('nature', 'Which fruit is called the king of fruits in India?', 'भारत में फलों का राजा किसे कहते हैं?', ['Mango', 'आम'], ['Banana', 'केला'], ['Apple', 'सेब'],
    ['Guava', 'अमरूद']),
  q('sport', 'How many players does a cricket team have on the field?', 'क्रिकेट टीम के मैदान पर कितने खिलाड़ी होते हैं?', ['11', '11'], ['9', '9'], ['10', '10'],
    ['12', '12']),
  q('sport', 'How many balls are in one over of cricket?', 'क्रिकेट के एक ओवर में कितनी गेंदें होती हैं?', ['6', '6'], ['5', '5'], ['8', '8'], ['4', '4']),
  q('sport', 'Kabaddi players must keep saying what while raiding?', 'कबड्डी में रेड करते समय खिलाड़ी क्या बोलता रहता है?', ['Kabaddi', 'कबड्डी'], ['Out', 'आउट'],
    ['Goal', 'गोल'], ['Stop', 'रुको']),
  q('sport', 'How many squares are on a chess board?', 'शतरंज की बिसात पर कितने खाने होते हैं?', ['64', '64'], ['32', '32'], ['81', '81'], ['100', '100']),
  q('everyday', 'How many days are in a leap year?', 'लीप वर्ष में कितने दिन होते हैं?', ['366', '366'], ['365', '365'], ['360', '360'], ['364', '364']),
  q('everyday', 'Which month comes after March?', 'मार्च के बाद कौन सा महीना आता है?', ['April', 'अप्रैल'], ['May', 'मई'], ['February', 'फ़रवरी'], ['June', 'जून']),
  q('everyday', 'How many hours are in a day?', 'एक दिन में कितने घंटे होते हैं?', ['24', '24'], ['12', '12'], ['20', '20'], ['48', '48']),
  q('everyday', 'How many wheels does a bicycle have?', 'साइकिल में कितने पहिये होते हैं?', ['2', '2'], ['3', '3'], ['1', '1'], ['4', '4']),
];

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Round { q: Question; order: number[]; answer: number }   // order[i] = which option sits in place i

export function shuffle<T>(list: T[], r: () => number = Math.random): T[] {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** A game: questions drawn without repeats from the chosen topic, each with its options shuffled. */
export function dealGame(bank = QUESTIONS, o = OPTIONS, r: () => number = Math.random): Round[] {
  const pool = bank.filter((x) => o.topic === 'all' || x.topic === o.topic);
  return shuffle(pool, r).slice(0, o.perGame).map((x) => {
    const order = shuffle(x.options.map((_, i) => i), r);
    return { q: x, order, answer: order.indexOf(0) };
  });
}

/** Points for an answer: base, a bonus for time left, and a bonus for the streak. Wrong or late scores 0. */
export function scoreAnswer(right: boolean, secondsLeft: number, streak: number, o = OPTIONS): number {
  if (!right || secondsLeft <= 0) return 0;
  const speed = Math.round(o.speedBonus * Math.min(1, secondsLeft / o.seconds));
  return o.points + speed + o.streakBonus * Math.max(0, streak);
}

/** 50:50 — the two places to hide: never the answer. */
export function fiftyFifty(round: Round, r: () => number = Math.random): number[] {
  const wrong = round.order.map((_, i) => i).filter((i) => i !== round.answer);
  return shuffle(wrong, r).slice(0, Math.max(0, wrong.length - 1));
}

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
  const [game, setGame] = useState<Round[]>([]);
  const [at, setAt] = useState(0);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [streak, setStreak] = useState(0);
  const [left, setLeft] = useState(OPTIONS.seconds);
  const [hidden, setHidden] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [halves, setHalves] = useState(OPTIONS.fiftyFifty);
  const [skips, setSkips] = useState(OPTIONS.skips);
  const [missed, setMissed] = useState<Question[]>([]);
  const t = COPY[lang];
  const round = game[at];
  const live = useRef({ phase, picked, left });
  live.current = { phase, picked, left };

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    const id = setInterval(() => {
      const s = live.current;
      if (s.picked !== null || s.phase !== 'play') return;
      if (s.left <= 1) { setLeft(0); answer(-1); } else setLeft(s.left - 1);
    }, 1000);
    return () => clearInterval(id);
  });

  function start() {
    setGame(dealGame()); setAt(0); setScore(0); setStreak(0); setLeft(OPTIONS.seconds); setHidden([]); setPicked(null);
    setHalves(OPTIONS.fiftyFifty); setSkips(OPTIONS.skips); setMissed([]); setPhase('play'); beep(880, 0.25);
  }

  function next(finalScore: number) {
    if (at + 1 >= game.length) {
      setPhase('over');
      setBest((prev) => { const b = Math.max(prev, finalScore); try { localStorage.setItem(BEST, String(b)); } catch { /* ignore */ } return b; });
      return;
    }
    setAt(at + 1); setLeft(OPTIONS.seconds); setHidden([]); setPicked(null); beep(880, 0.2);
  }

  function answer(place: number) {
    if (!round || picked !== null) return;
    const right = place === round.answer;
    const got = scoreAnswer(right, live.current.left, streak);
    setPicked(place); setScore(score + got); setStreak(right ? streak + 1 : 0);
    if (!right) setMissed((m) => [...m, round.q]);
    beep(right ? 660 : 200, right ? 0.1 : 0.3);
    setTimeout(() => next(score + got), 1100);
  }

  function onKey(e: { key: string }) {
    const n = '1234abcd'.indexOf(e.key.toLowerCase());
    if (phase === 'play' && n >= 0 && !hidden.includes(n % 4)) answer(n % 4);
  }

  const option = (place: number) => round.q.options[round.order[place]][lang];
  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 24 }} tabIndex={0} onKeyDown={onKey}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {score}</span>
        <span className="badge">{t.best} {best}</span>
        {phase === 'play' && <span className="badge">{t.level} {at + 1}/{game.length}</span>}
        {streak > 1 && <span className="badge">{t.streak} {streak}</span>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>}
      {phase === 'over' && <p>{t.over} — {t.score} {score}</p>}
      {phase === 'over' && missed.length > 0 && (
        <div className="card" style={{ padding: 12 }}>
          <b>{t.missed}</b>
          {missed.map((m) => <p key={m.en} style={{ margin: '6px 0' }}>{m[lang]} → <b>{m.options[0][lang]}</b></p>)}
        </div>
      )}
      {phase === 'play' && round && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ height: 6, background: '#0002', borderRadius: 3, marginBottom: 10 }}>
            <div style={{ width: (100 * left) / OPTIONS.seconds + '%', height: 6, borderRadius: 3, transition: 'width 1s linear',
              background: left <= 5 ? '#dc2626' : ACCENT }} />
          </div>
          <p style={{ fontSize: 18 }}>🔔 {round.q[lang]}</p>
          {round.order.map((_, place) => {
            const shown = picked !== null && (place === round.answer || place === picked);
            const bg = !shown ? ACCENT : place === round.answer ? '#16a34a' : '#dc2626';
            return (
              <button key={place} className="primary" disabled={hidden.includes(place) || picked !== null}
                style={{ display: 'block', width: '100%', marginTop: 8, background: bg, opacity: hidden.includes(place) ? 0.25 : 1 }}
                onClick={() => answer(place)}>{place + 1}. {option(place)}</button>
            );
          })}
          {picked !== null && picked !== round.answer && <p>{picked < 0 ? t.late : t.wrong} <b>{option(round.answer)}</b></p>}
          {picked === round.answer && <p>{t.right}</p>}
          <div className="row" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="badge" disabled={!halves || picked !== null} onClick={() => { setHidden(fiftyFifty(round)); setHalves(halves - 1); }}>
              {t.half} ×{halves}</button>
            <button className="badge" disabled={!skips || picked !== null} onClick={() => { setSkips(skips - 1); next(score); }}>{t.skip} ×{skips}</button>
            <span className="badge">{t.time} {left}</span>
          </div>
        </div>
      )}
    </div>
  );
}
`;
