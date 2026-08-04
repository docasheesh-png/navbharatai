// AgentV3 — Golden Scaffolds: the PRO-tier apps.
//
// Each is a REAL working app on the shared pro foundation (proShell.ts), not a mockup: every screen has
// working state, every button does what it says, and data survives a reload. That is the point — a pro
// build now starts from something that already runs, so the builder spends its turns EXTENDING a working
// app instead of trying to produce one from nothing and white-screening on the way.
//
// Each app deliberately stays inside the shared visual language and the `useCollection` hook, so the
// builder extending it has an obvious pattern to follow rather than inventing a second one alongside.

export const saasDashboardAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

type Role = 'owner' | 'admin' | 'member';
interface Member extends Entity { name: string; email: string; role: Role; joined: string }
interface Event extends Entity { label: string; value: number; at: string }

const SEED_MEMBERS: Member[] = [
  { id: 'm1', name: 'Asha Verma', email: 'asha@acme.in', role: 'owner', joined: '2026-01-12' },
  { id: 'm2', name: 'Rohit Nair', email: 'rohit@acme.in', role: 'admin', joined: '2026-03-04' },
  { id: 'm3', name: 'Priya Shah', email: 'priya@acme.in', role: 'member', joined: '2026-05-21' },
];

const SEED_EVENTS: Event[] = [
  { id: 'e1', label: 'Mon', value: 120, at: '2026-07-28' },
  { id: 'e2', label: 'Tue', value: 180, at: '2026-07-29' },
  { id: 'e3', label: 'Wed', value: 150, at: '2026-07-30' },
  { id: 'e4', label: 'Thu', value: 240, at: '2026-07-31' },
  { id: 'e5', label: 'Fri', value: 300, at: '2026-08-01' },
];

const PLANS = [
  { id: 'starter', name: 'Starter', price: 999, seats: 3 },
  { id: 'growth', name: 'Growth', price: 2999, seats: 10 },
  { id: 'scale', name: 'Scale', price: 7999, seats: 50 },
];

const ROLE_TONE: Record<Role, 'accent' | 'good' | 'neutral'> = { owner: 'accent', admin: 'good', member: 'neutral' };

export default function App() {
  const [screen, setScreen] = useState('overview');
  const members = useCollection<Member>('saas.members', SEED_MEMBERS);
  const events = useCollection<Event>('saas.events', SEED_EVENTS);
  const [planId, setPlanId] = useState(() => localStorage.getItem('saas.plan') || 'growth');
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');

  const plan = PLANS.find((p) => p.id === planId) || PLANS[1];
  const peak = useMemo(() => Math.max(1, ...events.items.map((e) => e.value)), [events.items]);
  const total = useMemo(() => events.items.reduce((s, e) => s + e.value, 0), [events.items]);

  function invite() {
    if (!name.trim() || !email.trim()) return;
    members.add({ name: name.trim(), email: email.trim(), role, joined: new Date().toISOString().slice(0, 10) });
    setName(''); setEmail(''); setRole('member'); setInviting(false);
  }

  function choosePlan(id: string) {
    setPlanId(id);
    try { localStorage.setItem('saas.plan', id); } catch { /* private mode — the choice just is not remembered */ }
  }

  return (
    <Shell
      brand="Acme Cloud"
      nav={[
        { id: 'overview', label: 'Overview' },
        { id: 'team', label: 'Team' },
        { id: 'billing', label: 'Billing' },
        { id: 'settings', label: 'Settings' },
      ]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {screen === 'overview' && (
        <>
          <StatRow>
            <StatTile label="Active users" value={String(total)} hint="last 5 days" />
            <StatTile label="Team members" value={String(members.items.length)} hint={'of ' + plan.seats + ' seats'} />
            <StatTile label="Plan" value={plan.name} hint={inr(plan.price) + ' / month'} />
            <StatTile label="Peak day" value={String(peak)} hint="sessions" />
          </StatRow>
          <Card title="Activity">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160 }}>
              {events.items.map((e) => (
                <div key={e.id} style={{ flex: 1, textAlign: 'center' }}>
                  <div
                    title={e.value + ' sessions'}
                    style={{ height: Math.round((e.value / peak) * 130), background: 'var(--accent)', borderRadius: '6px 6px 0 0' }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{e.label}</div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {screen === 'team' && (
        <Card
          title={'Members (' + members.items.length + ')'}
          actions={<Button onClick={() => setInviting(true)}>Invite</Button>}
        >
          {members.items.length === 0 ? (
            <Empty>No members yet — invite your first teammate.</Empty>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.items.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.email} · joined {shortDate(m.joined)}</div>
                  </div>
                  <Badge tone={ROLE_TONE[m.role]}>{m.role}</Badge>
                  {m.role !== 'owner' && <Button variant="ghost" onClick={() => members.remove(m.id)}>Remove</Button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {screen === 'billing' && (
        <>
          <Card title="Your plan">
            <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 0 }}>
              You are on <strong style={{ color: 'var(--fg)' }}>{plan.name}</strong> — {inr(plan.price)} per month,
              up to {plan.seats} seats. {members.items.length} in use.
            </p>
          </Card>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            {PLANS.map((p) => (
              <Card key={p.id} style={{ borderColor: p.id === planId ? 'var(--accent)' : undefined }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</div>
                <div style={{ fontSize: 22, fontWeight: 800, margin: '6px 0' }}>{inr(p.price)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{p.seats} seats · all features</div>
                <Button variant={p.id === planId ? 'ghost' : 'primary'} onClick={() => choosePlan(p.id)}>
                  {p.id === planId ? 'Current plan' : 'Choose'}
                </Button>
              </Card>
            ))}
          </div>
        </>
      )}

      {screen === 'settings' && (
        <Card title="Workspace">
          <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 0 }}>
            Roles decide what a member can do: an <strong style={{ color: 'var(--fg)' }}>owner</strong> controls billing,
            an <strong style={{ color: 'var(--fg)' }}>admin</strong> manages the team, and a
            {' '}<strong style={{ color: 'var(--fg)' }}>member</strong> uses the product.
          </p>
        </Card>
      )}

      {inviting && (
        <Modal title="Invite a teammate" onClose={() => setInviting(false)}>
          <Field label="Name" value={name} onChange={setName} placeholder="Priya Shah" />
          <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="priya@acme.in" />
          <Select
            label="Role"
            value={role}
            onChange={(v) => setRole(v as Role)}
            options={[{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Admin' }]}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={invite}>Send invite</Button>
            <Button variant="ghost" onClick={() => setInviting(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
`;

export const crmAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, newId, type Entity } from './lib/store';
import ThemeToggle from './theme';

type Stage = 'lead' | 'qualified' | 'won' | 'lost';
interface Note { id: string; text: string; at: string }
interface Deal extends Entity {
  name: string; company: string; email: string; value: number; stage: Stage; created: string; notes: Note[];
}

const STAGES: Array<{ id: Stage; label: string }> = [
  { id: 'lead', label: 'Lead' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

const STAGE_TONE: Record<Stage, 'neutral' | 'accent' | 'good' | 'bad'> = {
  lead: 'neutral', qualified: 'accent', won: 'good', lost: 'bad',
};

const SEED: Deal[] = [
  { id: 'd1', name: 'Anil Kumar', company: 'Sunrise Textiles', email: 'anil@sunrise.in', value: 120000, stage: 'qualified', created: '2026-07-02', notes: [{ id: 'n1', text: 'Wants a demo next week.', at: '2026-07-04' }] },
  { id: 'd2', name: 'Meera Iyer', company: 'Coastal Foods', email: 'meera@coastal.in', value: 75000, stage: 'lead', created: '2026-07-18', notes: [] },
  { id: 'd3', name: 'Vikram Rao', company: 'Rao Logistics', email: 'vikram@raolog.in', value: 240000, stage: 'won', created: '2026-06-11', notes: [{ id: 'n2', text: 'Signed annual contract.', at: '2026-07-01' }] },
];

export default function App() {
  const [screen, setScreen] = useState('pipeline');
  const deals = useCollection<Deal>('crm.deals', SEED);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', email: '', value: '' });
  const [noteText, setNoteText] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deals.items.filter((d) => {
      if (stageFilter !== 'all' && d.stage !== stageFilter) return false;
      if (!q) return true;
      return (d.name + ' ' + d.company + ' ' + d.email).toLowerCase().includes(q);
    });
  }, [deals.items, query, stageFilter]);

  const open = openId ? deals.items.find((d) => d.id === openId) || null : null;
  const pipelineValue = deals.items.filter((d) => d.stage === 'lead' || d.stage === 'qualified').reduce((s, d) => s + d.value, 0);
  const wonValue = deals.items.filter((d) => d.stage === 'won').reduce((s, d) => s + d.value, 0);

  function create() {
    if (!form.name.trim() || !form.company.trim()) return;
    deals.add({
      name: form.name.trim(), company: form.company.trim(), email: form.email.trim(),
      value: Number(form.value) || 0, stage: 'lead', created: new Date().toISOString().slice(0, 10), notes: [],
    });
    setForm({ name: '', company: '', email: '', value: '' });
    setAdding(false);
  }

  function move(deal: Deal, dir: -1 | 1) {
    const i = STAGES.findIndex((s) => s.id === deal.stage);
    const next = STAGES[Math.min(STAGES.length - 1, Math.max(0, i + dir))];
    deals.update(deal.id, { stage: next.id });
  }

  function addNote() {
    if (!open || !noteText.trim()) return;
    const note: Note = { id: newId(), text: noteText.trim(), at: new Date().toISOString().slice(0, 10) };
    deals.update(open.id, { notes: [note, ...open.notes] });
    setNoteText('');
  }

  return (
    <Shell
      brand="Pipeline CRM"
      nav={[{ id: 'pipeline', label: 'Pipeline' }, { id: 'contacts', label: 'Contacts' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      <StatRow>
        <StatTile label="Open pipeline" value={inr(pipelineValue)} hint="lead + qualified" />
        <StatTile label="Won" value={inr(wonValue)} hint="closed deals" />
        <StatTile label="Deals" value={String(deals.items.length)} />
      </StatRow>

      <Card
        actions={<Button onClick={() => setAdding(true)}>New deal</Button>}
        title="Search"
      >
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
          <Field label="Find a contact or company" value={query} onChange={setQuery} placeholder="Name, company or email" />
          <Select
            label="Stage"
            value={stageFilter}
            onChange={setStageFilter}
            options={[{ value: 'all', label: 'All stages' }, ...STAGES.map((s) => ({ value: s.id, label: s.label }))]}
          />
        </div>
      </Card>

      {screen === 'pipeline' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          {STAGES.map((s) => {
            const inStage = visible.filter((d) => d.stage === s.id);
            return (
              <Card key={s.id} title={s.label + ' (' + inStage.length + ')'}>
                {inStage.length === 0 ? (
                  <Empty>Nothing here.</Empty>
                ) : inStage.map((d) => (
                  <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                    <button
                      onClick={() => setOpenId(d.id)}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--fg)', textAlign: 'left', fontWeight: 700, fontSize: 14 }}
                    >
                      {d.company}
                    </button>
                    <div style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 8px' }}>{d.name} · {inr(d.value)}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="ghost" onClick={() => move(d, -1)}>←</Button>
                      <Button variant="ghost" onClick={() => move(d, 1)}>→</Button>
                    </div>
                  </div>
                ))}
              </Card>
            );
          })}
        </div>
      )}

      {screen === 'contacts' && (
        <Card title={'Contacts (' + visible.length + ')'}>
          {visible.length === 0 ? (
            <Empty>No contacts match that search.</Empty>
          ) : visible.map((d) => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name} · {d.company}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.email || 'no email'} · added {shortDate(d.created)}</div>
              </div>
              <Badge tone={STAGE_TONE[d.stage]}>{d.stage}</Badge>
              <Button variant="ghost" onClick={() => setOpenId(d.id)}>Open</Button>
            </div>
          ))}
        </Card>
      )}

      {adding && (
        <Modal title="New deal" onClose={() => setAdding(false)}>
          <Field label="Contact name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Company" value={form.company} onChange={(v) => setForm({ ...form, company: v })} />
          <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
          <Field label="Deal value (₹)" value={form.value} onChange={(v) => setForm({ ...form, value: v })} type="number" />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={create}>Add deal</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {open && (
        <Modal title={open.company} onClose={() => setOpenId(null)}>
          <p style={{ fontSize: 14, marginTop: 0 }}>
            {open.name} · {open.email || 'no email'}<br />
            <strong>{inr(open.value)}</strong> · <Badge tone={STAGE_TONE[open.stage]}>{open.stage}</Badge>
          </p>
          <Field label="Add a note" value={noteText} onChange={setNoteText} placeholder="Called, following up Friday" />
          <Button onClick={addNote}>Save note</Button>
          <div style={{ marginTop: 14 }}>
            {open.notes.length === 0 ? (
              <Empty>No notes yet.</Empty>
            ) : open.notes.map((n) => (
              <div key={n.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
                <div style={{ fontSize: 13 }}>{n.text}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{shortDate(n.at)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <Button variant="danger" onClick={() => { deals.remove(open.id); setOpenId(null); }}>Delete deal</Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
`;

export const storeAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface Product extends Entity { name: string; category: string; price: number; stock: number }
interface Line { productId: string; name: string; price: number; qty: number }
interface Order extends Entity { lines: Line[]; total: number; placed: string; status: 'new' | 'shipped' }

const SEED_PRODUCTS: Product[] = [
  { id: 'p1', name: 'Cotton Kurta', category: 'Clothing', price: 1299, stock: 24 },
  { id: 'p2', name: 'Leather Sandals', category: 'Footwear', price: 1899, stock: 12 },
  { id: 'p3', name: 'Brass Diya Set', category: 'Home', price: 749, stock: 40 },
  { id: 'p4', name: 'Silk Scarf', category: 'Clothing', price: 999, stock: 8 },
  { id: 'p5', name: 'Clay Cookware', category: 'Home', price: 1599, stock: 6 },
];

export default function App() {
  const [screen, setScreen] = useState('shop');
  const products = useCollection<Product>('store.products', SEED_PRODUCTS);
  const orders = useCollection<Order>('store.orders', []);
  const [cart, setCart] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [checkingOut, setCheckingOut] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'Clothing', price: '', stock: '' });

  const categories = useMemo(
    () => Array.from(new Set(products.items.map((p) => p.category))).sort(),
    [products.items],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.items.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      return !q || p.name.toLowerCase().includes(q);
    });
  }, [products.items, query, category]);

  const cartTotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const revenue = orders.items.reduce((s, o) => s + o.total, 0);

  function addToCart(p: Product) {
    if (p.stock <= 0) return;
    setCart((c) => {
      const found = c.find((l) => l.productId === p.id);
      if (found) return c.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { productId: p.id, name: p.name, price: p.price, qty: 1 }];
    });
  }

  function setQty(productId: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.productId !== productId) : c.map((l) => (l.productId === productId ? { ...l, qty } : l))));
  }

  function placeOrder() {
    if (cart.length === 0) return;
    orders.add({ lines: cart, total: cartTotal, placed: new Date().toISOString().slice(0, 10), status: 'new' });
    // Stock is decremented for real — an "order" that leaves inventory untouched is a demo, not a store.
    for (const line of cart) {
      const p = products.items.find((x) => x.id === line.productId);
      if (p) products.update(p.id, { stock: Math.max(0, p.stock - line.qty) });
    }
    setCart([]);
    setCheckingOut(false);
    setScreen('orders');
  }

  function createProduct() {
    if (!form.name.trim()) return;
    products.add({
      name: form.name.trim(), category: form.category,
      price: Number(form.price) || 0, stock: Number(form.stock) || 0,
    });
    setForm({ name: '', category: 'Clothing', price: '', stock: '' });
    setAddingProduct(false);
  }

  return (
    <Shell
      brand="Bazaar"
      nav={[
        { id: 'shop', label: 'Shop' },
        { id: 'cart', label: 'Cart (' + cartCount + ')' },
        { id: 'orders', label: 'Orders' },
        { id: 'admin', label: 'Admin' },
      ]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {screen === 'shop' && (
        <>
          <Card title="Find something">
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
              <Field label="Search" value={query} onChange={setQuery} placeholder="Kurta, sandals…" />
              <Select
                label="Category"
                value={category}
                onChange={setCategory}
                options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
              />
            </div>
          </Card>
          {visible.length === 0 ? (
            <Empty>Nothing matches that search.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))' }}>
              {visible.map((p) => (
                <Card key={p.id}>
                  <div style={{ height: 90, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 800, marginBottom: 10 }}>
                    {p.name.slice(0, 1)}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 8px' }}>{p.category}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ flex: 1 }}>{inr(p.price)}</strong>
                    {p.stock > 0 ? <Badge tone="good">{p.stock} left</Badge> : <Badge tone="bad">Sold out</Badge>}
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <Button onClick={() => addToCart(p)}>{p.stock > 0 ? 'Add to cart' : 'Unavailable'}</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {screen === 'cart' && (
        <Card title={'Your cart (' + cartCount + ')'} actions={cart.length > 0 ? <Button onClick={() => setCheckingOut(true)}>Checkout</Button> : undefined}>
          {cart.length === 0 ? (
            <Empty>Your cart is empty.</Empty>
          ) : (
            <>
              {cart.map((l) => (
                <div key={l.productId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{inr(l.price)} each</div>
                  </div>
                  <Button variant="ghost" onClick={() => setQty(l.productId, l.qty - 1)}>−</Button>
                  <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{l.qty}</span>
                  <Button variant="ghost" onClick={() => setQty(l.productId, l.qty + 1)}>+</Button>
                  <strong style={{ minWidth: 74, textAlign: 'right' }}>{inr(l.price * l.qty)}</strong>
                </div>
              ))}
              <div style={{ display: 'flex', marginTop: 12, fontSize: 16, fontWeight: 800 }}>
                <span style={{ flex: 1 }}>Total</span>
                <span>{inr(cartTotal)}</span>
              </div>
            </>
          )}
        </Card>
      )}

      {screen === 'orders' && (
        <Card title={'Orders (' + orders.items.length + ')'}>
          {orders.items.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : orders.items.map((o) => (
            <div key={o.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{inr(o.total)}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {o.lines.length} item{o.lines.length === 1 ? '' : 's'} · {shortDate(o.placed)}
                  </div>
                </div>
                <Badge tone={o.status === 'shipped' ? 'good' : 'accent'}>{o.status}</Badge>
                {o.status === 'new' && <Button variant="ghost" onClick={() => orders.update(o.id, { status: 'shipped' })}>Mark shipped</Button>}
              </div>
            </div>
          ))}
        </Card>
      )}

      {screen === 'admin' && (
        <>
          <StatRow>
            <StatTile label="Revenue" value={inr(revenue)} hint={orders.items.length + ' orders'} />
            <StatTile label="Products" value={String(products.items.length)} />
            <StatTile label="Low stock" value={String(products.items.filter((p) => p.stock < 10).length)} hint="under 10 left" />
          </StatRow>
          <Card title="Products" actions={<Button onClick={() => setAddingProduct(true)}>Add product</Button>}>
            {products.items.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.category} · {inr(p.price)}</div>
                </div>
                <Badge tone={p.stock < 10 ? 'warn' : 'neutral'}>{p.stock} in stock</Badge>
                <Button variant="ghost" onClick={() => products.remove(p.id)}>Remove</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      {checkingOut && (
        <Modal title="Checkout" onClose={() => setCheckingOut(false)}>
          <p style={{ fontSize: 14, marginTop: 0 }}>
            {cartCount} item{cartCount === 1 ? '' : 's'} · <strong>{inr(cartTotal)}</strong>
          </p>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            This places the order and updates stock. Connect a payment provider to take real money.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={placeOrder}>Place order</Button>
            <Button variant="ghost" onClick={() => setCheckingOut(false)}>Back</Button>
          </div>
        </Modal>
      )}

      {addingProduct && (
        <Modal title="Add product" onClose={() => setAddingProduct(false)}>
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <Field label="Price (₹)" value={form.price} onChange={(v) => setForm({ ...form, price: v })} type="number" />
          <Field label="Stock" value={form.stock} onChange={(v) => setForm({ ...form, stock: v })} type="number" />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={createProduct}>Add</Button>
            <Button variant="ghost" onClick={() => setAddingProduct(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
`;
