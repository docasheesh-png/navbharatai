import { useEffect, useRef, useState } from 'react';
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
  const [sessions, setSessions] = useState(() => {
    try { return parseInt(localStorage.getItem(SESSIONS_KEY) || '0', 10) || 0; } catch { return 0; }
  });
  const [, force] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => { try { localStorage.setItem(SESSIONS_KEY, String(sessions)); } catch { /* storage blocked */ } }, [sessions]);

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
