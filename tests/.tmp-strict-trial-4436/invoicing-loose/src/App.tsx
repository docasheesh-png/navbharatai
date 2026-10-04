import { useMemo, useState } from 'react';
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
