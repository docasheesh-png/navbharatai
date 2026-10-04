import { useMemo, useState } from 'react';
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
