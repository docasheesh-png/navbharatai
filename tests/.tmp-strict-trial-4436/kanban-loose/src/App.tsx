import { useMemo, useState } from 'react';
import { Shell, Card, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

type ColumnId = 'todo' | 'doing' | 'review' | 'done';
type Priority = 'low' | 'normal' | 'high';
interface Task extends Entity {
  title: string; detail: string; column: ColumnId; assignee: string; priority: Priority; due: string;
}

const COLUMNS: Array<{ id: ColumnId; label: string }> = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

const PRIORITY_TONE: Record<Priority, 'neutral' | 'accent' | 'bad'> = { low: 'neutral', normal: 'accent', high: 'bad' };

const SEED: Task[] = [
  { id: 't1', title: 'Design the landing page', detail: 'Hero, features, pricing.', column: 'doing', assignee: 'Asha', priority: 'high', due: '2026-08-08' },
  { id: 't2', title: 'Set up payments', detail: 'Test mode first.', column: 'todo', assignee: 'Rohit', priority: 'normal', due: '2026-08-14' },
  { id: 't3', title: 'Write the launch email', detail: '', column: 'review', assignee: 'Meera', priority: 'low', due: '2026-08-10' },
];

export default function App() {
  const [screen, setScreen] = useState('board');
  const tasks = useCollection<Task>('board.tasks', SEED);
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', detail: '', assignee: '', priority: 'normal', due: '' });

  const people = useMemo(
    () => Array.from(new Set(tasks.items.map((t) => t.assignee).filter(Boolean))).sort(),
    [tasks.items],
  );

  const visible = useMemo(
    () => tasks.items.filter((t) => assigneeFilter === 'all' || t.assignee === assigneeFilter),
    [tasks.items, assigneeFilter],
  );

  const open = openId ? tasks.items.find((t) => t.id === openId) || null : null;

  function create() {
    if (!form.title.trim()) return;
    tasks.add({
      title: form.title.trim(), detail: form.detail.trim(), column: 'todo',
      assignee: form.assignee.trim(), priority: form.priority as Priority, due: form.due,
    });
    setForm({ title: '', detail: '', assignee: '', priority: 'normal', due: '' });
    setAdding(false);
  }

  function move(t: Task, dir: -1 | 1) {
    const i = COLUMNS.findIndex((c) => c.id === t.column);
    const next = COLUMNS[Math.min(COLUMNS.length - 1, Math.max(0, i + dir))];
    tasks.update(t.id, { column: next.id });
  }

  return (
    <Shell
      brand="Board"
      nav={[{ id: 'board', label: 'Board' }, { id: 'list', label: 'All tasks' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      <Card actions={<Button onClick={() => setAdding(true)}>New task</Button>} title="Filter">
        <Select
          label="Assignee"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[{ value: 'all', label: 'Everyone' }, ...people.map((p) => ({ value: p, label: p }))]}
        />
      </Card>

      {screen === 'board' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          {COLUMNS.map((col) => {
            const inCol = visible.filter((t) => t.column === col.id);
            return (
              <Card key={col.id} title={col.label + ' (' + inCol.length + ')'}>
                {inCol.length === 0 ? (
                  <Empty>Nothing here.</Empty>
                ) : inCol.map((t) => (
                  <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                    <button
                      onClick={() => setOpenId(t.id)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--fg)', textAlign: 'left', fontWeight: 700, fontSize: 14 }}
                    >
                      {t.title}
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0' }}>
                      <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                      {t.assignee && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.assignee}</span>}
                    </div>
                    {t.due && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>due {shortDate(t.due)}</div>}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="ghost" onClick={() => move(t, -1)}>←</Button>
                      <Button variant="ghost" onClick={() => move(t, 1)}>→</Button>
                    </div>
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      {screen === 'list' && (
        <Card title={'All tasks (' + visible.length + ')'}>
          {visible.length === 0 ? (
            <Empty>No tasks match that filter.</Empty>
          ) : visible.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {COLUMNS.find((c) => c.id === t.column)?.label}
                  {t.assignee ? ' · ' + t.assignee : ''}{t.due ? ' · due ' + shortDate(t.due) : ''}
                </div>
              </div>
              <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
              <Button variant="ghost" onClick={() => setOpenId(t.id)}>Open</Button>
            </div>
          ))}
        </Card>
      )}

      {adding && (
        <Modal title="New task" onClose={() => setAdding(false)}>
          <Field label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <Field label="Details" value={form.detail} onChange={(v) => setForm({ ...form, detail: v })} />
          <Field label="Assignee" value={form.assignee} onChange={(v) => setForm({ ...form, assignee: v })} placeholder="Asha" />
          <Select
            label="Priority"
            value={form.priority}
            onChange={(v) => setForm({ ...form, priority: v })}
            options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]}
          />
          <Field label="Due date" value={form.due} onChange={(v) => setForm({ ...form, due: v })} type="date" />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={create}>Add task</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {open && (
        <Modal title={open.title} onClose={() => setOpenId(null)}>
          {open.detail && <p style={{ fontSize: 14, marginTop: 0 }}>{open.detail}</p>}
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            {COLUMNS.find((c) => c.id === open.column)?.label}
            {open.assignee ? ' · ' + open.assignee : ''}{open.due ? ' · due ' + shortDate(open.due) : ''}
          </p>
          <Select
            label="Move to"
            value={open.column}
            onChange={(v) => tasks.update(open.id, { column: v as ColumnId })}
            options={COLUMNS.map((c) => ({ value: c.id, label: c.label }))}
          />
          <Button variant="danger" onClick={() => { tasks.remove(open.id); setOpenId(null); }}>Delete task</Button>
        </Modal>
      )}
    </Shell>
  );
}
