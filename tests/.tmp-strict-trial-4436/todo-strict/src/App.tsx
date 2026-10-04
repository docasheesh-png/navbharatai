import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

interface Todo { id: string; text: string; done: boolean; category: string; }
type Filter = 'all' | 'active' | 'done';

const CATEGORIES = ['Personal', 'Work', 'Shopping', 'Other'];
const STORE_KEY = 'todos-v1';

function load(): Todo[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Todo[]) : [];
  } catch { return []; }
}

function App() {
  const [todos, setTodos] = useState<Todo[]>(load);
  const [text, setText] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [filter, setFilter] = useState<Filter>('all');
  const [catFilter, setCatFilter] = useState('All');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(todos)); } catch { /* storage blocked — todos last this visit */ } }, [todos]);

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setTodos([{ id: String(Date.now()), text: t, done: false, category }, ...todos]);
    setText('');
  };
  const toggle = (id: string) => setTodos(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => setTodos(todos.filter((t) => t.id !== id));
  const saveEdit = (id: string) => {
    const t = editText.trim();
    if (t) setTodos(todos.map((x) => (x.id === id ? { ...x, text: t } : x)));
    setEditingId(null);
  };

  const visible = useMemo(
    () => todos
      .filter((t) => (filter === 'all' ? true : filter === 'done' ? t.done : !t.done))
      .filter((t) => (catFilter === 'All' ? true : t.category === catFilter)),
    [todos, filter, catFilter],
  );
  const remaining = todos.filter((t) => !t.done).length;

  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 32, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>To-do</h1>
        <ThemeToggle />
      </div>
      <div className="card stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 160 }}
            value={text}
            aria-label="What needs doing?"
            placeholder="What needs doing?"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="primary" onClick={add}>Add</button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {(['all', 'active', 'done'] as Filter[]).map((f) => (
            <button
              key={f}
              className={filter === f ? 'primary' : ''}
              onClick={() => setFilter(f)}
              style={{ padding: '5px 12px', textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
          <select aria-label="Filter by category" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ marginLeft: 'auto' }}>
            {['All', ...CATEGORIES].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {visible.length === 0 && (
          <p className="muted" style={{ textAlign: 'center', margin: '12px 0' }}>Nothing here yet — add your first task!</p>
        )}
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map((t) => (
            <li key={t.id} className="row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
              <input type="checkbox" aria-label="Mark task done" checked={t.done} onChange={() => toggle(t.id)} style={{ width: 18, height: 18 }} />
              {editingId === t.id ? (
                <input
                  autoFocus
                  aria-label="Edit task"
                  style={{ flex: 1 }}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(t.id); }}
                  onBlur={() => saveEdit(t.id)}
                />
              ) : (
                <span
                  style={{ flex: 1, textDecoration: t.done ? 'line-through' : 'none', opacity: t.done ? 0.55 : 1 }}
                  onDoubleClick={() => { setEditingId(t.id); setEditText(t.text); }}
                >
                  {t.text} <span className="badge" style={{ marginLeft: 6 }}>{t.category}</span>
                </span>
              )}
              <button className="btn-ghost" onClick={() => { setEditingId(t.id); setEditText(t.text); }} aria-label="Edit">Edit</button>
              <button className="btn-ghost" onClick={() => remove(t.id)} aria-label="Delete" style={{ color: 'var(--danger)' }}>Delete</button>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>{remaining} task(s) remaining · saved on this device</p>
      </div>
    </div>
  );
}
export default App;
