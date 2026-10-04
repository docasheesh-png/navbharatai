import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

type OrderKind = 'table' | 'takeaway';
type OrderStatus = 'placed' | 'preparing' | 'served';

interface Dish extends Entity { name: string; category: string; price: number; veg: boolean; available: boolean }
interface Line { dishId: string; name: string; price: number; qty: number }
interface Order extends Entity {
  lines: Line[]; kind: OrderKind; table: string; subtotal: number; gst: number; total: number;
  status: OrderStatus; placed: string;
}

// GST on restaurant service in India is 5% for most establishments. Kept as a named constant so a
// restaurant on a different slab changes ONE number instead of hunting through the arithmetic.
const GST_RATE = 0.05;

const SEED_MENU: Dish[] = [
  { id: 'd1', name: 'Masala Dosa', category: 'South Indian', price: 120, veg: true, available: true },
  { id: 'd2', name: 'Paneer Butter Masala', category: 'Main Course', price: 260, veg: true, available: true },
  { id: 'd3', name: 'Chicken Biryani', category: 'Main Course', price: 320, veg: false, available: true },
  { id: 'd4', name: 'Masala Chai', category: 'Beverages', price: 40, veg: true, available: true },
  { id: 'd5', name: 'Gulab Jamun', category: 'Desserts', price: 90, veg: true, available: true },
  { id: 'd6', name: 'Veg Thali', category: 'Main Course', price: 240, veg: true, available: false },
];

const STATUS_TONE: Record<OrderStatus, 'accent' | 'warn' | 'good'> = {
  placed: 'accent', preparing: 'warn', served: 'good',
};

export default function App() {
  const [screen, setScreen] = useState('menu');
  const menu = useCollection<Dish>('rest.menu', SEED_MENU);
  const orders = useCollection<Order>('rest.orders', []);
  const [cart, setCart] = useState<Line[]>([]);
  const [category, setCategory] = useState('all');
  const [vegOnly, setVegOnly] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [kind, setKind] = useState<OrderKind>('table');
  const [table, setTable] = useState('');
  const [addingDish, setAddingDish] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'Main Course', price: '' });

  const categories = useMemo(
    () => Array.from(new Set(menu.items.map((d) => d.category))).sort(),
    [menu.items],
  );

  const visible = useMemo(
    () => menu.items.filter((d) => (category === 'all' || d.category === category) && (!vegOnly || d.veg)),
    [menu.items, category, vegOnly],
  );

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const gst = Math.round(subtotal * GST_RATE);
  const total = subtotal + gst;
  const openTickets = orders.items.filter((o) => o.status !== 'served');
  const todayRevenue = orders.items.reduce((s, o) => s + o.total, 0);

  function addToCart(d: Dish) {
    if (!d.available) return;
    setCart((c) => {
      const found = c.find((l) => l.dishId === d.id);
      if (found) return c.map((l) => (l.dishId === d.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { dishId: d.id, name: d.name, price: d.price, qty: 1 }];
    });
  }

  function setQty(dishId: string, qty: number) {
    setCart((c) => (qty <= 0 ? c.filter((l) => l.dishId !== dishId) : c.map((l) => (l.dishId === dishId ? { ...l, qty } : l))));
  }

  function placeOrder() {
    if (cart.length === 0) return;
    orders.add({
      lines: cart, kind, table: kind === 'table' ? table.trim() || '—' : '—',
      subtotal, gst, total, status: 'placed', placed: new Date().toISOString().slice(0, 10),
    });
    setCart([]); setTable(''); setPlacing(false); setScreen('kitchen');
  }

  function advance(o: Order) {
    const next: OrderStatus = o.status === 'placed' ? 'preparing' : 'served';
    orders.update(o.id, { status: next });
  }

  function createDish() {
    if (!form.name.trim()) return;
    menu.add({ name: form.name.trim(), category: form.category, price: Number(form.price) || 0, veg: true, available: true });
    setForm({ name: '', category: 'Main Course', price: '' });
    setAddingDish(false);
  }

  return (
    <Shell
      brand="Spice Route"
      nav={[
        { id: 'menu', label: 'Menu' },
        { id: 'order', label: 'Order (' + cart.reduce((s, l) => s + l.qty, 0) + ')' },
        { id: 'kitchen', label: 'Kitchen (' + openTickets.length + ')' },
        { id: 'admin', label: 'Admin' },
      ]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {screen === 'menu' && (
        <>
          <Card title="Menu">
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
              <Select
                label="Category"
                value={category}
                onChange={setCategory}
                options={[{ value: 'all', label: 'All categories' }, ...categories.map((c) => ({ value: c, label: c }))]}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginTop: 20 }}>
                <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />
                Vegetarian only
              </label>
            </div>
          </Card>
          {visible.length === 0 ? (
            <Empty>Nothing on the menu matches that.</Empty>
          ) : (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
              {visible.map((d) => (
                <Card key={d.id}>
                  <div style={{ height: 84, borderRadius: 8, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 800, fontSize: 22, marginBottom: 10 }}>
                    {d.name.slice(0, 1)}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      title={d.veg ? 'Vegetarian' : 'Non-vegetarian'}
                      style={{ width: 10, height: 10, borderRadius: 2, border: '2px solid ' + (d.veg ? '#16a34a' : '#dc2626'), flexShrink: 0 }}
                    />
                    <strong style={{ fontSize: 14 }}>{d.name}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 8px' }}>{d.category}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <strong style={{ flex: 1 }}>{inr(d.price)}</strong>
                    {!d.available && <Badge tone="bad">Not available</Badge>}
                  </div>
                  <Button onClick={() => addToCart(d)}>{d.available ? 'Add' : 'Unavailable'}</Button>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {screen === 'order' && (
        <Card
          title="Your order"
          actions={cart.length > 0 ? <Button onClick={() => setPlacing(true)}>Place order</Button> : undefined}
        >
          {cart.length === 0 ? (
            <Empty>Nothing added yet — pick something from the menu.</Empty>
          ) : (
            <>
              {cart.map((l) => (
                <div key={l.dishId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{inr(l.price)} each</div>
                  </div>
                  <Button variant="ghost" onClick={() => setQty(l.dishId, l.qty - 1)}>−</Button>
                  <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{l.qty}</span>
                  <Button variant="ghost" onClick={() => setQty(l.dishId, l.qty + 1)}>+</Button>
                  <strong style={{ minWidth: 70, textAlign: 'right' }}>{inr(l.price * l.qty)}</strong>
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 14 }}>
                <div style={{ display: 'flex' }}><span style={{ flex: 1, color: 'var(--muted)' }}>Subtotal</span><span>{inr(subtotal)}</span></div>
                <div style={{ display: 'flex' }}><span style={{ flex: 1, color: 'var(--muted)' }}>GST (5%)</span><span>{inr(gst)}</span></div>
                <div style={{ display: 'flex', fontSize: 17, fontWeight: 800, marginTop: 6 }}><span style={{ flex: 1 }}>Total</span><span>{inr(total)}</span></div>
              </div>
            </>
          )}
        </Card>
      )}

      {screen === 'kitchen' && (
        <Card title={'Kitchen tickets (' + openTickets.length + ' open)'}>
          {orders.items.length === 0 ? (
            <Empty>No orders yet.</Empty>
          ) : orders.items.map((o) => (
            <div key={o.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <strong style={{ flex: 1, fontSize: 14 }}>
                  {o.kind === 'table' ? 'Table ' + o.table : 'Takeaway'} · {inr(o.total)}
                </strong>
                <Badge tone={STATUS_TONE[o.status]}>{o.status}</Badge>
              </div>
              <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>
                {o.lines.map((l) => <li key={l.dishId}>{l.qty} × {l.name}</li>)}
              </ul>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)' }}>{shortDate(o.placed)}</span>
                {o.status !== 'served' && (
                  <Button onClick={() => advance(o)}>{o.status === 'placed' ? 'Start preparing' : 'Mark served'}</Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {screen === 'admin' && (
        <>
          <StatRow>
            <StatTile label="Revenue" value={inr(todayRevenue)} hint={orders.items.length + ' orders'} />
            <StatTile label="Open tickets" value={String(openTickets.length)} />
            <StatTile label="Dishes" value={String(menu.items.length)} hint={menu.items.filter((d) => !d.available).length + ' unavailable'} />
          </StatRow>
          <Card title="Menu items" actions={<Button onClick={() => setAddingDish(true)}>Add dish</Button>}>
            {menu.items.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{d.category} · {inr(d.price)}</div>
                </div>
                <Button variant="ghost" onClick={() => menu.update(d.id, { available: !d.available })}>
                  {d.available ? 'Mark unavailable' : 'Mark available'}
                </Button>
                <Button variant="ghost" onClick={() => menu.remove(d.id)}>Remove</Button>
              </div>
            ))}
          </Card>
        </>
      )}

      {placing && (
        <Modal title="Place order" onClose={() => setPlacing(false)}>
          <Select
            label="Order type"
            value={kind}
            onChange={(v) => setKind(v as OrderKind)}
            options={[{ value: 'table', label: 'Dine in (table)' }, { value: 'takeaway', label: 'Takeaway' }]}
          />
          {kind === 'table' && <Field label="Table number" value={table} onChange={setTable} placeholder="12" />}
          <p style={{ fontSize: 14, marginTop: 4 }}>
            {inr(subtotal)} + {inr(gst)} GST = <strong>{inr(total)}</strong>
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={placeOrder}>Send to kitchen</Button>
            <Button variant="ghost" onClick={() => setPlacing(false)}>Back</Button>
          </div>
        </Modal>
      )}

      {addingDish && (
        <Modal title="Add dish" onClose={() => setAddingDish(false)}>
          <Field label="Dish name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <Field label="Price (₹)" value={form.price} onChange={(v) => setForm({ ...form, price: v })} type="number" />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={createDish}>Add</Button>
            <Button variant="ghost" onClick={() => setAddingDish(false)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
