import { useState } from 'react';
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
          <input type="number" aria-label="Value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ fontSize: 20 }} />
        </div>
        <div className="row">
          <select aria-label="Convert from" value={from} onChange={(e) => setFrom(e.target.value)} style={{ flex: 1 }}>
            {units.map((u) => <option key={u}>{u}</option>)}
          </select>
          <button onClick={swap} aria-label="Swap units" title="Swap">Swap</button>
          <select aria-label="Convert to" value={to} onChange={(e) => setTo(e.target.value)} style={{ flex: 1 }}>
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
