import { useCallback, useEffect, useMemo, useState } from 'react';
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
