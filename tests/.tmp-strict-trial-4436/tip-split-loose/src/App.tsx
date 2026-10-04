import { useState } from 'react';
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
            aria-label="Bill amount"
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
              aria-label="Custom tip percentage"
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
