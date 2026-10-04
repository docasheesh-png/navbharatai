import { useEffect, useMemo, useState } from 'react';
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

  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(notes)); } catch { /* storage blocked — notes last this visit */ } }, [notes]);

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
            aria-label="New note"
            value={text}
            placeholder="Jot something down..."
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button className="primary" onClick={add}>Add</button>
        </div>
        <input aria-label="Search notes" value={query} placeholder="Search notes" onChange={(e) => setQuery(e.target.value)} />
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
