// AgentV3 — Golden Scaffolds: PRO-tier apps, batch C (invoicing, bookings, project board).
//
// Same contract as proApps.ts / proAppsB.ts: a real working app on the shared pro foundation
// (proShell.ts), never a mockup. See proShell.ts for why pro scaffolds ship an architecture.
//
// These three are the most-asked BUSINESS apps after the showcase set, and two of them lean on the
// India-first edge deliberately: GST-correct invoicing and the salon/clinic booking shape are what a
// small Indian business actually needs, and getting them right out of the box is a moat a generic
// builder does not have.

export const invoicingAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, newId, type Entity } from './lib/store';
import ThemeToggle from './theme';

type Status = 'draft' | 'sent' | 'paid';
interface Item { id: string; description: string; qty: number; rate: number }
interface Client extends Entity { name: string; email: string; gstin: string }
interface Invoice extends Entity {
  number: string; clientId: string; items: Item[]; gstRate: number;
  issued: string; due: string; status: Status;
}

const SEED_CLIENTS: Client[] = [
  { id: 'c1', name: 'Sunrise Textiles', email: 'accounts@sunrise.in', gstin: '08AAACS1234F1Z5' },
  { id: 'c2', name: 'Coastal Foods', email: 'meera@coastal.in', gstin: '' },
];

const SEED_INVOICES: Invoice[] = [
  {
    id: 'i1', number: 'INV-001', clientId: 'c1', gstRate: 18,
    items: [{ id: 'x1', description: 'Website design', qty: 1, rate: 45000 }],
    issued: '2026-07-10', due: '2026-07-25', status: 'paid',
  },
  {
    id: 'i2', number: 'INV-002', clientId: 'c2', gstRate: 18,
    items: [{ id: 'x2', description: 'Monthly retainer', qty: 2, rate: 15000 }],
    issued: '2026-07-28', due: '2026-08-12', status: 'sent',
  },
];

const STATUS_TONE: Record<Status, 'neutral' | 'accent' | 'good'> = { draft: 'neutral', sent: 'accent', paid: 'good' };

function subtotalOf(inv: Invoice): number {
  return inv.items.reduce((s, it) => s + it.qty * it.rate, 0);
}
function taxOf(inv: Invoice): number {
  return Math.round(subtotalOf(inv) * (inv.gstRate / 100));
}
function totalOf(inv: Invoice): number {
  return subtotalOf(inv) + taxOf(inv);
}
/** Overdue = past its due date and still unpaid. Computed, never stored, so it can never go stale. */
function isOverdue(inv: Invoice): boolean {
  return inv.status !== 'paid' && new Date(inv.due).getTime() < Date.now();
}

export default function App() {
  const [screen, setScreen] = useState('invoices');
  const clients = useCollection<Client>('inv.clients', SEED_CLIENTS);
  const invoices = useCollection<Invoice>('inv.invoices', SEED_INVOICES);
  const [creating, setCreating] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [clientForm, setClientForm] = useState({ name: '', email: '', gstin: '' });
  const [form, setForm] = useState({ clientId: '', description: '', qty: '1', rate: '', gstRate: '18' });

  const nameOf = (id: string) => clients.items.find((c) => c.id === id)?.name || 'Unknown client';
  const outstanding = useMemo(
    () => invoices.items.filter((i) => i.status !== 'paid').reduce((s, i) => s + totalOf(i), 0),
    [invoices.items],
  );
  const collected = useMemo(
    () => invoices.items.filter((i) => i.status === 'paid').reduce((s, i) => s + totalOf(i), 0),
    [invoices.items],
  );
  const overdueCount = invoices.items.filter(isOverdue).length;
  const viewing = viewId ? invoices.items.find((i) => i.id === viewId) || null : null;

  function nextNumber(): string {
    const n = invoices.items.length + 1;
    return 'INV-' + String(n).padStart(3, '0');
  }

  function create() {
    if (!form.clientId || !form.description.trim()) return;
    const issued = new Date();
    const due = new Date(issued.getTime() + 15 * 24 * 60 * 60 * 1000);
    invoices.add({
      number: nextNumber(), clientId: form.clientId, gstRate: Number(form.gstRate) || 0,
      items: [{ id: newId(), description: form.description.trim(), qty: Number(form.qty) || 1, rate: Number(form.rate) || 0 }],
      issued: issued.toISOString().slice(0, 10), due: due.toISOString().slice(0, 10), status: 'draft',
    });
    setForm({ clientId: '', description: '', qty: '1', rate: '', gstRate: '18' });
    setCreating(false);
  }

  function createClient() {
    if (!clientForm.name.trim()) return;
    clients.add({ name: clientForm.name.trim(), email: clientForm.email.trim(), gstin: clientForm.gstin.trim() });
    setClientForm({ name: '', email: '', gstin: '' });
    setAddingClient(false);
  }

  return (
    <Shell
      brand="Ledger"
      nav={[{ id: 'invoices', label: 'Invoices' }, { id: 'clients', label: 'Clients' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      <StatRow>
        <StatTile label="Outstanding" value={inr(outstanding)} hint="unpaid invoices" />
        <StatTile label="Collected" value={inr(collected)} />
        <StatTile label="Overdue" value={String(overdueCount)} hint="past due date" />
      </StatRow>

      {screen === 'invoices' && (
        <Card
          title={'Invoices (' + invoices.items.length + ')'}
          actions={<Button onClick={() => setCreating(true)}>New invoice</Button>}
        >
          {invoices.items.length === 0 ? (
            <Empty>No invoices yet — create your first one.</Empty>
          ) : invoices.items.map((inv) => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{inv.number} · {nameOf(inv.clientId)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {inr(totalOf(inv))} · due {shortDate(inv.due)}
                </div>
              </div>
              {isOverdue(inv) && <Badge tone="bad">overdue</Badge>}
              <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
              <Button variant="ghost" onClick={() => setViewId(inv.id)}>View</Button>
            </div>
          ))}
        </Card>
      )}

      {screen === 'clients' && (
        <Card
          title={'Clients (' + clients.items.length + ')'}
          actions={<Button onClick={() => setAddingClient(true)}>Add client</Button>}
        >
          {clients.items.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {c.email || 'no email'}{c.gstin ? ' · GSTIN ' + c.gstin : ''}
                </div>
              </div>
              <Button variant="ghost" onClick={() => clients.remove(c.id)}>Remove</Button>
            </div>
          ))}
        </Card>
      )}

      {creating && (
        <Modal title="New invoice" onClose={() => setCreating(false)}>
          {clients.items.length === 0 ? (
            <Empty>Add a client first.</Empty>
          ) : (
            <>
              <Select
                label="Client"
                value={form.clientId}
                onChange={(v) => setForm({ ...form, clientId: v })}
                options={[{ value: '', label: 'Choose a client' }, ...clients.items.map((c) => ({ value: c.id, label: c.name }))]}
              />
              <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Website design" />
              <Field label="Quantity" value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} type="number" />
              <Field label="Rate (₹)" value={form.rate} onChange={(v) => setForm({ ...form, rate: v })} type="number" />
              <Select
                label="GST rate"
                value={form.gstRate}
                onChange={(v) => setForm({ ...form, gstRate: v })}
                options={[
                  { value: '0', label: '0% (exempt)' }, { value: '5', label: '5%' },
                  { value: '12', label: '12%' }, { value: '18', label: '18%' }, { value: '28', label: '28%' },
                ]}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <Button onClick={create}>Create</Button>
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </>
          )}
        </Modal>
      )}

      {viewing && (
        <Modal title={viewing.number} onClose={() => setViewId(null)}>
          <div style={{ fontSize: 14, marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>{nameOf(viewing.clientId)}</div>
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Issued {shortDate(viewing.issued)} · due {shortDate(viewing.due)}
            </div>
          </div>
          {viewing.items.map((it) => (
            <div key={it.id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ flex: 1 }}>{it.description}</span>
              <span style={{ color: 'var(--muted)' }}>{it.qty} × {inr(it.rate)}</span>
              <strong>{inr(it.qty * it.rate)}</strong>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 14 }}>
            <div style={{ display: 'flex' }}><span style={{ flex: 1, color: 'var(--muted)' }}>Subtotal</span><span>{inr(subtotalOf(viewing))}</span></div>
            <div style={{ display: 'flex' }}><span style={{ flex: 1, color: 'var(--muted)' }}>GST ({viewing.gstRate}%)</span><span>{inr(taxOf(viewing))}</span></div>
            <div style={{ display: 'flex', fontSize: 17, fontWeight: 800, marginTop: 6 }}><span style={{ flex: 1 }}>Total</span><span>{inr(totalOf(viewing))}</span></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {viewing.status === 'draft' && <Button onClick={() => invoices.update(viewing.id, { status: 'sent' })}>Mark sent</Button>}
            {viewing.status !== 'paid' && <Button onClick={() => invoices.update(viewing.id, { status: 'paid' })}>Mark paid</Button>}
            <Button variant="ghost" onClick={() => window.print()}>Print / PDF</Button>
            <Button variant="danger" onClick={() => { invoices.remove(viewing.id); setViewId(null); }}>Delete</Button>
          </div>
        </Modal>
      )}

      {addingClient && (
        <Modal title="Add client" onClose={() => setAddingClient(false)}>
          <Field label="Business name" value={clientForm.name} onChange={(v) => setClientForm({ ...clientForm, name: v })} />
          <Field label="Email" value={clientForm.email} onChange={(v) => setClientForm({ ...clientForm, email: v })} type="email" />
          <Field label="GSTIN (optional)" value={clientForm.gstin} onChange={(v) => setClientForm({ ...clientForm, gstin: v })} placeholder="08AAACS1234F1Z5" />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={createClient}>Add</Button>
            <Button variant="ghost" onClick={() => setAddingClient(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
`;

export const bookingsAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

type Status = 'confirmed' | 'cancelled';
interface Service extends Entity { name: string; minutes: number; price: number }
interface Booking extends Entity {
  name: string; phone: string; serviceId: string; date: string; slot: string; status: Status;
}

const SLOTS = ['09:00', '10:00', '11:00', '12:00', '15:00', '16:00', '17:00', '18:00'];

const SEED_SERVICES: Service[] = [
  { id: 's1', name: 'Haircut', minutes: 30, price: 300 },
  { id: 's2', name: 'Hair colour', minutes: 90, price: 1800 },
  { id: 's3', name: 'Consultation', minutes: 45, price: 800 },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function App() {
  const [screen, setScreen] = useState('book');
  const services = useCollection<Service>('book.services', SEED_SERVICES);
  const bookings = useCollection<Booking>('book.bookings', []);
  const [date, setDate] = useState(today());
  const [serviceId, setServiceId] = useState(SEED_SERVICES[0].id);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const nameOfService = (id: string) => services.items.find((s) => s.id === id)?.name || 'Service';

  /** Slots already taken on the chosen day. A cancelled booking frees its slot again. */
  const taken = useMemo(
    () => new Set(bookings.items.filter((b) => b.date === date && b.status === 'confirmed').map((b) => b.slot)),
    [bookings.items, date],
  );

  const upcoming = useMemo(
    () => bookings.items
      .filter((b) => b.status === 'confirmed' && b.date >= today())
      .sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot)),
    [bookings.items],
  );

  function confirm() {
    if (!slot || !name.trim() || !phone.trim()) return;
    if (taken.has(slot)) return; // double-booking guard: the slot was taken while this form was open
    bookings.add({ name: name.trim(), phone: phone.trim(), serviceId, date, slot, status: 'confirmed' });
    setName(''); setPhone(''); setSlot(null);
    setScreen('upcoming');
  }

  return (
    <Shell
      brand="Appointments"
      nav={[
        { id: 'book', label: 'Book' },
        { id: 'upcoming', label: 'Upcoming (' + upcoming.length + ')' },
        { id: 'services', label: 'Services' },
      ]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {screen === 'book' && (
        <>
          <Card title="Pick a day and time">
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
              <Field label="Date" value={date} onChange={(v) => { setDate(v); setSlot(null); }} type="date" />
              <Select
                label="Service"
                value={serviceId}
                onChange={setServiceId}
                options={services.items.map((s) => ({ value: s.id, label: s.name + ' · ' + s.minutes + ' min' }))}
              />
            </div>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(88px,1fr))', marginTop: 8 }}>
              {SLOTS.map((s) => {
                const busy = taken.has(s);
                return (
                  <button
                    key={s}
                    disabled={busy}
                    onClick={() => setSlot(s)}
                    style={{
                      padding: '10px 6px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                      cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.45 : 1,
                      border: '1px solid ' + (slot === s ? 'var(--accent)' : 'var(--border)'),
                      background: slot === s ? 'var(--accent-soft)' : 'var(--bg)',
                      color: slot === s ? 'var(--accent)' : 'var(--fg)',
                    }}
                  >
                    {s}{busy ? ' ·' : ''}
                  </button>
                );
              })}
            </div>
          </Card>

          {slot && (
            <Card title={'Confirm ' + slot + ' on ' + shortDate(date)}>
              <Field label="Your name" value={name} onChange={setName} />
              <Field label="Phone" value={phone} onChange={setPhone} type="tel" placeholder="98765 43210" />
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                Free cancellation up to 2 hours before your appointment.
              </p>
              <Button onClick={confirm}>Confirm booking</Button>
            </Card>
          )}
        </>
      )}

      {screen === 'upcoming' && (
        <>
          <StatRow>
            <StatTile label="Upcoming" value={String(upcoming.length)} />
            <StatTile label="Cancelled" value={String(bookings.items.filter((b) => b.status === 'cancelled').length)} />
            <StatTile label="Total booked" value={String(bookings.items.length)} />
          </StatRow>
          <Card title="Upcoming appointments">
            {upcoming.length === 0 ? (
              <Empty>Nothing booked yet.</Empty>
            ) : upcoming.map((b) => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{b.name} · {nameOfService(b.serviceId)}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(b.date)} at {b.slot} · {b.phone}</div>
                </div>
                <Badge tone="good">confirmed</Badge>
                <Button variant="ghost" onClick={() => bookings.update(b.id, { status: 'cancelled' })}>Cancel</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      {screen === 'services' && (
        <Card title="Services offered">
          {services.items.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.minutes} minutes · ₹{s.price}</div>
              </div>
              <Button variant="ghost" onClick={() => services.remove(s.id)}>Remove</Button>
            </div>
          ))}
        </Card>
      )}
    </Shell>
  );
}
`;

export const kanbanAppTsx = `import { useMemo, useState } from 'react';
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
`;
