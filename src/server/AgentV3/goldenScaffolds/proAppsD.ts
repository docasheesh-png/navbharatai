// AgentV3 — Golden Scaffolds: PRO-tier apps, batch D (notes, expense tracker, fitness, portfolio).
//
// The PERSONAL pro chips. Same contract as the earlier batches: a real working app on the shared pro
// foundation (proShell.ts), never a mockup. See proShell.ts for why pro scaffolds ship an architecture.

export const notesAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, Badge, Button, Field, Empty } from './lib/ui';
import { useCollection, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface Note extends Entity { title: string; body: string; folder: string; pinned: boolean; updated: string }

const SEED: Note[] = [
  { id: 'n1', title: 'Shopping list', body: 'Atta, dal, haldi, mustard oil.', folder: 'Personal', pinned: true, updated: '2026-08-03' },
  { id: 'n2', title: 'Client call notes', body: 'They want the launch by Diwali. Send a quote on Monday.', folder: 'Work', pinned: false, updated: '2026-08-02' },
  { id: 'n3', title: 'Book ideas', body: 'A history of the Grand Trunk Road.', folder: 'Personal', pinned: false, updated: '2026-07-30' },
];

export default function App() {
  const notes = useCollection<Note>('notes.all', SEED);
  const [folder, setFolder] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(SEED[0].id);

  const folders = useMemo(
    () => Array.from(new Set(notes.items.map((n) => n.folder).filter(Boolean))).sort(),
    [notes.items],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.items
      .filter((n) => (folder === 'all' || n.folder === folder) && (!q || (n.title + ' ' + n.body).toLowerCase().includes(q)))
      // Pinned first, then most recently edited — the order a note-taker actually wants.
      .sort((a, b) => (a.pinned === b.pinned ? b.updated.localeCompare(a.updated) : a.pinned ? -1 : 1));
  }, [notes.items, folder, query]);

  const open = openId ? notes.items.find((n) => n.id === openId) || null : null;

  function create() {
    const made = notes.add({ title: 'Untitled', body: '', folder: folder === 'all' ? 'Personal' : folder, pinned: false, updated: new Date().toISOString().slice(0, 10) });
    setOpenId(made.id);
  }

  function edit(patch: Partial<Note>) {
    if (!open) return;
    notes.update(open.id, { ...patch, updated: new Date().toISOString().slice(0, 10) });
  }

  return (
    <Shell
      brand="Notes"
      nav={[{ id: 'all', label: 'All notes' }, ...folders.map((f) => ({ id: f, label: f }))]}
      active={folder}
      onNavigate={setFolder}
      actions={<ThemeToggle />}
    >
      <Card actions={<Button onClick={create}>New note</Button>} title="Search">
        <Field label="Find a note" value={query} onChange={setQuery} placeholder="Title or text" />
      </Card>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(220px,1fr) 2fr' }} className="nb-notes">
        <Card title={visible.length + ' note' + (visible.length === 1 ? '' : 's')}>
          {visible.length === 0 ? (
            <Empty>Nothing matches.</Empty>
          ) : visible.map((n) => (
            <button
              key={n.id}
              onClick={() => setOpenId(n.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: 10, marginBottom: 6,
                borderRadius: 8, cursor: 'pointer', color: 'var(--fg)',
                border: '1px solid ' + (n.id === openId ? 'var(--accent)' : 'var(--border)'),
                background: n.id === openId ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                {n.pinned && <span title="Pinned">📌</span>}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title || 'Untitled'}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{n.folder} · {shortDate(n.updated)}</div>
            </button>
          ))}
        </Card>

        <Card>
          {!open ? (
            <Empty>Pick a note, or create one.</Empty>
          ) : (
            <>
              <Field label="Title" value={open.title} onChange={(v) => edit({ title: v })} />
              <Field label="Folder" value={open.folder} onChange={(v) => edit({ folder: v })} />
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Note</span>
                <textarea
                  value={open.body}
                  onChange={(e) => edit({ body: e.target.value })}
                  rows={12}
                  style={{ width: '100%', padding: '10px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Button variant="ghost" onClick={() => edit({ pinned: !open.pinned })}>{open.pinned ? 'Unpin' : 'Pin'}</Button>
                <Badge>saved {shortDate(open.updated)}</Badge>
                <span style={{ flex: 1 }} />
                <Button variant="danger" onClick={() => { notes.remove(open.id); setOpenId(null); }}>Delete</Button>
              </div>
            </>
          )}
        </Card>
      </div>
      <style>{'@media(max-width:760px){.nb-notes{grid-template-columns:1fr!important}}'}</style>
    </Shell>
  );
}
`;

export const expenseAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Empty } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

type Kind = 'expense' | 'income';
interface Entry extends Entity { label: string; amount: number; category: string; kind: Kind; on: string }

const CATEGORIES = ['Food', 'Travel', 'Rent', 'Bills', 'Shopping', 'Health', 'Other'];

const SEED: Entry[] = [
  { id: 'e1', label: 'Salary', amount: 60000, category: 'Other', kind: 'income', on: '2026-08-01' },
  { id: 'e2', label: 'Groceries', amount: 3200, category: 'Food', kind: 'expense', on: '2026-08-02' },
  { id: 'e3', label: 'Auto fare', amount: 240, category: 'Travel', kind: 'expense', on: '2026-08-03' },
  { id: 'e4', label: 'Electricity bill', amount: 1850, category: 'Bills', kind: 'expense', on: '2026-08-03' },
];

export default function App() {
  const entries = useCollection<Entry>('expense.entries', SEED);
  const [screen, setScreen] = useState('summary');
  const [form, setForm] = useState({ label: '', amount: '', category: 'Food', kind: 'expense' });
  const [filter, setFilter] = useState('all');

  const income = entries.items.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const spent = entries.items.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const balance = income - spent;

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries.items) {
      if (e.kind !== 'expense') continue;
      map.set(e.category, (map.get(e.category) || 0) + e.amount);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries.items]);

  const visible = useMemo(
    () => entries.items.filter((e) => filter === 'all' || e.category === filter),
    [entries.items, filter],
  );

  function add() {
    const amount = Number(form.amount);
    if (!form.label.trim() || !amount) return;
    entries.add({
      label: form.label.trim(), amount, category: form.category,
      kind: form.kind as Kind, on: new Date().toISOString().slice(0, 10),
    });
    setForm({ label: '', amount: '', category: form.category, kind: form.kind });
  }

  return (
    <Shell
      brand="Kharcha"
      nav={[{ id: 'summary', label: 'Summary' }, { id: 'entries', label: 'All entries' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      <StatRow>
        <StatTile label="Balance" value={inr(balance)} hint={balance >= 0 ? 'in hand' : 'over budget'} />
        <StatTile label="Income" value={inr(income)} />
        <StatTile label="Spent" value={inr(spent)} />
      </StatRow>

      <Card title="Add an entry">
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
          <Field label="What was it?" value={form.label} onChange={(v) => setForm({ ...form, label: v })} placeholder="Groceries" />
          <Field label="Amount (₹)" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} type="number" />
          <Select label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
          <Select
            label="Type"
            value={form.kind}
            onChange={(v) => setForm({ ...form, kind: v })}
            options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]}
          />
        </div>
        <Button onClick={add}>Add</Button>
      </Card>

      {screen === 'summary' && (
        <Card title="Where the money went">
          {byCategory.length === 0 ? (
            <Empty>No spending recorded yet.</Empty>
          ) : byCategory.map(([cat, amount]) => (
            <div key={cat} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', fontSize: 13, marginBottom: 4 }}>
                <span style={{ flex: 1 }}>{cat}</span>
                <strong>{inr(amount)}</strong>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--accent-soft)', overflow: 'hidden' }}>
                <div style={{ width: Math.round((amount / Math.max(1, spent)) * 100) + '%', height: '100%', background: 'var(--accent)' }} />
              </div>
            </div>
          ))}
        </Card>
      )}

      {screen === 'entries' && (
        <Card title={'Entries (' + visible.length + ')'}>
          <Select
            label="Category"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'All categories' }, ...CATEGORIES.map((c) => ({ value: c, label: c }))]}
          />
          {visible.length === 0 ? (
            <Empty>Nothing to show.</Empty>
          ) : visible.map((e) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{e.label}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.category} · {shortDate(e.on)}</div>
              </div>
              <Badge tone={e.kind === 'income' ? 'good' : 'neutral'}>
                {e.kind === 'income' ? '+' : '−'}{inr(e.amount)}
              </Badge>
              <Button variant="ghost" onClick={() => entries.remove(e.id)}>Remove</Button>
            </div>
          ))}
        </Card>
      )}
    </Shell>
  );
}
`;

export const fitnessAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Empty } from './lib/ui';
import { useCollection, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface Workout extends Entity { exercise: string; sets: number; reps: number; weight: number; on: string }
interface Goal extends Entity { label: string; target: number; unit: string }

const EXERCISES = ['Squat', 'Bench press', 'Deadlift', 'Overhead press', 'Pull-up', 'Running (km)'];

const SEED_WORKOUTS: Workout[] = [
  { id: 'w1', exercise: 'Squat', sets: 3, reps: 8, weight: 60, on: '2026-08-01' },
  { id: 'w2', exercise: 'Bench press', sets: 3, reps: 8, weight: 40, on: '2026-08-01' },
  { id: 'w3', exercise: 'Squat', sets: 3, reps: 8, weight: 65, on: '2026-08-03' },
];

const SEED_GOALS: Goal[] = [
  { id: 'g1', label: 'Squat', target: 100, unit: 'kg' },
];

export default function App() {
  const workouts = useCollection<Workout>('fit.workouts', SEED_WORKOUTS);
  const goals = useCollection<Goal>('fit.goals', SEED_GOALS);
  const [screen, setScreen] = useState('log');
  const [form, setForm] = useState({ exercise: EXERCISES[0], sets: '3', reps: '8', weight: '' });

  /** Total weight moved = sets × reps × weight. The number that actually tracks progress. */
  const volume = (w: Workout) => w.sets * w.reps * w.weight;

  const best = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of workouts.items) map.set(w.exercise, Math.max(map.get(w.exercise) || 0, w.weight));
    return map;
  }, [workouts.items]);

  const history = useMemo(
    () => [...workouts.items].sort((a, b) => b.on.localeCompare(a.on)),
    [workouts.items],
  );

  const totalVolume = workouts.items.reduce((s, w) => s + volume(w), 0);
  const sessions = new Set(workouts.items.map((w) => w.on)).size;

  function log() {
    const weight = Number(form.weight);
    if (!form.exercise || !weight) return;
    workouts.add({
      exercise: form.exercise, sets: Number(form.sets) || 1, reps: Number(form.reps) || 1,
      weight, on: new Date().toISOString().slice(0, 10),
    });
    setForm({ ...form, weight: '' });
  }

  return (
    <Shell
      brand="Fitness"
      nav={[{ id: 'log', label: 'Log' }, { id: 'progress', label: 'Progress' }, { id: 'goals', label: 'Goals' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      <StatRow>
        <StatTile label="Sessions" value={String(sessions)} hint="days trained" />
        <StatTile label="Total volume" value={Math.round(totalVolume).toLocaleString('en-IN') + ' kg'} />
        <StatTile label="Exercises" value={String(best.size)} hint="tracked" />
      </StatRow>

      {screen === 'log' && (
        <>
          <Card title="Log a set">
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
              <Select label="Exercise" value={form.exercise} onChange={(v) => setForm({ ...form, exercise: v })} options={EXERCISES.map((e) => ({ value: e, label: e }))} />
              <Field label="Sets" value={form.sets} onChange={(v) => setForm({ ...form, sets: v })} type="number" />
              <Field label="Reps" value={form.reps} onChange={(v) => setForm({ ...form, reps: v })} type="number" />
              <Field label="Weight (kg)" value={form.weight} onChange={(v) => setForm({ ...form, weight: v })} type="number" />
            </div>
            <Button onClick={log}>Save</Button>
          </Card>
          <Card title={'History (' + history.length + ')'}>
            {history.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : history.map((w) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{w.exercise}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{w.sets} × {w.reps} @ {w.weight} kg · {shortDate(w.on)}</div>
                </div>
                <Badge>{Math.round(volume(w))} kg</Badge>
                <Button variant="ghost" onClick={() => workouts.remove(w.id)}>Remove</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      {screen === 'progress' && (
        <Card title="Personal bests">
          {best.size === 0 ? (
            <Empty>Log a workout to see progress.</Empty>
          ) : Array.from(best.entries()).map(([exercise, weight]) => (
            <div key={exercise} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{exercise}</span>
              <strong>{weight} kg</strong>
            </div>
          ))}
        </Card>
      )}

      {screen === 'goals' && (
        <Card title="Goals">
          {goals.items.length === 0 ? (
            <Empty>No goals set.</Empty>
          ) : goals.items.map((g) => {
            const now = best.get(g.label) || 0;
            const pct = Math.min(100, Math.round((now / Math.max(1, g.target)) * 100));
            return (
              <div key={g.id} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ flex: 1 }}>{g.label}</span>
                  <strong>{now} / {g.target} {g.unit}</strong>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'var(--accent-soft)', overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)' }} />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </Shell>
  );
}
`;

export const portfolioAppTsx = `import { useState } from 'react';
import { Shell, Card, Badge, Button, Field, Modal, Empty } from './lib/ui';
import { useCollection, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface Project extends Entity { title: string; summary: string; tags: string; link: string }
interface Message extends Entity { name: string; email: string; text: string; at: string }

const SEED_PROJECTS: Project[] = [
  { id: 'p1', title: 'Village Market App', summary: 'A marketplace connecting farmers directly to buyers. Built in 6 weeks.', tags: 'React, Node, Payments', link: '' },
  { id: 'p2', title: 'Clinic Records', summary: 'Patient records and appointment booking for a two-doctor clinic.', tags: 'TypeScript, Offline-first', link: '' },
];

const SKILLS = ['React', 'TypeScript', 'Node.js', 'UI design', 'Databases', 'Mobile apps'];

export default function App() {
  const projects = useCollection<Project>('portfolio.projects', SEED_PROJECTS);
  const messages = useCollection<Message>('portfolio.messages', []);
  const [screen, setScreen] = useState('home');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', text: '' });
  const [sent, setSent] = useState(false);

  const open = openId ? projects.items.find((p) => p.id === openId) || null : null;

  function send() {
    if (!form.name.trim() || !form.text.trim()) return;
    messages.add({ name: form.name.trim(), email: form.email.trim(), text: form.text.trim(), at: new Date().toISOString().slice(0, 10) });
    setForm({ name: '', email: '', text: '' });
    setSent(true);
  }

  return (
    <Shell
      brand="Asha Verma"
      nav={[{ id: 'home', label: 'Home' }, { id: 'work', label: 'Work' }, { id: 'contact', label: 'Contact' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {screen === 'home' && (
        <>
          <Card>
            <h2 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 8px' }}>I build software that people actually use.</h2>
            <p style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 14px' }}>
              Product engineer in Jaipur. I take an idea from a sketch to something running in the world —
              usually in weeks, not months.
            </p>
            <Button onClick={() => setScreen('work')}>See my work</Button>
          </Card>
          <Card title="What I do">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {SKILLS.map((s) => <Badge key={s} tone="accent">{s}</Badge>)}
            </div>
          </Card>
        </>
      )}

      {screen === 'work' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
          {projects.items.length === 0 ? (
            <Empty>No projects yet.</Empty>
          ) : projects.items.map((p) => (
            <Card key={p.id}>
              <div style={{ height: 100, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 800, fontSize: 26, marginBottom: 10 }}>
                {p.title.slice(0, 1)}
              </div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{p.title}</div>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, margin: '6px 0 10px' }}>{p.summary}</p>
              <Button variant="ghost" onClick={() => setOpenId(p.id)}>Read more</Button>
            </Card>
          ))}
        </div>
      )}

      {screen === 'contact' && (
        <Card title="Get in touch">
          {sent ? (
            <>
              <p style={{ fontSize: 15, marginTop: 0 }}>Thanks — your message is saved. I will get back to you.</p>
              <Button variant="ghost" onClick={() => setSent(false)}>Send another</Button>
            </>
          ) : (
            <>
              <Field label="Your name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Message</span>
                <textarea
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  rows={5}
                  style={{ width: '100%', padding: '10px 11px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </label>
              <Button onClick={send}>Send message</Button>
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                Messages are stored in this browser. Connect an email service to have them delivered to your inbox.
              </p>
            </>
          )}
        </Card>
      )}

      {open && (
        <Modal title={open.title} onClose={() => setOpenId(null)}>
          <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>{open.summary}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {open.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
          {open.link && <a href={open.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: 14 }}>Visit the project →</a>}
        </Modal>
      )}
    </Shell>
  );
}
`;
