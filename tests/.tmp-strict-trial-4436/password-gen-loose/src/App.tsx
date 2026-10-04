import { useState } from 'react';
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
          <input type="range" aria-label="Password length" min={6} max={32} value={len} onChange={(e) => setLen(parseInt(e.target.value, 10))} />
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
