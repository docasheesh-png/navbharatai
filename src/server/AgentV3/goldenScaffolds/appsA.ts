// AgentV3 — Golden Scaffold apps (part A): To-do, Calculator, Stopwatch & timer, Pomodoro, Tip split.
//
// Each export is a COMPLETE, hand-verified src/App.tsx implementing its starter-template promise
// (see starterTemplates.ts) on top of the shared base (goldenBaseFiles). CI proves every one parses
// under esbuild AND compiles under the in-browser Babel preview (the white-screen killer), and has
// no duplicate imports. Written without backslash escapes / template literals so the embedded code
// survives this file's own template-literal wrapping byte-for-byte.

export const todoAppTsx = `import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

interface Todo { id: string; text: string; done: boolean; category: string; }
type Filter = 'all' | 'active' | 'done';

const CATEGORIES = ['Personal', 'Work', 'Shopping', 'Other'];
const STORE_KEY = 'todos-v1';

function load(): Todo[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Todo[]) : [];
  } catch { return []; }
}

function App() {
  const [todos, setTodos] = useState<Todo[]>(load);
  const [text, setText] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [filter, setFilter] = useState<Filter>('all');
  const [catFilter, setCatFilter] = useState('All');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(todos)); }, [todos]);

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setTodos([{ id: String(Date.now()), text: t, done: false, category }, ...todos]);
    setText('');
  };
  const toggle = (id: string) => setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTodos(todos.filter((t) => t.id !== id));
  const saveEdit = (id: string) => {
    const t = editText.trim();
    if (t) setTodos(todos.map((x) => (x.id === id ? { ...x, text: t } : x)));
    setEditingId(null);
  };

  const visible = useMemo(
    () => todos
      .filter((t) => (filter === 'all' ? true : filter === 'done' ? t.done : !t.done))
      .filter((t) => (catFilter === 'All' ? true : t.category === catFilter)),
    [todos, filter, catFilter],
  );
  const remaining = todos.filter((t) => !t.done).length;

  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>To-do</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 160 }}
            value={text}
            placeholder="What needs doing?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="primary" onClick={add}>Add</button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {(['all', 'active', 'done'] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? 'primary' : ''}
              onClick={() => setFilter(f)}
              style={{ padding: '5px 12px', textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ marginLeft: 'auto' }}>
            {['All', ...CATEGORIES].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {visible.length === 0 && (
          <p className="muted" style={{ textAlign: 'center', margin: '12px 0' }}>Nothing here yet — add your first task!</p>
        )}
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map((t) => (
            <li key={t.id} className="row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} style={{ width: 18, height: 18 }} />
              {editingId === t.id ? (
                <input
                  autoFocus
                  style={{ flex: 1 }}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(t.id); }}
                  onBlur={() => saveEdit(t.id)}
                />
              ) : (
                <span
                  style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.55 : 1 }}
                  onDoubleClick={() => { setEditingId(t.id); setEditText(t.text); }}
                >
                  {t.text} <span className="badge" style={{ marginLeft: 6 }}>{t.category}</span>
                </span>
              )}
              <button className="btn-ghost" onClick={() => { setEditingId(t.id); setEditText(t.text); }} aria-label="Edit">Edit</button>
              <button className="btn-ghost" onClick={() => remove(t.id)} aria-label="Delete" style={{ color: 'var(--danger)' }}>Delete</button>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{remaining} task(s) remaining · saved on this device</p>
      </div>
    </div>
  );
}
export default App;
`;

export const calculatorAppTsx = `import { useEffect, useState } from 'react';
import ThemeToggle from './theme';

type Op = '+' | '-' | 'x' | '/';

function compute(a: number, b: number, op: Op): number {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === 'x') return a * b;
  return b === 0 ? NaN : a / b;
}

function fmt(n: number): string {
  if (!isFinite(n) || isNaN(n)) return 'Error';
  const s = String(Math.round(n * 1e10) / 1e10);
  return s.length > 14 ? n.toExponential(6) : s;
}

function App() {
  const [display, setDisplay] = useState('0');
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);
  const [history, setHistory] = useState<string[]>([]);

  const inputDigit = (d: string) => {
    if (fresh) { setDisplay(d === '.' ? '0.' : d); setFresh(false); return; }
    if (d === '.' && display.includes('.')) return;
    setDisplay(display === '0' && d !== '.' ? d : display + d);
  };
  const chooseOp = (nextOp: Op) => {
    const cur = parseFloat(display);
    if (acc !== null && op !== null && !fresh) {
      const r = compute(acc, cur, op);
      setAcc(r);
      setDisplay(fmt(r));
    } else {
      setAcc(cur);
    }
    setOp(nextOp);
    setFresh(true);
  };
  const equals = () => {
    if (acc === null || op === null) return;
    const cur = parseFloat(display);
    const r = compute(acc, cur, op);
    setHistory([fmt(acc) + ' ' + op + ' ' + fmt(cur) + ' = ' + fmt(r), ...history].slice(0, 10));
    setDisplay(fmt(r));
    setAcc(null);
    setOp(null);
    setFresh(true);
  };
  const clearAll = () => { setDisplay('0'); setAcc(null); setOp(null); setFresh(true); };
  const backspace = () => {
    if (fresh) return;
    setDisplay(display.length > 1 ? display.slice(0, -1) : '0');
  };
  const percent = () => { setDisplay(fmt(parseFloat(display) / 100)); setFresh(true); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && '0123456789.'.includes(e.key)) inputDigit(e.key);
      else if (e.key === '+') chooseOp('+');
      else if (e.key === '-') chooseOp('-');
      else if (e.key === '*') chooseOp('x');
      else if (e.key === '/') { e.preventDefault(); chooseOp('/'); }
      else if (e.key === 'Enter' || e.key === '=') equals();
      else if (e.key === 'Backspace') backspace();
      else if (e.key === 'Escape') clearAll();
      else if (e.key === '%') percent();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const key = (label: string, onClick: () => void, cls?: string, span?: number) => (
    <button
      className={cls || ''}
      onClick={onClick}
      style={{ gridColumn: span === 2 ? 'span 2' : undefined, padding: '18px 0', fontSize: 20, fontWeight: 600 }}
    >
      {label}
    </button>
  );

  return (
    <div className="container" style={{ maxWidth: 380, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Calculator</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div style={{ textAlign: 'right', minHeight: 68 }}>
          <div className="muted" style={{ minHeight: 20, fontSize: 14 }}>{acc !== null && op ? fmt(acc) + ' ' + op : ' '}</div>
          <div style={{ fontSize: 40, fontWeight: 800, overflowWrap: 'anywhere' }}>{display}</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {key('C', clearAll)}
          {key('DEL', backspace)}
          {key('%', percent)}
          {key('/', () => chooseOp('/'), 'primary')}
          {key('7', () => inputDigit('7'))}
          {key('8', () => inputDigit('8'))}
          {key('9', () => inputDigit('9'))}
          {key('x', () => chooseOp('x'), 'primary')}
          {key('4', () => inputDigit('4'))}
          {key('5', () => inputDigit('5'))}
          {key('6', () => inputDigit('6'))}
          {key('-', () => chooseOp('-'), 'primary')}
          {key('1', () => inputDigit('1'))}
          {key('2', () => inputDigit('2'))}
          {key('3', () => inputDigit('3'))}
          {key('+', () => chooseOp('+'), 'primary')}
          {key('0', () => inputDigit('0'), '', 2)}
          {key('.', () => inputDigit('.'))}
          {key('=', equals, 'primary')}
        </div>
      </div>
      {history.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h4>History</h4>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 4 }}>
            {history.map((h, i) => <li key={i} className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{h}</li>)}
          </ul>
        </div>
      )}
      <p className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
        Keyboard works too: digits, + - * / % Enter DEL Esc
      </p>
    </div>
  );
}
export default App;
`;

export const stopwatchAppTsx = `import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

function beep(times: number) {
  try {
    const AnyWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = AnyWindow.AudioContext || AnyWindow.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.start(ctx.currentTime + i * 0.35);
      o.stop(ctx.currentTime + i * 0.35 + 0.2);
    }
  } catch { /* audio unavailable — silent */ }
}

function useTicker(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), 50);
    return () => clearInterval(id);
  }, [active]);
}

function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }
function fmtMs(ms: number): string {
  const cs = Math.floor((ms % 1000) / 10);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000);
  return pad2(m) + ':' + pad2(s) + '.' + pad2(cs);
}
function fmtClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}

function Stopwatch() {
  const [running, setRunning] = useState(false);
  const [base, setBase] = useState(0);
  const startRef = useRef(0);
  const [laps, setLaps] = useState<number[]>([]);
  useTicker(running);
  const elapsed = running ? base + (Date.now() - startRef.current) : base;

  const startPause = () => {
    if (running) { setBase(elapsed); setRunning(false); }
    else { startRef.current = Date.now(); setRunning(true); }
  };
  const reset = () => { setRunning(false); setBase(0); setLaps([]); };

  return (
    <div className="stack">
      <div style={{ fontSize: 56, fontWeight: 800, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtMs(elapsed)}</div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="primary" onClick={startPause} style={{ minWidth: 110 }}>{running ? 'Pause' : 'Start'}</button>
        <button onClick={() => setLaps([elapsed, ...laps])} disabled={!running}>Lap</button>
        <button onClick={reset}>Reset</button>
      </div>
      {laps.length > 0 && (
        <ol reversed style={{ margin: 0, paddingLeft: 24 }}>
          {laps.map((l, i) => (
            <li key={laps.length - i} className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMs(l)}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Timer() {
  const [min, setMin] = useState(5);
  const [sec, setSec] = useState(0);
  const [running, setRunning] = useState(false);
  const [remainBase, setRemainBase] = useState(0);
  const endRef = useRef(0);
  useTicker(running);
  const remain = running ? Math.max(0, endRef.current - Date.now()) : remainBase;

  useEffect(() => {
    if (running && endRef.current - Date.now() <= 0) {
      setRunning(false);
      setRemainBase(0);
      beep(3);
    }
  });

  const startPause = () => {
    if (running) { setRemainBase(Math.max(0, endRef.current - Date.now())); setRunning(false); return; }
    const ms = remainBase > 0 ? remainBase : (min * 60 + sec) * 1000;
    if (ms <= 0) return;
    endRef.current = Date.now() + ms;
    setRunning(true);
  };
  const reset = () => { setRunning(false); setRemainBase(0); };
  const showSetup = !running && remainBase === 0;

  return (
    <div className="stack">
      {showSetup ? (
        <div className="row" style={{ justifyContent: 'center' }}>
          <input type="number" min={0} max={999} value={min} onChange={(e) => setMin(Math.max(0, parseInt(e.target.value, 10) || 0))} style={{ width: 84, textAlign: 'center', fontSize: 22 }} aria-label="Minutes" />
          <span style={{ fontSize: 22, fontWeight: 700 }}>:</span>
          <input type="number" min={0} max={59} value={sec} onChange={(e) => setSec(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))} style={{ width: 84, textAlign: 'center', fontSize: 22 }} aria-label="Seconds" />
        </div>
      ) : (
        <div style={{ fontSize: 56, fontWeight: 800, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(remain)}</div>
      )}
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="primary" onClick={startPause} style={{ minWidth: 110 }}>{running ? 'Pause' : (remainBase > 0 ? 'Resume' : 'Start')}</button>
        <button onClick={reset}>Reset</button>
      </div>
      <p className="muted" style={{ textAlign: 'center', margin: 0, fontSize: 13 }}>An alarm sounds when the countdown reaches zero.</p>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<'stopwatch' | 'timer'>('stopwatch');
  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Stopwatch &amp; Timer</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className={tab === 'stopwatch' ? 'primary' : ''} onClick={() => setTab('stopwatch')} style={{ flex: 1 }}>Stopwatch</button>
        <button className={tab === 'timer' ? 'primary' : ''} onClick={() => setTab('timer')} style={{ flex: 1 }}>Timer</button>
      </div>
      <div className="card">{tab === 'stopwatch' ? <Stopwatch /> : <Timer />}</div>
    </div>
  );
}
export default App;
`;

export const pomodoroAppTsx = `import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const WORK_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
const SESSIONS_KEY = 'pomodoro-sessions-v1';

function chime() {
  try {
    const AnyWindow = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctx = AnyWindow.AudioContext || AnyWindow.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523, 659, 784].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = f;
      g.gain.value = 0.15;
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.3);
    });
  } catch { /* audio unavailable — silent */ }
}

function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

function App() {
  const [phase, setPhase] = useState<'work' | 'break'>('work');
  const [running, setRunning] = useState(false);
  const [remainBase, setRemainBase] = useState(WORK_MS);
  const endRef = useRef(0);
  const [sessions, setSessions] = useState(() => parseInt(localStorage.getItem(SESSIONS_KEY) || '0', 10) || 0);
  const [, force] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => { localStorage.setItem(SESSIONS_KEY, String(sessions)); }, [sessions]);

  const total = phase === 'work' ? WORK_MS : BREAK_MS;
  const remain = running ? Math.max(0, endRef.current - Date.now()) : remainBase;

  const advancePhase = (completedWork: boolean) => {
    if (completedWork) setSessions((s) => s + 1);
    const nextPhase = phase === 'work' ? 'break' : 'work';
    setPhase(nextPhase);
    setRunning(false);
    setRemainBase(nextPhase === 'work' ? WORK_MS : BREAK_MS);
  };

  useEffect(() => {
    if (running && endRef.current - Date.now() <= 0) {
      chime();
      advancePhase(phase === 'work');
    }
  });

  const startPause = () => {
    if (running) { setRemainBase(Math.max(0, endRef.current - Date.now())); setRunning(false); return; }
    endRef.current = Date.now() + remainBase;
    setRunning(true);
  };
  const skip = () => advancePhase(false);
  const reset = () => { setRunning(false); setRemainBase(total); };

  const s = Math.ceil(remain / 1000);
  const clock = pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  const pct = Math.round(((total - remain) / total) * 100);

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Pomodoro</h1>
        <ThemeToggle />
      </div>
      <div className="card stack" style={{ textAlign: 'center' }}>
        <span className={phase === 'work' ? 'badge' : 'badge badge-success'} style={{ alignSelf: 'center' }}>
          {phase === 'work' ? 'Focus - 25 min' : 'Break - 5 min'}
        </span>
        <div style={{ fontSize: 72, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{clock}</div>
        <div style={{ height: 8, borderRadius: 999, background: 'var(--accent-soft)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', background: 'var(--accent)', transition: 'width 0.25s' }} />
        </div>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={startPause} style={{ minWidth: 110 }}>{running ? 'Pause' : 'Start'}</button>
          <button onClick={skip}>Skip</button>
          <button onClick={reset}>Reset</button>
        </div>
        <p className="muted" style={{ margin: 0 }}>{sessions} focus session(s) completed</p>
      </div>
      <p className="muted" style={{ textAlign: 'center', marginTop: 12, fontSize: 13 }}>
        Work 25 minutes, rest 5 — a gentle chime marks each switch.
      </p>
    </div>
  );
}
export default App;
`;

export const tipSplitAppTsx = `import { useState } from 'react';
import ThemeToggle from './theme';

const PRESETS = [5, 10, 15, 18, 20];

function inr(n: number): string {
  return 'Rs ' + (isFinite(n) ? n.toFixed(2) : '0.00');
}

function App() {
  const [bill, setBill] = useState('');
  const [preset, setPreset] = useState(15);
  const [custom, setCustom] = useState('');
  const [people, setPeople] = useState(2);

  const pct = custom.trim() !== '' ? Math.max(0, parseFloat(custom) || 0) : preset;
  const b = Math.max(0, parseFloat(bill) || 0);
  const tip = (b * pct) / 100;
  const total = b + tip;
  const per = total / Math.max(1, people);

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Tip &amp; Split</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="field">
          <label>Bill amount</label>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            placeholder="0.00"
            value={bill}
            onChange={(e) => setBill(e.target.value)}
            style={{ fontSize: 22, textAlign: 'right' }}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Tip</label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {PRESETS.map((p) => (
              <button
                key={p}
                className={custom.trim() === '' && preset === p ? 'primary' : ''}
                onClick={() => { setPreset(p); setCustom(''); }}
                style={{ padding: '7px 14px' }}
              >
                {p}%
              </button>
            ))}
            <input
              type="number"
              min={0}
              placeholder="Custom %"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              style={{ width: 110 }}
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Split between</label>
          <div className="row">
            <button onClick={() => setPeople(Math.max(1, people - 1))} aria-label="Fewer people">-</button>
            <span style={{ fontSize: 20, fontWeight: 700, minWidth: 90, textAlign: 'center' }}>{people} {people === 1 ? 'person' : 'people'}</span>
            <button onClick={() => setPeople(people + 1)} aria-label="More people">+</button>
          </div>
        </div>
      </div>
      <div className="card stack" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Tip ({pct}%)</span><strong>{inr(tip)}</strong>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">Grand total</span><strong>{inr(total)}</strong>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <span style={{ fontWeight: 700 }}>Each person pays</span>
          <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>{inr(per)}</span>
        </div>
      </div>
    </div>
  );
}
export default App;
`;
