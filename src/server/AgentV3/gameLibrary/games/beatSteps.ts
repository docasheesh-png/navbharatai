// Beat Steps — the library rhythm game: four lanes, notes judged on the audio clock (perfect / good / miss, early or late),
// combo, accuracy grade, songs written as readable step charts, and a speaker offset.
// Our own code; every part is a named block so it can be changed by chat. Studied for ideas only, no code taken.
export const beatStepsAppTsx = `// __TITLE__ — a rhythm game: notes slide down four lanes in time with the beat; tap the lane (or press D F J K) as each note
// reaches the line. Our own code. Every part is a named block below, so any of it can be changed by asking: the OPTIONS
// (timing windows, note speed), the SONGS (tempo and the steps of each lane, written as text), the LOOKS, the COPY. Ideas
// studied (no code taken): timing judged against the audio clock, not the screen, so the beat and the judging agree; clear
// windows (perfect / good / miss) with early or late shown; a combo and accuracy grade; songs written as readable step
// charts; a calibration offset for slow speakers; and lane flashes on every hit.
import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './theme';

const TITLE = '__TITLE__';
const ACCENT = '__ACCENT__';
const BEST = 'beat-steps-best-v1';

// ── OPTIONS — change any of these ───────────────────────────────────────────
export const OPTIONS = {
  perfectMs: 50,           // within this many milliseconds of the beat = perfect
  goodMs: 110,             // within this = good; later than this = miss
  lookAhead: 1.6,          // seconds a note is on screen before the line
  offsetMs: 0,             // move every note later (+) or earlier (−) to suit your speakers
  keys: ['d', 'f', 'j', 'k'],
};

const COPY = {
  en: { play: 'Play', again: 'Play again', over: 'Game over', score: 'Score', best: 'Best', level: 'Song', combo: 'Combo',
    perfect: 'Perfect', good: 'Good', miss: 'Miss', early: 'early', late: 'late', accuracy: 'Accuracy', grade: 'Grade', lang: 'हिंदी' },
  hi: { play: 'खेलो', again: 'फिर खेलो', over: 'खेल खत्म', score: 'अंक', best: 'सर्वश्रेष्ठ', level: 'गीत', combo: 'कॉम्बो',
    perfect: 'एकदम सही', good: 'अच्छा', miss: 'चूक', early: 'जल्दी', late: 'देर', accuracy: 'सटीकता', grade: 'ग्रेड', lang: 'English' },
} as const;
type Lang = keyof typeof COPY;

// ── SONGS — one line per lane, one character per half-beat: x = note, . = rest. Every line in a song is the same length. ──
export const SONGS: Record<string, { en: string; hi: string; bpm: number; lanes: string[]; tones: number[] }> = {
  dhol: { en: 'Dhol Steps', hi: 'ढोल कदम', bpm: 100, tones: [196, 247, 294, 392], lanes: [
    'x...x...x...x...x.x.x...x...x...',
    '..x...x...x...x.....x...x.x.x...',
    '....x.......x.......x.......x.x.',
    '..........x...........x.....x...'] },
  rain: { en: 'Monsoon Run', hi: 'बरसात की दौड़', bpm: 120, tones: [262, 330, 392, 523], lanes: [
    'x.x.x.x.....x.x.x.x.....x.x.x.x.',
    '.x.x.x.x...x.x.x.x.....x.x.x.x..',
    '........x.x.......x.x...........',
    '..........x.x.........x.x.....xx'] },
};

// ── RULES — pure ────────────────────────────────────────────────────────────
export interface Note { lane: number; time: number; hit?: 'perfect' | 'good' | 'miss' }

/** A song's notes, in seconds from the start (each character is half a beat). */
export function chartFor(song: string): Note[] {
  const s = SONGS[song], half = 30 / s.bpm, notes: Note[] = [];
  s.lanes.forEach((line, lane) => line.split('').forEach((ch, i) => { if (ch === 'x') notes.push({ lane, time: 1 + i * half }); }));
  return notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
}

/** How a tap is judged: by how far (ms, + = late) it was from the note. */
export function judge(deltaMs: number, o = OPTIONS): 'perfect' | 'good' | 'miss' {
  const d = Math.abs(deltaMs);
  return d <= o.perfectMs ? 'perfect' : d <= o.goodMs ? 'good' : 'miss';
}

/** The note a tap in this lane at this time is for: the nearest one not yet judged, within the good window. */
export function noteFor(notes: Note[], lane: number, time: number, o = OPTIONS): Note | null {
  let best: Note | null = null;
  for (const n of notes) {
    if (n.lane !== lane || n.hit) continue;
    const d = Math.abs(time - n.time) * 1000;
    if (d <= o.goodMs && (!best || d < Math.abs(time - best.time) * 1000)) best = n;
  }
  return best;
}

/** Accuracy (0–1): perfect counts 1, good ½, miss 0. */
export function accuracy(notes: Note[]): number {
  const done = notes.filter((n) => n.hit);
  if (!done.length) return 0;
  return done.reduce((s, n) => s + (n.hit === 'perfect' ? 1 : n.hit === 'good' ? 0.5 : 0), 0) / done.length;
}

export const gradeFor = (acc: number) => (acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D');
export const pointsFor = (hit: 'perfect' | 'good' | 'miss', combo: number) =>
  (hit === 'perfect' ? 100 : hit === 'good' ? 50 : 0) * (1 + Math.min(4, Math.floor(combo / 10)));

// ── LOOKS ───────────────────────────────────────────────────────────────────
const LOOKS = { bg: '#0f0a1e', lane: '#1e1b4b', line: '#f8fafc', notes: ['#f43f5e', '#f59e0b', '#22c55e', '#38bdf8'], h: 420, w: 300 };

// ── THE SCREEN ──────────────────────────────────────────────────────────────
export default function App() {
  const [lang, setLang] = useState<Lang>('en');
  const [phase, setPhase] = useState<'menu' | 'play' | 'over'>('menu');
  const [song, setSong] = useState(Object.keys(SONGS)[0]);
  const [hud, setHud] = useState({ score: 0, combo: 0, last: '' });
  const [best, setBest] = useState(0);
  const [acc, setAcc] = useState(0);
  const t = COPY[lang];
  const canvas = useRef<HTMLCanvasElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const game = useRef({ notes: [] as Note[], start: 0, score: 0, combo: 0, flash: [0, 0, 0, 0], last: '' });

  useEffect(() => {
    try { const n = parseInt(localStorage.getItem(BEST) || '', 10); if (Number.isFinite(n)) setBest(n); } catch { /* ignore */ }
  }, []);

  const now = () => (audio.current ? audio.current.currentTime - game.current.start - OPTIONS.offsetMs / 1000 : 0);

  function tone(freq: number, at: number, len = 0.12, vol = 0.05) {
    const ctx = audio.current; if (!ctx) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'triangle'; osc.frequency.value = freq; gain.gain.setValueAtTime(vol, at); gain.gain.exponentialRampToValueAtTime(0.001, at + len);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(at); osc.stop(at + len);
  }

  function start() {
    try { audio.current = audio.current || new AudioContext(); } catch { audio.current = null; }
    const ctx = audio.current, notes = chartFor(song), s = SONGS[song];
    game.current = { notes, start: ctx ? ctx.currentTime + 0.1 : 0, score: 0, combo: 0, flash: [0, 0, 0, 0], last: '' };
    if (ctx) {                                                         // the backing beat and the melody, scheduled on the audio clock
      const end = notes[notes.length - 1].time + 1;
      for (let b = 0; b * (60 / s.bpm) < end; b++) tone(b % 4 ? 90 : 60, game.current.start + 1 + b * (60 / s.bpm), 0.15, 0.08);
      for (const n of notes) tone(s.tones[n.lane], game.current.start + n.time, 0.1, 0.02);
    }
    setHud({ score: 0, combo: 0, last: '' }); setPhase('play');
  }

  function tap(lane: number) {
    if (phase !== 'play') return;
    const g = game.current, time = now(), note = noteFor(g.notes, lane, time);
    g.flash[lane] = 0.15;
    if (!note) return;
    const delta = (time - note.time) * 1000, hit = judge(delta);
    note.hit = hit; g.combo = hit === 'miss' ? 0 : g.combo + 1; g.score += pointsFor(hit, g.combo);
    g.last = COPY[lang][hit] + (hit === 'perfect' ? '' : ' (' + (delta < 0 ? COPY[lang].early : COPY[lang].late) + ')');
  }

  useEffect(() => {
    if (phase !== 'play') return;
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let raf = 0, prev = performance.now();
    const laneW = LOOKS.w / 4, lineY = LOOKS.h - 60;
    const step = (ms: number) => {
      const g = game.current, time = now(), dt = (ms - prev) / 1000; prev = ms;
      for (const n of g.notes) if (!n.hit && time - n.time > OPTIONS.goodMs / 1000) { n.hit = 'miss'; g.combo = 0; g.last = COPY[lang].miss; }
      ctx.fillStyle = LOOKS.bg; ctx.fillRect(0, 0, LOOKS.w, LOOKS.h);
      for (let l = 0; l < 4; l++) {
        g.flash[l] = Math.max(0, g.flash[l] - dt);
        ctx.fillStyle = g.flash[l] > 0 ? LOOKS.notes[l] + '55' : LOOKS.lane; ctx.fillRect(l * laneW + 2, 0, laneW - 4, LOOKS.h);
      }
      ctx.fillStyle = LOOKS.line; ctx.fillRect(0, lineY - 2, LOOKS.w, 4);
      for (const n of g.notes) {
        const ahead = n.time - time;
        if (n.hit || ahead > OPTIONS.lookAhead || ahead < -0.2) continue;
        const y = lineY - (ahead / OPTIONS.lookAhead) * lineY;
        ctx.fillStyle = LOOKS.notes[n.lane]; ctx.fillRect(n.lane * laneW + 8, y - 8, laneW - 16, 16);
      }
      setHud({ score: g.score, combo: g.combo, last: g.last });
      if (g.notes.every((n) => n.hit)) {
        const a = accuracy(g.notes); setAcc(a); setPhase('over');
        setBest((b) => { const n = Math.max(b, g.score); try { localStorage.setItem(BEST, String(n)); } catch { /* ignore */ } return n; });
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const l = OPTIONS.keys.indexOf(e.key.toLowerCase()); if (l >= 0 && !e.repeat) tap(l); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{TITLE}</h1>
        <ThemeToggle />
      </div>
      <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <span className="badge">{t.score} {hud.score}</span>
        <span className="badge">{t.best} {best}</span>
        <span className="badge">{t.combo} {hud.combo}</span>
        <button className="badge" onClick={() => setLang(lang === 'en' ? 'hi' : 'en')}>{t.lang}</button>
      </div>
      {phase !== 'play' && (
        <div className="card" style={{ padding: 16, marginBottom: 10 }}>
          {phase === 'over' && <p>{t.over} — {t.accuracy} {Math.round(acc * 100)}% · {t.grade} {gradeFor(acc)}</p>}
          <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span>{t.level}:</span>
            {Object.keys(SONGS).map((k) => <button key={k} className="badge" onClick={() => setSong(k)}
              style={{ outline: k === song ? '2px solid ' + ACCENT : 'none' }}>{SONGS[k][lang]} · {SONGS[k].bpm}</button>)}
          </div>
          <button className="primary" onClick={start}>{phase === 'over' ? t.again : t.play}</button>
        </div>
      )}
      {phase === 'play' && <p style={{ textAlign: 'center', minHeight: 20, margin: 4 }}>{hud.last}</p>}
      <canvas ref={canvas} width={LOOKS.w} height={LOOKS.h} style={{ width: '100%', borderRadius: 12, touchAction: 'none' }}
        onPointerDown={(e) => { const b = e.currentTarget.getBoundingClientRect(); tap(Math.min(3, Math.floor(((e.clientX - b.left) / b.width) * 4))); }} />
    </div>
  );
}
`;
