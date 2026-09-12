// AgentV3 — Golden Scaffold apps (India-first): GST bill maker, exam practice, society/RWA manager,
// coaching-class manager.
//
// WHY THESE FOUR EXIST, and why they are not just four more templates. Every other starter in this
// library is a shape any builder in the world also ships — a to-do list, a CRM, a store. These four are
// the MOAT: software that is obviously Indian and that a generic template library never carries. A
// kirana owner wants a GST bill with CGST and SGST split out, not an "invoice"; a society wants
// maintenance dues per flat; a coaching class wants batches and monthly fees; an aspirant wants a
// sectioned mock test with negative marking. Each one is the app its user already keeps in a notebook.
//
// TIER CHOICE, stated because it is a real decision: the GST biller and the exam practice app are
// SIMPLE — one screen, plain React state, localStorage — so the FREE tier reaches the moat rather than
// only seeing it behind a lock. The society and coaching apps are PRO: multiple linked entities
// (flats → dues, students → batches → fees) are exactly where a weak model produces half an app.
//
// Written without backslash escapes, and with NO backtick anywhere in the embedded code or its prose —
// a single backtick would terminate this file's own template literal and the syntax error lands dozens
// of lines away from its cause.

export const gstBillAppTsx = `import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

// A kirana bill is not a generic invoice: the GST slab lives on the ITEM, and the tax has to be shown
// split into CGST and SGST (half each, for a sale inside the same state) or the bill is not compliant.
interface Item { id: string; name: string; price: number; gst: number; }
interface Line { itemId: string; qty: number; }

const SLABS = [0, 5, 12, 18, 28];
const CATALOGUE_KEY = 'gst-catalogue-v1';
const COUNTER_KEY = 'gst-bill-no-v1';

const SEED: Item[] = [
  { id: 'a', name: 'Rice (1 kg)', price: 62, gst: 5 },
  { id: 'b', name: 'Toor dal (1 kg)', price: 145, gst: 5 },
  { id: 'c', name: 'Refined oil (1 L)', price: 128, gst: 5 },
  { id: 'd', name: 'Biscuits (pack)', price: 30, gst: 18 },
  { id: 'e', name: 'Soap (bar)', price: 42, gst: 18 },
  { id: 'f', name: 'Cold drink (600 ml)', price: 40, gst: 28 },
];

function loadCatalogue(): Item[] {
  try {
    const raw = localStorage.getItem(CATALOGUE_KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as Item[]) : SEED;
  } catch { return SEED; }
}

function loadCounter(): number {
  try {
    const n = Number(localStorage.getItem(COUNTER_KEY));
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch { return 1; }
}

function rupees(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function App() {
  const [catalogue, setCatalogue] = useState<Item[]>(loadCatalogue);
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState('');
  const [billNo, setBillNo] = useState<number>(loadCounter);
  const [saved, setSaved] = useState<string | null>(null);

  // New-item form
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [gst, setGst] = useState(5);

  useEffect(() => { try { localStorage.setItem(CATALOGUE_KEY, JSON.stringify(catalogue)); } catch { /* private mode */ } }, [catalogue]);
  useEffect(() => { try { localStorage.setItem(COUNTER_KEY, String(billNo)); } catch { /* private mode */ } }, [billNo]);

  const addItem = () => {
    const n = name.trim();
    const p = Number(price);
    if (!n || !Number.isFinite(p) || p <= 0) return;
    setCatalogue([{ id: String(Date.now()), name: n, price: p, gst }, ...catalogue]);
    setName(''); setPrice('');
  };

  const addToBill = (itemId: string) => {
    setLines((list) => {
      const found = list.find((l) => l.itemId === itemId);
      return found ? list.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + 1 } : l)) : [...list, { itemId, qty: 1 }];
    });
  };
  const setQty = (itemId: string, qty: number) => {
    setLines((list) => (qty <= 0 ? list.filter((l) => l.itemId !== itemId) : list.map((l) => (l.itemId === itemId ? { ...l, qty } : l))));
  };

  // The whole point of the app: a per-slab breakdown, because that is what the return asks for.
  const bill = useMemo(() => {
    const rows = lines.map((l) => {
      const item = catalogue.find((i) => i.id === l.itemId);
      const price = item ? item.price : 0;
      const taxable = price * l.qty;
      const tax = (taxable * (item ? item.gst : 0)) / 100;
      return { line: l, item, taxable, tax, total: taxable + tax };
    }).filter((r) => r.item);
    const taxable = rows.reduce((s, r) => s + r.taxable, 0);
    const tax = rows.reduce((s, r) => s + r.tax, 0);
    const bySlab = SLABS.map((slab) => ({
      slab,
      taxable: rows.filter((r) => r.item && r.item.gst === slab).reduce((s, r) => s + r.taxable, 0),
      tax: rows.filter((r) => r.item && r.item.gst === slab).reduce((s, r) => s + r.tax, 0),
    })).filter((s) => s.taxable > 0);
    return { rows, taxable, tax, total: taxable + tax, bySlab };
  }, [lines, catalogue]);

  const finish = () => {
    if (!bill.rows.length) return;
    setBillNo(billNo + 1);
    setLines([]);
    setCustomer('');
    setSaved('Bill ' + billNo + ' completed — ' + rupees(bill.total));
  };

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 28, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>GST Bill</h1>
        <ThemeToggle />
      </div>

      {saved && <div className="alert alert-success" style={{ marginBottom: 12 }}>{saved}</div>}

      <div className="card stack" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <strong>Bill no. {billNo}</strong>
          <input
            style={{ flex: 1, minWidth: 180 }}
            value={customer}
            placeholder="Customer name (optional)"
            onChange={(e) => setCustomer(e.target.value)}
          />
        </div>

        {bill.rows.length === 0 ? (
          <div className="nb-empty">
            <div className="nb-empty-icon">🧾</div>
            <div className="nb-empty-title">No items yet</div>
            <div className="nb-empty-text">Tap an item below to start the bill.</div>
          </div>
        ) : (
          <div className="nb-table-wrap">
            <table className="nb-table">
              <thead>
                <tr><th>Item</th><th>GST</th><th>Qty</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr>
              </thead>
              <tbody>
                {bill.rows.map((r) => (
                  <tr key={r.line.itemId}>
                    <td>{r.item ? r.item.name : ''}<br /><small>{rupees(r.item ? r.item.price : 0)}</small></td>
                    <td><span className="badge">{r.item ? r.item.gst : 0}%</span></td>
                    <td>
                      <div className="row">
                        <button onClick={() => setQty(r.line.itemId, r.line.qty - 1)} aria-label="Reduce quantity">−</button>
                        <span style={{ minWidth: 24, textAlign: 'center' }}>{r.line.qty}</span>
                        <button onClick={() => setQty(r.line.itemId, r.line.qty + 1)} aria-label="Increase quantity">+</button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(r.total)}</td>
                    <td><button className="btn-ghost" onClick={() => setQty(r.line.itemId, 0)} aria-label="Remove item">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bill.rows.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span>Taxable value</span><strong>{rupees(bill.taxable)}</strong></div>
            {bill.bySlab.map((s) => (
              <div key={s.slab} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                <span>CGST {s.slab / 2}% + SGST {s.slab / 2}% on {rupees(s.taxable)}</span>
                <span>{rupees(s.tax / 2)} + {rupees(s.tax / 2)}</span>
              </div>
            ))}
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 18 }}>
              <strong>Total</strong><strong>{rupees(bill.total)}</strong>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="primary" onClick={finish}>Complete bill</button>
              <button className="btn-ghost" onClick={() => window.print()}>Print</button>
              <button className="btn-ghost" onClick={() => setLines([])}>Clear</button>
            </div>
          </div>
        )}
      </div>

      <div className="card stack">
        <strong>Items</strong>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {catalogue.map((i) => (
            <button key={i.id} onClick={() => addToBill(i.id)} style={{ textAlign: 'left' }}>
              {i.name} · {rupees(i.price)} · {i.gst}%
            </button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <input style={{ flex: 1, minWidth: 140 }} value={name} placeholder="New item name" onChange={(e) => setName(e.target.value)} />
          <input style={{ width: 110 }} value={price} placeholder="Price" inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
          <select value={gst} onChange={(e) => setGst(Number(e.target.value))} aria-label="GST slab">
            {SLABS.map((s) => <option key={s} value={s}>{s}% GST</option>)}
          </select>
          <button className="primary" onClick={addItem}>Add item</button>
        </div>
      </div>
    </div>
  );
}

export default App;
`;

export const examPrepAppTsx = `import { useCallback, useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

// A sarkari mock test is not a quiz: it has SECTIONS, a clock for the whole paper, negative marking,
// and a question palette you jump around in. Leaving any of those out produces something that does not
// feel like the real exam, which is the only thing an aspirant is practising for.
interface Question { id: string; section: string; q: string; options: string[]; answer: number; }

const NEGATIVE = 0.25;
const DURATION_SEC = 10 * 60;
const HISTORY_KEY = 'exam-attempts-v1';

interface Attempt { at: string; score: number; max: number; correct: number; wrong: number; skipped: number; }

const BANK: Question[] = [
  { id: 'g1', section: 'General Knowledge', q: 'Which article of the Constitution of India abolishes untouchability?', options: ['Article 14', 'Article 17', 'Article 19', 'Article 21'], answer: 1 },
  { id: 'g2', section: 'General Knowledge', q: 'The Tropic of Cancer does NOT pass through which of these Indian states?', options: ['Gujarat', 'Madhya Pradesh', 'Odisha', 'Tripura'], answer: 2 },
  { id: 'g3', section: 'General Knowledge', q: 'Who presides over a joint sitting of both Houses of Parliament?', options: ['The President', 'The Vice-President', 'The Speaker of the Lok Sabha', 'The Prime Minister'], answer: 2 },
  { id: 'g4', section: 'General Knowledge', q: 'The Chipko movement is chiefly associated with the conservation of what?', options: ['Rivers', 'Forests', 'Wetlands', 'Grasslands'], answer: 1 },
  { id: 'r1', section: 'Reasoning', q: 'Complete the series: 3, 6, 11, 18, 27, ?', options: ['36', '38', '40', '42'], answer: 1 },
  { id: 'r2', section: 'Reasoning', q: 'If BOOK is coded as CPPL, how is WORD coded?', options: ['XPSE', 'XPRE', 'WPSE', 'XQSE'], answer: 0 },
  { id: 'r3', section: 'Reasoning', q: "Pointing to a photo, Ram said: she is the daughter of my grandfather's only son. Who is she?", options: ['His cousin', 'His sister', 'His aunt', 'His niece'], answer: 1 },
  { id: 'm1', section: 'Quantitative Aptitude', q: 'A sum doubles in 8 years at simple interest. In how many years does it become four times?', options: ['16 years', '20 years', '24 years', '32 years'], answer: 2 },
  { id: 'm2', section: 'Quantitative Aptitude', q: 'The average of 11 numbers is 30. If the average of the first six is 25, and of the last six is 35, what is the sixth number?', options: ['25', '30', '35', '40'], answer: 1 },
  { id: 'm3', section: 'Quantitative Aptitude', q: 'A train 150 m long, running at 72 km/h, crosses a pole in how many seconds?', options: ['6.5 s', '7.5 s', '8.5 s', '9.5 s'], answer: 1 },
  { id: 'e1', section: 'English', q: 'Choose the correctly spelt word.', options: ['Occurence', 'Occurrance', 'Occurrence', 'Ocurrence'], answer: 2 },
  { id: 'e2', section: 'English', q: 'Pick the synonym of ABANDON.', options: ['Acquire', 'Forsake', 'Defend', 'Cherish'], answer: 1 },
];

function loadHistory(): Attempt[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Attempt[]) : [];
  } catch { return []; }
}

function mmss(total: number): string {
  const m = Math.floor(Math.max(0, total) / 60);
  const s = Math.max(0, total) % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function App() {
  const [stage, setStage] = useState<'start' | 'test' | 'result'>('start');
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [left, setLeft] = useState(DURATION_SEC);
  const [history, setHistory] = useState<Attempt[]>(loadHistory);

  useEffect(() => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* private mode */ } }, [history]);

  const result = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    for (const q of BANK) {
      const p = picked[q.id];
      if (p === undefined) continue;
      if (p === q.answer) correct += 1; else wrong += 1;
    }
    const score = correct - wrong * NEGATIVE;
    return { correct, wrong, skipped: BANK.length - correct - wrong, score, max: BANK.length };
  }, [picked]);

  const begin = () => {
    setPicked({}); setFlagged({}); setIndex(0); setLeft(DURATION_SEC); setStage('test');
  };

  // Declared BEFORE the effects that call it: a forward reference works at runtime, because the effect
  // closure only runs after render, but it reads as a bug and a real lint gate rejects it.
  const submit = useCallback(() => {
    setHistory((h) => [{ at: new Date().toISOString(), score: result.score, max: result.max, correct: result.correct, wrong: result.wrong, skipped: result.skipped }, ...h].slice(0, 20));
    setStage('result');
  }, [result]);

  // One interval, and it only exists while the paper is open — a timer left running after submission
  // keeps waking the tab for nothing.
  useEffect(() => {
    if (stage !== 'test') return;
    const t = setInterval(() => setLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [stage]);

  useEffect(() => {
    if (stage === 'test' && left <= 0) submit();
  }, [left, stage, submit]);

  const sections = useMemo(() => {
    const names: string[] = [];
    for (const q of BANK) if (!names.includes(q.section)) names.push(q.section);
    return names.map((name) => {
      const qs = BANK.filter((q) => q.section === name);
      const correct = qs.filter((q) => picked[q.id] === q.answer).length;
      const wrong = qs.filter((q) => picked[q.id] !== undefined && picked[q.id] !== q.answer).length;
      return { name, total: qs.length, correct, wrong };
    });
  }, [picked]);

  if (stage === 'start') {
    const best = history.length ? Math.max(...history.map((a) => a.score)) : null;
    return (
      <div className="container" style={{ maxWidth: 620, paddingTop: 32, paddingBottom: 48 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ margin: 0 }}>Mock Test</h1>
          <ThemeToggle />
        </div>
        <div className="card stack">
          <p style={{ margin: 0 }}>
            {BANK.length} questions across {sections.length} sections. {mmss(DURATION_SEC)} for the whole paper.
            Every wrong answer costs {NEGATIVE} marks — an unanswered question costs nothing.
          </p>
          <div className="nb-stats">
            {sections.map((s) => (
              <div className="nb-stat" key={s.name}>
                <div className="nb-stat-label">{s.name}</div>
                <div className="nb-stat-value">{s.total}</div>
              </div>
            ))}
          </div>
          <button className="primary" onClick={begin}>Start test</button>
          {best !== null && <small>Best so far: {best} / {BANK.length}</small>}
        </div>
        {history.length > 0 && (
          <div className="card stack" style={{ marginTop: 16 }}>
            <strong>Past attempts</strong>
            {history.map((a) => (
              <div className="row" style={{ justifyContent: 'space-between' }} key={a.at}>
                <span>{new Date(a.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                <span>{a.score} / {a.max} · {a.correct} right, {a.wrong} wrong</span>
              </div>
            ))}
            <button className="btn-ghost" onClick={() => setHistory([])}>Clear history</button>
          </div>
        )}
      </div>
    );
  }

  if (stage === 'result') {
    return (
      <div className="container" style={{ maxWidth: 620, paddingTop: 32, paddingBottom: 48 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ margin: 0 }}>Result</h1>
          <ThemeToggle />
        </div>
        <div className="card stack">
          <div className="nb-stats">
            <div className="nb-stat"><div className="nb-stat-label">Score</div><div className="nb-stat-value">{result.score}</div></div>
            <div className="nb-stat"><div className="nb-stat-label">Correct</div><div className="nb-stat-value">{result.correct}</div></div>
            <div className="nb-stat"><div className="nb-stat-label">Wrong</div><div className="nb-stat-value">{result.wrong}</div></div>
            <div className="nb-stat"><div className="nb-stat-label">Skipped</div><div className="nb-stat-value">{result.skipped}</div></div>
          </div>
          {sections.map((s) => (
            <div className="row" style={{ justifyContent: 'space-between' }} key={s.name}>
              <span>{s.name}</span>
              <span>{s.correct} / {s.total}</span>
            </div>
          ))}
          <button className="primary" onClick={() => setStage('start')}>Back to start</button>
        </div>
        <div className="card stack" style={{ marginTop: 16 }}>
          <strong>Review</strong>
          {BANK.map((q) => {
            const p = picked[q.id];
            const ok = p === q.answer;
            return (
              <div key={q.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <small>{q.section}</small>
                  <span className={ok ? 'badge badge-success' : p === undefined ? 'badge' : 'badge badge-danger'}>
                    {ok ? 'Correct' : p === undefined ? 'Skipped' : 'Wrong'}
                  </span>
                </div>
                <div>{q.q}</div>
                <small>Answer: {q.options[q.answer]}{p !== undefined && !ok ? ' · you chose ' + q.options[p] : ''}</small>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const q = BANK[index];
  const answered = Object.keys(picked).length;
  return (
    <div className="container" style={{ maxWidth: 620, paddingTop: 24, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap' }}>
        <strong>{q.section}</strong>
        <div className="row">
          <span className={left <= 60 ? 'badge badge-danger' : 'badge'}>{mmss(left)}</span>
          <ThemeToggle />
        </div>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <small>Question {index + 1} of {BANK.length}</small>
          <button className="btn-ghost" onClick={() => setFlagged({ ...flagged, [q.id]: !flagged[q.id] })}>
            {flagged[q.id] ? 'Unmark' : 'Mark for review'}
          </button>
        </div>
        <div style={{ fontSize: 17 }}>{q.q}</div>
        <div className="stack" style={{ gap: 8 }}>
          {q.options.map((opt, i) => (
            <button
              key={i}
              className={picked[q.id] === i ? 'primary' : ''}
              style={{ textAlign: 'left' }}
              onClick={() => setPicked({ ...picked, [q.id]: i })}
            >
              {String.fromCharCode(65 + i)}. {opt}
            </button>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>Previous</button>
          {picked[q.id] !== undefined && (
            <button className="btn-ghost" onClick={() => { const next = { ...picked }; delete next[q.id]; setPicked(next); }}>
              Clear answer
            </button>
          )}
          <button onClick={() => setIndex(Math.min(BANK.length - 1, index + 1))} disabled={index === BANK.length - 1}>Next</button>
        </div>
      </div>

      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>Palette</strong>
          <small>{answered} answered</small>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {BANK.map((item, i) => (
            <button
              key={item.id}
              onClick={() => setIndex(i)}
              className={i === index ? 'primary' : picked[item.id] !== undefined ? 'badge badge-success' : flagged[item.id] ? 'badge badge-warning' : ''}
              style={{ minWidth: 40 }}
              aria-label={'Go to question ' + (i + 1)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <button className="primary" onClick={submit}>Submit paper</button>
      </div>
    </div>
  );
}

export default App;
`;

export const societyAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

// A housing society runs on four linked things: the FLATS, the monthly MAINTENANCE due per flat, the
// NOTICES on the board, and the COMPLAINTS nobody has closed yet. The linkage is the point — a due
// belongs to a flat, and a flat with no dues is the one the treasurer is chasing.
interface Flat extends Entity { number: string; owner: string; phone: string; block: string; }
interface Due extends Entity { flatId: string; month: string; amount: number; paid: boolean; }
interface Notice extends Entity { title: string; body: string; at: string; }
interface Complaint extends Entity { flatId: string; text: string; status: 'open' | 'in-progress' | 'closed'; at: string; }

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const MONTHLY = 2500;

const SEED_FLATS: Flat[] = [
  { id: 'f1', number: 'A-101', owner: 'Sunita Deshmukh', phone: '98200 11223', block: 'A' },
  { id: 'f2', number: 'A-102', owner: 'Rakesh Iyer', phone: '98200 44556', block: 'A' },
  { id: 'f3', number: 'B-201', owner: 'Farida Sheikh', phone: '98200 77889', block: 'B' },
];
const SEED_DUES: Due[] = [
  { id: 'd1', flatId: 'f1', month: 'Aug', amount: MONTHLY, paid: true },
  { id: 'd2', flatId: 'f2', month: 'Aug', amount: MONTHLY, paid: false },
  { id: 'd3', flatId: 'f3', month: 'Aug', amount: MONTHLY, paid: false },
];
const SEED_NOTICES: Notice[] = [
  { id: 'n1', title: 'Water tank cleaning', body: 'Supply will be off on Sunday from 9 am to 1 pm. Please store water in advance.', at: new Date().toISOString() },
];
const SEED_COMPLAINTS: Complaint[] = [
  { id: 'c1', flatId: 'f3', text: 'Corridor light on the second floor is not working.', status: 'open', at: new Date().toISOString() },
];

export default function App() {
  const [screen, setScreen] = useState('dashboard');
  const flats = useCollection<Flat>('society-flats-v1', SEED_FLATS);
  const dues = useCollection<Due>('society-dues-v1', SEED_DUES);
  const notices = useCollection<Notice>('society-notices-v1', SEED_NOTICES);
  const complaints = useCollection<Complaint>('society-complaints-v1', SEED_COMPLAINTS);

  const [flatForm, setFlatForm] = useState<{ number: string; owner: string; phone: string; block: string } | null>(null);
  const [noticeForm, setNoticeForm] = useState<{ title: string; body: string } | null>(null);
  const [complaintForm, setComplaintForm] = useState<{ flatId: string; text: string } | null>(null);
  const [month, setMonth] = useState('Aug');

  const flatName = (id: string) => {
    const f = flats.items.find((x) => x.id === id);
    return f ? f.number : 'Unknown flat';
  };

  const totals = useMemo(() => {
    const forMonth = dues.items.filter((d) => d.month === month);
    const collected = forMonth.filter((d) => d.paid).reduce((s, d) => s + d.amount, 0);
    const pending = forMonth.filter((d) => !d.paid).reduce((s, d) => s + d.amount, 0);
    return { collected, pending, open: complaints.items.filter((c) => c.status !== 'closed').length };
  }, [dues.items, complaints.items, month]);

  // Raising the month's bill for every flat at once is the job a treasurer actually does, and doing it
  // per flat is what makes people give up on the app. Flats already billed this month are skipped, so
  // pressing it twice cannot double-bill anyone.
  const raiseMonth = () => {
    for (const f of flats.items) {
      if (dues.items.some((d) => d.flatId === f.id && d.month === month)) continue;
      dues.add({ flatId: f.id, month, amount: MONTHLY, paid: false } as Omit<Due, 'id'>);
    }
  };

  const nav = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'flats', label: 'Flats' },
    { id: 'dues', label: 'Maintenance' },
    { id: 'notices', label: 'Notice board' },
    { id: 'complaints', label: 'Complaints' },
  ];

  return (
    <Shell brand="Society" nav={nav} active={screen} onNavigate={setScreen} actions={<ThemeToggle />}>
      {screen === 'dashboard' && (
        <>
          <StatRow>
            <StatTile label="Flats" value={String(flats.items.length)} />
            <StatTile label={'Collected (' + month + ')'} value={inr(totals.collected)} />
            <StatTile label="Pending" value={inr(totals.pending)} hint="Follow up this week" />
            <StatTile label="Open complaints" value={String(totals.open)} />
          </StatRow>
          <Card title="Who has not paid yet">
            {dues.items.filter((d) => d.month === month && !d.paid).length === 0 ? (
              <Empty>Every flat has paid for {month}.</Empty>
            ) : (
              dues.items.filter((d) => d.month === month && !d.paid).map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <strong style={{ flex: 1 }}>{flatName(d.flatId)}</strong>
                  <span>{inr(d.amount)}</span>
                  <Button variant="ghost" onClick={() => dues.update(d.id, { paid: true } as Partial<Due>)}>Mark paid</Button>
                </div>
              ))
            )}
          </Card>
          <Card title="Latest notice" style={{ marginTop: 16 }}>
            {notices.items.length === 0 ? <Empty>No notices yet.</Empty> : (
              <>
                <strong>{notices.items[0].title}</strong>
                <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>{notices.items[0].body}</p>
              </>
            )}
          </Card>
        </>
      )}

      {screen === 'flats' && (
        <Card title="Flats" actions={<Button onClick={() => setFlatForm({ number: '', owner: '', phone: '', block: 'A' })}>Add flat</Button>}>
          {flats.items.length === 0 ? <Empty>No flats added yet.</Empty> : flats.items.map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <strong>{f.number}</strong>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{f.owner} · {f.phone}</div>
              </div>
              <Badge tone="accent">Block {f.block}</Badge>
              <Button variant="danger" onClick={() => flats.remove(f.id)}>Remove</Button>
            </div>
          ))}
        </Card>
      )}

      {screen === 'dues' && (
        <Card
          title="Monthly maintenance"
          actions={<Button onClick={raiseMonth}>Raise {month} bill</Button>}
        >
          <Select
            label="Month"
            value={month}
            onChange={setMonth}
            options={MONTHS.map((m) => ({ value: m, label: m }))}
          />
          {dues.items.filter((d) => d.month === month).length === 0 ? (
            <Empty>Nothing billed for {month} yet. Raise the bill to add every flat at once.</Empty>
          ) : dues.items.filter((d) => d.month === month).map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <strong style={{ flex: 1 }}>{flatName(d.flatId)}</strong>
              <span>{inr(d.amount)}</span>
              <Badge tone={d.paid ? 'good' : 'warn'}>{d.paid ? 'Paid' : 'Pending'}</Badge>
              <Button variant="ghost" onClick={() => dues.update(d.id, { paid: !d.paid } as Partial<Due>)}>
                {d.paid ? 'Undo' : 'Mark paid'}
              </Button>
            </div>
          ))}
        </Card>
      )}

      {screen === 'notices' && (
        <Card title="Notice board" actions={<Button onClick={() => setNoticeForm({ title: '', body: '' })}>New notice</Button>}>
          {notices.items.length === 0 ? <Empty>Nothing on the board.</Empty> : notices.items.map((n) => (
            <div key={n.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <strong style={{ flex: 1 }}>{n.title}</strong>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(n.at)}</span>
                <Button variant="danger" onClick={() => notices.remove(n.id)}>Delete</Button>
              </div>
              <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>{n.body}</p>
            </div>
          ))}
        </Card>
      )}

      {screen === 'complaints' && (
        <Card
          title="Complaints"
          actions={<Button onClick={() => setComplaintForm({ flatId: flats.items.length ? flats.items[0].id : '', text: '' })}>Log complaint</Button>}
        >
          {complaints.items.length === 0 ? <Empty>No complaints logged.</Empty> : complaints.items.map((c) => (
            <div key={c.id} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <strong style={{ flex: 1 }}>{flatName(c.flatId)}</strong>
                <Badge tone={c.status === 'closed' ? 'good' : c.status === 'in-progress' ? 'accent' : 'warn'}>{c.status}</Badge>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(c.at)}</span>
              </div>
              <p style={{ margin: '6px 0' }}>{c.text}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                {c.status !== 'in-progress' && <Button variant="ghost" onClick={() => complaints.update(c.id, { status: 'in-progress' } as Partial<Complaint>)}>Start</Button>}
                {c.status !== 'closed' && <Button variant="ghost" onClick={() => complaints.update(c.id, { status: 'closed' } as Partial<Complaint>)}>Close</Button>}
                <Button variant="danger" onClick={() => complaints.remove(c.id)}>Delete</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      {flatForm && (
        <Modal title="Add flat" onClose={() => setFlatForm(null)}>
          <Field label="Flat number" value={flatForm.number} onChange={(v) => setFlatForm({ ...flatForm, number: v })} placeholder="A-103" />
          <Field label="Owner" value={flatForm.owner} onChange={(v) => setFlatForm({ ...flatForm, owner: v })} />
          <Field label="Phone" value={flatForm.phone} onChange={(v) => setFlatForm({ ...flatForm, phone: v })} />
          <Field label="Block" value={flatForm.block} onChange={(v) => setFlatForm({ ...flatForm, block: v })} />
          <Button
            onClick={() => {
              if (!flatForm.number.trim()) return;
              flats.add({ number: flatForm.number.trim(), owner: flatForm.owner.trim(), phone: flatForm.phone.trim(), block: flatForm.block.trim() || 'A' } as Omit<Flat, 'id'>);
              setFlatForm(null);
            }}
          >
            Save flat
          </Button>
        </Modal>
      )}

      {noticeForm && (
        <Modal title="New notice" onClose={() => setNoticeForm(null)}>
          <Field label="Title" value={noticeForm.title} onChange={(v) => setNoticeForm({ ...noticeForm, title: v })} />
          <Field label="Details" value={noticeForm.body} onChange={(v) => setNoticeForm({ ...noticeForm, body: v })} />
          <Button
            onClick={() => {
              if (!noticeForm.title.trim()) return;
              notices.add({ title: noticeForm.title.trim(), body: noticeForm.body.trim(), at: new Date().toISOString() } as Omit<Notice, 'id'>);
              setNoticeForm(null);
            }}
          >
            Put on board
          </Button>
        </Modal>
      )}

      {complaintForm && (
        <Modal title="Log complaint" onClose={() => setComplaintForm(null)}>
          <Select
            label="Flat"
            value={complaintForm.flatId}
            onChange={(v) => setComplaintForm({ ...complaintForm, flatId: v })}
            options={flats.items.map((f) => ({ value: f.id, label: f.number }))}
          />
          <Field label="Complaint" value={complaintForm.text} onChange={(v) => setComplaintForm({ ...complaintForm, text: v })} />
          <Button
            onClick={() => {
              if (!complaintForm.text.trim() || !complaintForm.flatId) return;
              complaints.add({ flatId: complaintForm.flatId, text: complaintForm.text.trim(), status: 'open', at: new Date().toISOString() } as Omit<Complaint, 'id'>);
              setComplaintForm(null);
            }}
          >
            Log it
          </Button>
        </Modal>
      )}
    </Shell>
  );
}
`;

export const coachingAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

// A coaching class is four linked records: BATCHES (a subject at a time, with a monthly fee), the
// STUDENTS in them, the ATTENDANCE taken batch-by-batch on a date, and the monthly FEE per student.
// The fee amount comes from the student's batch, so changing a batch fee does not silently rewrite a
// receipt that was already issued.
interface Batch extends Entity { name: string; subject: string; fee: number; timing: string; }
interface Student extends Entity { name: string; phone: string; batchId: string; joinedAt: string; }
interface Fee extends Entity { studentId: string; month: string; amount: number; paid: boolean; }
interface Mark extends Entity { studentId: string; date: string; present: boolean; }

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

const SEED_BATCHES: Batch[] = [
  { id: 'b1', name: 'Class 10 Maths', subject: 'Mathematics', fee: 1200, timing: 'Mon/Wed/Fri 6 pm' },
  { id: 'b2', name: 'Class 12 Physics', subject: 'Physics', fee: 1800, timing: 'Tue/Thu 7 pm' },
];
const SEED_STUDENTS: Student[] = [
  { id: 's1', name: 'Anjali Verma', phone: '90000 11111', batchId: 'b1', joinedAt: new Date().toISOString() },
  { id: 's2', name: 'Imran Qureshi', phone: '90000 22222', batchId: 'b1', joinedAt: new Date().toISOString() },
  { id: 's3', name: 'Meera Nair', phone: '90000 33333', batchId: 'b2', joinedAt: new Date().toISOString() },
];
const SEED_FEES: Fee[] = [
  { id: 'p1', studentId: 's1', month: 'Aug', amount: 1200, paid: true },
  { id: 'p2', studentId: 's2', month: 'Aug', amount: 1200, paid: false },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function App() {
  const [screen, setScreen] = useState('dashboard');
  const batches = useCollection<Batch>('coaching-batches-v1', SEED_BATCHES);
  const students = useCollection<Student>('coaching-students-v1', SEED_STUDENTS);
  const fees = useCollection<Fee>('coaching-fees-v1', SEED_FEES);
  const marks = useCollection<Mark>('coaching-attendance-v1', []);

  const [month, setMonth] = useState('Aug');
  const [date, setDate] = useState(today);
  const [batchFilter, setBatchFilter] = useState('all');
  const [studentForm, setStudentForm] = useState<{ name: string; phone: string; batchId: string } | null>(null);
  const [batchForm, setBatchForm] = useState<{ name: string; subject: string; fee: string; timing: string } | null>(null);

  const batchName = (id: string) => {
    const b = batches.items.find((x) => x.id === id);
    return b ? b.name : 'No batch';
  };
  const studentName = (id: string) => {
    const s = students.items.find((x) => x.id === id);
    return s ? s.name : 'Unknown student';
  };

  const visibleStudents = useMemo(
    () => (batchFilter === 'all' ? students.items : students.items.filter((s) => s.batchId === batchFilter)),
    [students.items, batchFilter],
  );

  const money = useMemo(() => {
    const forMonth = fees.items.filter((f) => f.month === month);
    return {
      collected: forMonth.filter((f) => f.paid).reduce((s, f) => s + f.amount, 0),
      pending: forMonth.filter((f) => !f.paid).reduce((s, f) => s + f.amount, 0),
      unbilled: students.items.filter((s) => !forMonth.some((f) => f.studentId === s.id)).length,
    };
  }, [fees.items, students.items, month]);

  // Raising the month's fees for everyone at once, at each student's OWN batch rate, and skipping
  // anyone already billed — so pressing it twice never doubles a student's fee.
  const raiseFees = () => {
    for (const s of students.items) {
      if (fees.items.some((f) => f.studentId === s.id && f.month === month)) continue;
      const b = batches.items.find((x) => x.id === s.batchId);
      fees.add({ studentId: s.id, month, amount: b ? b.fee : 0, paid: false } as Omit<Fee, 'id'>);
    }
  };

  const markFor = (studentId: string) => marks.items.find((m) => m.studentId === studentId && m.date === date);
  const setPresence = (studentId: string, present: boolean) => {
    const existing = markFor(studentId);
    if (existing) marks.update(existing.id, { present } as Partial<Mark>);
    else marks.add({ studentId, date, present } as Omit<Mark, 'id'>);
  };

  const attendancePct = (studentId: string) => {
    const mine = marks.items.filter((m) => m.studentId === studentId);
    if (!mine.length) return null;
    return Math.round((mine.filter((m) => m.present).length / mine.length) * 100);
  };

  const nav = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'students', label: 'Students' },
    { id: 'batches', label: 'Batches' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'fees', label: 'Fees' },
  ];

  return (
    <Shell brand="Coaching" nav={nav} active={screen} onNavigate={setScreen} actions={<ThemeToggle />}>
      {screen === 'dashboard' && (
        <>
          <StatRow>
            <StatTile label="Students" value={String(students.items.length)} />
            <StatTile label="Batches" value={String(batches.items.length)} />
            <StatTile label={'Collected (' + month + ')'} value={inr(money.collected)} />
            <StatTile label="Fees pending" value={inr(money.pending)} hint={money.unbilled > 0 ? money.unbilled + ' not billed yet' : undefined} />
          </StatRow>
          <Card title="Fees still to come in">
            {fees.items.filter((f) => f.month === month && !f.paid).length === 0 ? (
              <Empty>Everyone has paid for {month}.</Empty>
            ) : fees.items.filter((f) => f.month === month && !f.paid).map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <strong style={{ flex: 1 }}>{studentName(f.studentId)}</strong>
                <span>{inr(f.amount)}</span>
                <Button variant="ghost" onClick={() => fees.update(f.id, { paid: true } as Partial<Fee>)}>Mark paid</Button>
              </div>
            ))}
          </Card>
          <Card title="Low attendance" style={{ marginTop: 16 }}>
            {students.items.filter((s) => { const p = attendancePct(s.id); return p !== null && p < 75; }).length === 0 ? (
              <Empty>Nobody is below 75% so far.</Empty>
            ) : students.items.filter((s) => { const p = attendancePct(s.id); return p !== null && p < 75; }).map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                <strong style={{ flex: 1 }}>{s.name}</strong>
                <Badge tone="bad">{attendancePct(s.id)}%</Badge>
              </div>
            ))}
          </Card>
        </>
      )}

      {screen === 'students' && (
        <Card
          title="Students"
          actions={<Button onClick={() => setStudentForm({ name: '', phone: '', batchId: batches.items.length ? batches.items[0].id : '' })}>Add student</Button>}
        >
          <Select
            label="Batch"
            value={batchFilter}
            onChange={setBatchFilter}
            options={[{ value: 'all', label: 'All batches' }].concat(batches.items.map((b) => ({ value: b.id, label: b.name })))}
          />
          {visibleStudents.length === 0 ? <Empty>No students in this batch yet.</Empty> : visibleStudents.map((s) => {
            const pct = attendancePct(s.id);
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ flex: 1 }}>
                  <strong>{s.name}</strong>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>{s.phone} · joined {shortDate(s.joinedAt)}</div>
                </div>
                <Badge tone="accent">{batchName(s.batchId)}</Badge>
                {pct !== null && <Badge tone={pct >= 75 ? 'good' : 'bad'}>{pct}%</Badge>}
                <Button variant="danger" onClick={() => students.remove(s.id)}>Remove</Button>
              </div>
            );
          })}
        </Card>
      )}

      {screen === 'batches' && (
        <Card title="Batches" actions={<Button onClick={() => setBatchForm({ name: '', subject: '', fee: '', timing: '' })}>Add batch</Button>}>
          {batches.items.length === 0 ? <Empty>No batches yet.</Empty> : batches.items.map((b) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <strong>{b.name}</strong>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{b.subject} · {b.timing}</div>
              </div>
              <Badge tone="neutral">{students.items.filter((s) => s.batchId === b.id).length} students</Badge>
              <span>{inr(b.fee)}/month</span>
              <Button variant="danger" onClick={() => batches.remove(b.id)}>Remove</Button>
            </div>
          ))}
        </Card>
      )}

      {screen === 'attendance' && (
        <Card title="Take attendance">
          <Field label="Date" value={date} onChange={setDate} type="date" />
          <Select
            label="Batch"
            value={batchFilter}
            onChange={setBatchFilter}
            options={[{ value: 'all', label: 'All batches' }].concat(batches.items.map((b) => ({ value: b.id, label: b.name })))}
          />
          {visibleStudents.length === 0 ? <Empty>No students to mark.</Empty> : visibleStudents.map((s) => {
            const m = markFor(s.id);
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <strong style={{ flex: 1 }}>{s.name}</strong>
                {m && <Badge tone={m.present ? 'good' : 'bad'}>{m.present ? 'Present' : 'Absent'}</Badge>}
                <Button variant={m && m.present ? 'primary' : 'ghost'} onClick={() => setPresence(s.id, true)}>Present</Button>
                <Button variant={m && !m.present ? 'danger' : 'ghost'} onClick={() => setPresence(s.id, false)}>Absent</Button>
              </div>
            );
          })}
        </Card>
      )}

      {screen === 'fees' && (
        <Card title="Monthly fees" actions={<Button onClick={raiseFees}>Raise {month} fees</Button>}>
          <Select label="Month" value={month} onChange={setMonth} options={MONTHS.map((m) => ({ value: m, label: m }))} />
          {fees.items.filter((f) => f.month === month).length === 0 ? (
            <Empty>Nothing billed for {month}. Raise the fees to bill every student at their own batch rate.</Empty>
          ) : fees.items.filter((f) => f.month === month).map((f) => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <strong style={{ flex: 1 }}>{studentName(f.studentId)}</strong>
              <span>{inr(f.amount)}</span>
              <Badge tone={f.paid ? 'good' : 'warn'}>{f.paid ? 'Paid' : 'Pending'}</Badge>
              <Button variant="ghost" onClick={() => fees.update(f.id, { paid: !f.paid } as Partial<Fee>)}>{f.paid ? 'Undo' : 'Mark paid'}</Button>
            </div>
          ))}
        </Card>
      )}

      {studentForm && (
        <Modal title="Add student" onClose={() => setStudentForm(null)}>
          <Field label="Name" value={studentForm.name} onChange={(v) => setStudentForm({ ...studentForm, name: v })} />
          <Field label="Phone" value={studentForm.phone} onChange={(v) => setStudentForm({ ...studentForm, phone: v })} />
          <Select
            label="Batch"
            value={studentForm.batchId}
            onChange={(v) => setStudentForm({ ...studentForm, batchId: v })}
            options={batches.items.map((b) => ({ value: b.id, label: b.name }))}
          />
          <Button
            onClick={() => {
              if (!studentForm.name.trim()) return;
              students.add({ name: studentForm.name.trim(), phone: studentForm.phone.trim(), batchId: studentForm.batchId, joinedAt: new Date().toISOString() } as Omit<Student, 'id'>);
              setStudentForm(null);
            }}
          >
            Save student
          </Button>
        </Modal>
      )}

      {batchForm && (
        <Modal title="Add batch" onClose={() => setBatchForm(null)}>
          <Field label="Batch name" value={batchForm.name} onChange={(v) => setBatchForm({ ...batchForm, name: v })} placeholder="Class 9 Science" />
          <Field label="Subject" value={batchForm.subject} onChange={(v) => setBatchForm({ ...batchForm, subject: v })} />
          <Field label="Monthly fee" value={batchForm.fee} onChange={(v) => setBatchForm({ ...batchForm, fee: v })} placeholder="1200" />
          <Field label="Timing" value={batchForm.timing} onChange={(v) => setBatchForm({ ...batchForm, timing: v })} placeholder="Mon/Wed 5 pm" />
          <Button
            onClick={() => {
              const fee = Number(batchForm.fee);
              if (!batchForm.name.trim() || !Number.isFinite(fee) || fee < 0) return;
              batches.add({ name: batchForm.name.trim(), subject: batchForm.subject.trim(), fee, timing: batchForm.timing.trim() } as Omit<Batch, 'id'>);
              setBatchForm(null);
            }}
          >
            Save batch
          </Button>
        </Modal>
      )}
    </Shell>
  );
}
`;
