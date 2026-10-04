import { useEffect, useState } from 'react';
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
  // The display holds a number no operator has used yet (typed, or made by %). Without it, an operator
  // pressed after % dropped the pending one: 5 + 50 % + 2 = gave 2.5.
  const [operand, setOperand] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const inputDigit = (d: string) => {
    setOperand(true);
    if (fresh) { setDisplay(d === '.' ? '0.' : d); setFresh(false); return; }
    if (d === '.' && display.includes('.')) return;
    setDisplay(display === '0' && d !== '.' ? d : display + d);
  };
  const chooseOp = (nextOp: Op) => {
    const cur = parseFloat(display);
    if (acc !== null && op !== null && operand) {
      const r = compute(acc, cur, op);
      setAcc(r);
      setDisplay(fmt(r));
    } else if (acc === null || op === null) {
      setAcc(cur);
    } // else: a second operator in a row only replaces the first
    setOp(nextOp);
    setFresh(true);
    setOperand(false);
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
    setOperand(false);
  };
  const clearAll = () => { setDisplay('0'); setAcc(null); setOp(null); setFresh(true); setOperand(false); };
  const backspace = () => {
    if (fresh) return;
    setDisplay(display.length > 1 ? display.slice(0, -1) : '0');
  };
  const percent = () => { setDisplay(fmt(parseFloat(display) / 100)); setFresh(true); setOperand(true); };

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

  // `name` is what a screen reader says: "DEL" and "x" are glyphs, not names.
  const key = (label: string, onClick: () => void, cls?: string, span?: number, name?: string) => (
    <button
      className={cls || ''}
      aria-label={name}
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
          {key('C', clearAll, '', 1, 'Clear')}
          {key('DEL', backspace, '', 1, 'Backspace')}
          {key('%', percent, '', 1, 'Percent')}
          {key('/', () => chooseOp('/'), 'primary', 1, 'Divide')}
          {key('7', () => inputDigit('7'))}
          {key('8', () => inputDigit('8'))}
          {key('9', () => inputDigit('9'))}
          {key('x', () => chooseOp('x'), 'primary', 1, 'Multiply')}
          {key('4', () => inputDigit('4'))}
          {key('5', () => inputDigit('5'))}
          {key('6', () => inputDigit('6'))}
          {key('-', () => chooseOp('-'), 'primary', 1, 'Minus')}
          {key('1', () => inputDigit('1'))}
          {key('2', () => inputDigit('2'))}
          {key('3', () => inputDigit('3'))}
          {key('+', () => chooseOp('+'), 'primary', 1, 'Plus')}
          {key('0', () => inputDigit('0'), '', 2)}
          {key('.', () => inputDigit('.'), '', 1, 'Decimal point')}
          {key('=', equals, 'primary', 1, 'Equals')}
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
