// Tea Stall — the library tea-stall day (PLAY COINS ONLY): orders from a few ingredients, patience bars, speed tips,
// busier days, a shop between days and a day summary.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const teaStallAppTsx = `// __TITLE__ — run a roadside tea stall for a day: customers queue with an order, you make each cup (tea, milk, sugar,
// spice), serve it before they lose patience, and spend the day's play coins on a better stall. PLAY COINS ONLY — pretend
// coins, never real money. Our own code. Every part is a named block below, so any of it can be changed by asking: the
// OPTIONS (day length, patience), the MENU (ingredients and prices), the UPGRADES, the LOOKS, the COPY. Ideas studied (no
// code taken): orders built from a few ingredients so they are quick to read, a patience bar per customer, tips that reward
// speed, busier days as you grow, a shop between days, and an end-of-day summary.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'tea-stall-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  daySeconds: 75,
  patience: 22,            // seconds a customer waits on day 1
  queue: 4,                // most customers waiting at once
  firstGap: 6,             // seconds between arrivals on day 1
  days: 5,
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Coins', best: 'Best', level: 'Day', time: 'Time',
    serve: 'Serve', bin: 'Throw away', cup: 'Your cup', wants: 'wants', served: 'Served', left: 'Walked away', shop: 'Stall shop',
    next: 'Open next day', buy: 'Buy', owned: 'Owned', note: 'Play coins only — no real money', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'सिक्के', best: 'सर्वश्रेष्ठ', level: 'दिन', time: 'समय',
    serve: 'परोसो', bin: 'फेंको', cup: 'आपका कप', wants: 'चाहिए', served: 'परोसे', left: 'चले गए', shop: 'दुकान का सामान',
    next: 'अगला दिन शुरू', buy: 'खरीदो', owned: 'आपके पास', note: 'सिर्फ़ खेल के सिक्के — असली पैसा नहीं', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── MENU — what goes in a cup, and what it adds to the price ─────────────────
export const INGREDIENTS = {
  tea: { en: 'Tea', hi: 'चाय पत्ती', icon: '🍵', price: 5 },
  milk: { en: 'Milk', hi: 'दूध', icon: '🥛', price: 3 },
  sugar: { en: 'Sugar', hi: 'चीनी', icon: '🧂', price: 1 },
  elaichi: { en: 'Elaichi', hi: 'इलायची', icon: '🌿', price: 3 },
  ginger: { en: 'Ginger', hi: 'अदरक', icon: '🫚', price: 3 },
};
export type Ingredient = keyof typeof INGREDIENTS;
export const CUSTOMERS = ['👨', '👩', '👴', '👵', '🧑‍🎓', '👷', '👮', '🧕'];

// ── UPGRADES ────────────────────────────────────────────────────────────────
export const UPGRADES = {
  bench: { en: 'Bench (customers wait longer)', hi: 'बेंच (ग्राहक ज़्यादा रुकते हैं)', cost: 60 },
  sign: { en: 'Painted sign (more customers)', hi: 'रंगीन बोर्ड (ज़्यादा ग्राहक)', cost: 80 },
  kettle: { en: 'Big kettle (+2 a cup)', hi: 'बड़ी केतली (+2 हर कप)', cost: 100 },
};
export type Upgrade = keyof typeof UPGRADES;

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Order { who: string; wants: Ingredient[]; waited: number; patience: number }

/** An order: always tea; milk most of the time; sugar, elaichi or ginger now and then (more choices on later days). */
export function makeOrder(day: number, r: () => number = Math.random, owned: Upgrade[] = [], o = OPTIONS): Order {
  const wants: Ingredient[] = ['tea'];
  if (r() < 0.8) wants.push('milk');
  if (r() < 0.6) wants.push('sugar');
  if (day >= 2 && r() < 0.4) wants.push('elaichi');
  if (day >= 3 && r() < 0.35) wants.push('ginger');
  const patience = Math.max(10, o.patience - (day - 1) * 2) + (owned.includes('bench') ? 6 : 0);
  return { who: CUSTOMERS[Math.floor(r() * CUSTOMERS.length) % CUSTOMERS.length], wants, waited: 0, patience };
}

/** A cup matches when it has exactly the asked ingredients (order does not matter). */
export function matches(cup: Ingredient[], order: Order): boolean {
  const a = [...new Set(cup)].sort(), b = [...order.wants].sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Coins for a served cup: the ingredient prices, the kettle bonus, and a tip for a quick serve. */
export function priceFor(order: Order, owned: Upgrade[] = []): number {
  const base = order.wants.reduce((s, k) => s + INGREDIENTS[k].price, 0) + (owned.includes('kettle') ? 2 : 0);
  const left = Math.max(0, 1 - order.waited / order.patience);
  return base + Math.round(base * 0.5 * left);
}

/** Seconds until the next customer: busier each day, busier still with a sign. */
export const arrivalGap = (day: number, owned: Upgrade[] = [], o = OPTIONS) =>
  Math.max(2.2, o.firstGap - (day - 1) * 0.7) * (owned.includes('sign') ? 0.8 : 1);

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
  const [phase, setPhase] = useState<'menu' | 'play' | 'shop' | 'over'>('menu');
  const [day, setDay] = useState(1);
  const [coins, setCoins] = useState(0);
  const [best, setBest] = useState(0);
  const [queue, setQueue] = useState<Order[]>([]);
  const [cup, setCup] = useState<Ingredient[]>([]);
  const [left, setLeft] = useState(OPTIONS.daySeconds);
  const [owned, setOwned] = useState<Upgrade[]>([]);
  const [tally, setTally] = useState({ served: 0, lost: 0, earned: 0 });
  const t = COPY[lang];
  const live = useRef({ next: 1, day: 1, owned: [] as Upgrade[] });
  const queueRef = useRef<Order[]>([]);

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (phase !== 'play') return;
    const id = setInterval(() => {
      const L = live.current;
      L.next -= 0.25;
      let lost = 0;
      const kept = queueRef.current.map((c) => ({ ...c, waited: c.waited + 0.25 })).filter((c) => (c.waited < c.patience ? true : (lost++, false)));
      if (lost) { setTally((s) => ({ ...s, lost: s.lost + lost })); beep(150, 0.2); }
      if (L.next <= 0 && kept.length < OPTIONS.queue) { kept.push(makeOrder(L.day, Math.random, L.owned)); L.next = arrivalGap(L.day, L.owned); }
      queueRef.current = kept; setQueue(kept);
      setLeft((s) => {
        if (s <= 0.25) { setPhase(L.day >= OPTIONS.days ? 'over' : 'shop'); return 0; }
        return s - 0.25;
      });
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === 'over') setBest((b) => { const n = Math.max(b, coins); try { localStorage.setItem(BEST, String(n)); } catch { /* ignore */ } return n; });
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps

  function openDay(d: number) {
    live.current = { next: 1, day: d, owned };
    setDay(d); queueRef.current = []; setQueue([]); setCup([]); setLeft(OPTIONS.daySeconds); setTally({ served: 0, lost: 0, earned: 0 }); setPhase('play');
  }
  function start() { setCoins(0); setOwned([]); live.current.owned = []; openDay(1); }
  function add(k: Ingredient) { if (!cup.includes(k)) { setCup([...cup, k]); beep(500 + cup.length * 80, 0.05); } }
  function serve(i: number) {
    const q = queueRef.current, c = q[i];
    if (!c || !matches(cup, c)) { beep(180, 0.2); return; }
    const p = priceFor(c, owned);
    setCoins(coins + p); setTally({ ...tally, served: tally.served + 1, earned: tally.earned + p });
    queueRef.current = q.filter((_, k) => k !== i); setQueue(queueRef.current); setCup([]); beep(990, 0.12);
  }
  function buy(u: Upgrade) {
    if (owned.includes(u) || coins < UPGRADES[u].cost) return;
    const o = [...owned, u]; setOwned(o); setCoins(coins - UPGRADES[u].cost); live.current.owned = o; beep(700);
  }

  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <p style={{ fontSize: 13, opacity: 0.8, margin: '4px 0' }}>{t.note}</p>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {coins}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.level} {day}/{OPTIONS.days}</span>
        {phase === 'play' && <span className="badge">{t.time} {Math.ceil(left)}</span>}
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {(phase === 'menu' || phase === 'over') && (
        <div className="card" style={{ padding: 16 }}>
          {phase === 'over' && <p>{t.over} — {t.score} {coins}</p>}
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {phase === 'shop' && (
        <div className="card" style={{ padding: 16 }}>
          <p>{t.served} {tally.served} · {t.left} {tally.lost} · +{tally.earned}</p>
          <b>{t.shop}</b>
          {(Object.keys(UPGRADES) as Upgrade[]).map((u) => (
            <div key={u} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0' }}>
              <span>{UPGRADES[u][lang]}</span>
              <button className="badge" disabled={owned.includes(u) || coins < UPGRADES[u].cost} onClick={() => buy(u)}>
                {owned.includes(u) ? t.owned : t.buy + ' ' + UPGRADES[u].cost}</button>
            </div>
          ))}
          <button className="primary" onClick={() => openDay(day + 1)}>{t.next}</button>
        </div>
      )}
      {phase === 'play' && (
        <>
          <div style={{ display: 'grid', gap: 6 }}>
            {queue.map((c, i) => (
              <button key={i + c.who + c.wants.join()} onClick={() => serve(i)} className="card"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, textAlign: 'left', border: matches(cup, c) ? '2px solid ' + ACCENT : undefined }}>
                <span style={{ fontSize: 28 }}>{c.who}</span>
                <span style={{ flex: 1 }}>{t.wants} {c.wants.map((k) => INGREDIENTS[k].icon).join(' ')}
                  <div style={{ height: 5, background: '#0002', borderRadius: 3, marginTop: 4 }}>
                    <div style={{ height: 5, borderRadius: 3, width: 100 * (1 - c.waited / c.patience) + '%',
                      background: c.waited / c.patience > 0.7 ? '#dc2626' : '#16a34a' }} /></div>
                </span>
                <b>{t.serve}</b>
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 10, marginTop: 10 }}>
            <div>{t.cup}: <span style={{ fontSize: 22 }}>☕ {cup.map((k) => INGREDIENTS[k].icon).join(' ')}</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {(Object.keys(INGREDIENTS) as Ingredient[]).filter((k) => day >= (k === 'elaichi' ? 2 : k === 'ginger' ? 3 : 1)).map((k) => (
                <button key={k} className="primary" disabled={cup.includes(k)} onClick={() => add(k)}>{INGREDIENTS[k].icon} {INGREDIENTS[k][lang]}</button>
              ))}
              <button className="badge" onClick={() => setCup([])}>{t.bin}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
`;
