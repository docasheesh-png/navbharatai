// AgentV3 — Golden Scaffold apps (part B): Unit converter, QR maker, Quick notes, Password generator, Login page.
// Same contract as appsA.ts: complete hand-verified App.tsx files, CI-proven to parse (esbuild) and
// compile (in-browser Babel preview), no duplicate imports, no backslash escapes / template literals.

export const unitConverterAppTsx = `import { useState } from 'react';
import ThemeToggle from './theme';

// Factors convert each unit INTO the category's base unit (metre / kilogram / rupee).
const CATEGORIES: Record<string, Record<string, number>> = {
  Length: { metre: 1, kilometre: 1000, centimetre: 0.01, millimetre: 0.001, mile: 1609.344, foot: 0.3048, inch: 0.0254 },
  Weight: { kilogram: 1, gram: 0.001, tonne: 1000, pound: 0.45359237, ounce: 0.028349523 },
  Currency: { INR: 1, USD: 83, EUR: 90, GBP: 105 },
};
const TEMP_UNITS = ['Celsius', 'Fahrenheit', 'Kelvin'];

function toCelsius(v: number, from: string): number {
  if (from === 'Fahrenheit') return ((v - 32) * 5) / 9;
  if (from === 'Kelvin') return v - 273.15;
  return v;
}
function fromCelsius(c: number, to: string): number {
  if (to === 'Fahrenheit') return (c * 9) / 5 + 32;
  if (to === 'Kelvin') return c + 273.15;
  return c;
}

function fmt(n: number): string {
  if (!isFinite(n)) return '-';
  const r = Math.round(n * 1e6) / 1e6;
  return String(r);
}

function App() {
  const [cat, setCat] = useState('Length');
  const [from, setFrom] = useState('metre');
  const [to, setTo] = useState('kilometre');
  const [value, setValue] = useState('1');

  const isTemp = cat === 'Temperature';
  const units = isTemp ? TEMP_UNITS : Object.keys(CATEGORIES[cat]);

  const pickCat = (c: string) => {
    setCat(c);
    const u = c === 'Temperature' ? TEMP_UNITS : Object.keys(CATEGORIES[c]);
    setFrom(u[0]);
    setTo(u[1]);
  };
  const swap = () => { setFrom(to); setTo(from); };

  const v = parseFloat(value) || 0;
  const result = isTemp
    ? fromCelsius(toCelsius(v, from), to)
    : (v * CATEGORIES[cat][from]) / CATEGORIES[cat][to];

  return (
    <div className="container" style={{ maxWidth: 460, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Unit Converter</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {[...Object.keys(CATEGORIES), 'Temperature'].map((c) => (
            <button key={c} className={cat === c ? 'primary' : ''} onClick={() => pickCat(c)} style={{ padding: '6px 14px' }}>{c}</button>
          ))}
        </div>
        <div className="field">
          <label>Value</label>
          <input type="number" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ fontSize: 20 }} />
        </div>
        <div className="row">
          <select value={from} onChange={(e) => setFrom(e.target.value)} style={{ flex: 1 }}>
            {units.map((u) => <option key={u}>{u}</option>)}
          </select>
          <button onClick={swap} aria-label="Swap units" title="Swap">Swap</button>
          <select value={to} onChange={(e) => setTo(e.target.value)} style={{ flex: 1 }}>
            {units.map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="alert" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{fmt(result)} <span className="muted" style={{ fontSize: 16, fontWeight: 600 }}>{to}</span></div>
          <div className="muted" style={{ fontSize: 13 }}>{value || '0'} {from} equals</div>
        </div>
        {cat === 'Currency' && (
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Currency uses approximate fixed rates (1 USD = 83 INR, 1 EUR = 90 INR, 1 GBP = 105 INR) — edit them in the code, or ask for live rates.
          </p>
        )}
      </div>
    </div>
  );
}
export default App;
`;

export const qrMakerAppTsx = `import { useState } from 'react';
import ThemeToggle from './theme';

const SIZES = [200, 300, 500];

function App() {
  const [text, setText] = useState('https://example.com');
  const [size, setSize] = useState(300);
  const [busy, setBusy] = useState(false);

  const trimmed = text.trim();
  const qrUrl =
    'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
    '&data=' + encodeURIComponent(trimmed);

  const download = async () => {
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch(qrUrl);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qr-code.png';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(qrUrl, '_blank');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>QR Code Maker</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="field">
          <label>Text or link</label>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type any text or paste a link - the QR updates instantly"
          />
        </div>
        <div className="row">
          <label className="muted" style={{ fontSize: 14 }}>Size</label>
          {SIZES.map((s) => (
            <button key={s} className={size === s ? 'primary' : ''} onClick={() => setSize(s)} style={{ padding: '6px 14px' }}>
              {s}px
            </button>
          ))}
        </div>
        {trimmed ? (
          <div className="stack" style={{ alignItems: 'center' }}>
            <img
              src={qrUrl}
              width={Math.min(size, 300)}
              height={Math.min(size, 300)}
              alt={'QR code for: ' + trimmed.slice(0, 60)}
              style={{ background: '#ffffff', padding: 12, borderRadius: 12, maxWidth: '100%' }}
            />
            <button className="primary" onClick={download} disabled={busy}>
              {busy ? 'Preparing...' : 'Download PNG'}
            </button>
          </div>
        ) : (
          <p className="muted" style={{ textAlign: 'center', margin: '16px 0' }}>Type something above to generate its QR code.</p>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          QR images are generated via a free public API, so an internet connection is required.
        </p>
      </div>
    </div>
  );
}
export default App;
`;

export const quickNotesAppTsx = `import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

interface Note { id: string; text: string; pinned: boolean; ts: number; }
const STORE_KEY = 'quick-notes-v1';

function load(): Note[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Note[]) : [];
  } catch { return []; }
}

function App() {
  const [notes, setNotes] = useState<Note[]>(load);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(notes)); }, [notes]);

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setNotes([{ id: String(Date.now()), text: t, pinned: false, ts: Date.now() }, ...notes]);
    setText('');
  };
  const togglePin = (id: string) => setNotes(notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));
  const remove = (id: string) => setNotes(notes.filter((n) => n.id !== id));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => (q ? n.text.toLowerCase().includes(q) : true))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.ts - a.ts);
  }, [notes, query]);

  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Quick Notes</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="row">
          <input
            style={{ flex: 1 }}
            value={text}
            placeholder="Jot something down..."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button className="primary" onClick={add}>Add</button>
        </div>
        <input value={query} placeholder="Search notes" onChange={(e) => setQuery(e.target.value)} />
        {visible.length === 0 && (
          <p className="muted" style={{ textAlign: 'center', margin: '12px 0' }}>
            {notes.length === 0 ? 'No notes yet - your notes stay on this device.' : 'No notes match your search.'}
          </p>
        )}
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map((n) => (
            <li key={n.id} className="row" style={{ alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <span style={{ flex: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {n.pinned && <span className="badge" style={{ marginRight: 6 }}>Pinned</span>}
                {n.text}
              </span>
              <button className="btn-ghost" onClick={() => togglePin(n.id)}>{n.pinned ? 'Unpin' : 'Pin'}</button>
              <button className="btn-ghost" onClick={() => remove(n.id)} style={{ color: 'var(--danger)' }}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
export default App;
`;

export const passwordGenAppTsx = `import { useState } from 'react';
import ThemeToggle from './theme';

function App() {
  const [len, setLen] = useState(16);
  const [upper, setUpper] = useState(true);
  const [nums, setNums] = useState(true);
  const [syms, setSyms] = useState(true);
  const [pw, setPw] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = () => {
    let chars = 'abcdefghijklmnopqrstuvwxyz';
    if (upper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (nums) chars += '0123456789';
    if (syms) chars += '!@#$%^&*()-_=+[]{};:,.?';
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    let out = '';
    for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
    setPw(out);
    setCopied(false);
  };

  const copy = async () => {
    if (!pw) return;
    try {
      await navigator.clipboard.writeText(pw);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const variety = 1 + Number(upper) + Number(nums) + Number(syms);
  const score = (len >= 16 ? 2 : len >= 10 ? 1 : 0) + variety;
  const strength = score >= 5 ? 'Strong' : score >= 3 ? 'Okay' : 'Weak';
  const color = score >= 5 ? 'var(--success)' : score >= 3 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Password Generator</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div
          className="alert"
          style={{ textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 18, overflowWrap: 'anywhere', minHeight: 52 }}
        >
          {pw || 'Tap Generate to create a password'}
        </div>
        <div className="row">
          <button className="primary" onClick={generate} style={{ flex: 1 }}>Generate</button>
          <button onClick={copy} disabled={!pw}>{copied ? 'Copied!' : 'Copy'}</button>
        </div>
        {pw && (
          <div className="row">
            <span className="muted" style={{ fontSize: 13 }}>Strength</span>
            <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--accent-soft)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: (Math.min(score, 6) / 6) * 100 + '%', background: color }} />
            </div>
            <strong style={{ color }}>{strength}</strong>
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Length: {len}</label>
          <input type="range" min={6} max={32} value={len} onChange={(e) => setLen(parseInt(e.target.value, 10))} />
        </div>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /> Uppercase letters (A-Z)
        </label>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={nums} onChange={(e) => setNums(e.target.checked)} /> Numbers (0-9)
        </label>
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={syms} onChange={(e) => setSyms(e.target.checked)} /> Symbols (!@#$...)
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Generated locally in your browser with a cryptographically secure random source - nothing is sent anywhere.
        </p>
      </div>
    </div>
  );
}
export default App;
`;

export const loginPageAppTsx = `import { useState } from 'react';
import ThemeToggle from './theme';

const REMEMBER_KEY = 'login-remembered-email';

function validEmail(v: string): boolean {
  const at = v.indexOf('@');
  const dot = v.lastIndexOf('.');
  return at > 0 && dot > at + 1 && dot < v.length - 1 && !v.includes(' ');
}

function App() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(() => !!localStorage.getItem(REMEMBER_KEY));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [user, setUser] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const submit = () => {
    const e: Record<string, string> = {};
    if (!validEmail(email)) e.email = 'Enter a valid email address.';
    if (password.length < 8) e.password = 'Password must be at least 8 characters.';
    if (mode === 'signup' && confirm !== password) e.confirm = 'Passwords do not match.';
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    if (remember) localStorage.setItem(REMEMBER_KEY, email);
    else localStorage.removeItem(REMEMBER_KEY);
    setUser(email);
    setNotice('');
  };

  const social = (provider: string) => {
    setNotice(provider + ' sign-in is a UI demo here - connect your auth provider to enable it.');
  };

  if (user) {
    return (
      <div className="container" style={{ maxWidth: 420, paddingTop: 64 }}>
        <div className="card stack" style={{ textAlign: 'center' }}>
          <span className="badge badge-success" style={{ alignSelf: 'center' }}>Signed in</span>
          <h2 style={{ margin: 0 }}>Welcome!</h2>
          <p className="muted" style={{ margin: 0 }}>{user}</p>
          <button onClick={() => { setUser(null); setPassword(''); setConfirm(''); }}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 48, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="row">
          <button className={mode === 'login' ? 'primary' : ''} onClick={() => { setMode('login'); setErrors({}); }} style={{ flex: 1 }}>Log in</button>
          <button className={mode === 'signup' ? 'primary' : ''} onClick={() => { setMode('signup'); setErrors({}); }} style={{ flex: 1 }}>Sign up</button>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Email</label>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={errors.email ? { borderColor: 'var(--danger)' } : undefined}
          />
          {errors.email && <small style={{ color: 'var(--danger)' }}>{errors.email}</small>}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Password</label>
          <div className="row">
            <input
              type={showPw ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              style={{ flex: 1, ...(errors.password ? { borderColor: 'var(--danger)' } : {}) }}
            />
            <button onClick={() => setShowPw(!showPw)} aria-label={showPw ? 'Hide password' : 'Show password'}>
              {showPw ? 'Hide' : 'Show'}
            </button>
          </div>
          {errors.password && <small style={{ color: 'var(--danger)' }}>{errors.password}</small>}
        </div>
        {mode === 'signup' && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Confirm password</label>
            <input
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              style={errors.confirm ? { borderColor: 'var(--danger)' } : undefined}
            />
            {errors.confirm && <small style={{ color: 'var(--danger)' }}>{errors.confirm}</small>}
          </div>
        )}
        <label className="row" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember me on this device
        </label>
        <button type="submit" className="primary" onClick={submit} style={{ padding: '12px 0', fontSize: 16 }}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <small className="muted">or continue with</small>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
        <div className="row">
          <button onClick={() => social('Google')} style={{ flex: 1 }}>Google</button>
          <button onClick={() => social('GitHub')} style={{ flex: 1 }}>GitHub</button>
        </div>
        {notice && <div className="alert alert-warning" style={{ fontSize: 13 }}>{notice}</div>}
      </div>
    </div>
  );
}
export default App;
`;
