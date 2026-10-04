import { useEffect, useRef, useState } from 'react';
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
