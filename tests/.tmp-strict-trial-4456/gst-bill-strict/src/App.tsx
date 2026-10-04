import { useEffect, useMemo, useState } from 'react';
import ThemeToggle from './theme';

// A kirana bill is not a generic invoice: the GST slab lives on the ITEM, and the tax has to be shown
// split into CGST and SGST (half each, for a sale inside the same state) or the bill is not compliant.
interface Item { id: string; name: string; price: number; gst: number; }
interface Line { itemId: string; qty: number; }

const SLABS = [0, 5, 12, 18, 28];
const CATALOGUE_KEY = 'gst-catalogue-v1';
const COUNTER_KEY = 'gst-bill-no-v1';

const SEED: Item[] = [
  { id: 'a', name: 'Rice (1 kg)', price: 62, gst: 5 },
  { id: 'b', name: 'Toor dal (1 kg)', price: 145, gst: 5 },
  { id: 'c', name: 'Refined oil (1 L)', price: 128, gst: 5 },
  { id: 'd', name: 'Biscuits (pack)', price: 30, gst: 18 },
  { id: 'e', name: 'Soap (bar)', price: 42, gst: 18 },
  { id: 'f', name: 'Cold drink (600 ml)', price: 40, gst: 28 },
];

function loadCatalogue(): Item[] {
  try {
    const raw = localStorage.getItem(CATALOGUE_KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? (parsed as Item[]) : SEED;
  } catch { return SEED; }
}

function loadCounter(): number {
  try {
    const n = Number(localStorage.getItem(COUNTER_KEY));
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch { return 1; }
}

function rupees(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function App() {
  const [catalogue, setCatalogue] = useState<Item[]>(loadCatalogue);
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState('');
  const [billNo, setBillNo] = useState<number>(loadCounter);
  const [saved, setSaved] = useState<string | null>(null);

  // New-item form
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [gst, setGst] = useState(5);

  useEffect(() => { try { localStorage.setItem(CATALOGUE_KEY, JSON.stringify(catalogue)); } catch { /* private mode */ } }, [catalogue]);
  useEffect(() => { try { localStorage.setItem(COUNTER_KEY, String(billNo)); } catch { /* private mode */ } }, [billNo]);

  const addItem = () => {
    const n = name.trim();
    const p = Number(price);
    if (!n || !Number.isFinite(p) || p <= 0) return;
    setCatalogue([{ id: String(Date.now()), name: n, price: p, gst }, ...catalogue]);
    setName(''); setPrice('');
  };

  const addToBill = (itemId: string) => {
    setLines((list) => {
      const found = list.find((l) => l.itemId === itemId);
      return found ? list.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + 1 } : l)) : [...list, { itemId, qty: 1 }];
    });
  };
  const setQty = (itemId: string, qty: number) => {
    setLines((list) => (qty <= 0 ? list.filter((l) => l.itemId !== itemId) : list.map((l) => (l.itemId === itemId ? { ...l, qty } : l))));
  };

  // The whole point of the app: a per-slab breakdown, because that is what the return asks for.
  const bill = useMemo(() => {
    const rows = lines.map((l) => {
      const item = catalogue.find((i) => i.id === l.itemId);
      const price = item ? item.price : 0;
      const taxable = price * l.qty;
      const tax = (taxable * (item ? item.gst : 0)) / 100;
      return { line: l, item, taxable, tax, total: taxable + tax };
    }).filter((r) => r.item);
    const taxable = rows.reduce((s, r) => s + r.taxable, 0);
    const tax = rows.reduce((s, r) => s + r.tax, 0);
    const bySlab = SLABS.map((slab) => ({
      slab,
      taxable: rows.filter((r) => r.item && r.item.gst === slab).reduce((s, r) => s + r.taxable, 0),
      tax: rows.filter((r) => r.item && r.item.gst === slab).reduce((s, r) => s + r.tax, 0),
    })).filter((s) => s.taxable > 0);
    return { rows, taxable, tax, total: taxable + tax, bySlab };
  }, [lines, catalogue]);

  const finish = () => {
    if (!bill.rows.length) return;
    setBillNo(billNo + 1);
    setLines([]);
    setCustomer('');
    setSaved('Bill ' + billNo + ' completed — ' + rupees(bill.total));
  };

  return (
    <div className="container" style={{ maxWidth: 760, paddingTop: 28, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>GST Bill</h1>
        <ThemeToggle />
      </div>

      {saved && <div className="alert alert-success" style={{ marginBottom: 12 }}>{saved}</div>}

      <div className="card stack" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <strong>Bill no. {billNo}</strong>
          <input
            style={{ flex: 1, minWidth: 180 }}
            value={customer}
            aria-label="Customer name"
            placeholder="Customer name (optional)"
            onChange={(e) => setCustomer(e.target.value)}
          />
        </div>

        {bill.rows.length === 0 ? (
          <div className="nb-empty">
            <div className="nb-empty-icon">🧾</div>
            <div className="nb-empty-title">No items yet</div>
            <div className="nb-empty-text">Tap an item below to start the bill.</div>
          </div>
        ) : (
          <div className="nb-table-wrap">
            <table className="nb-table">
              <thead>
                <tr><th>Item</th><th>GST</th><th>Qty</th><th style={{ textAlign: 'right' }}>Amount</th><th /></tr>
              </thead>
              <tbody>
                {bill.rows.map((r) => (
                  <tr key={r.line.itemId}>
                    <td>{r.item ? r.item.name : ''}<br /><small>{rupees(r.item ? r.item.price : 0)}</small></td>
                    <td><span className="badge">{r.item ? r.item.gst : 0}%</span></td>
                    <td>
                      <div className="row">
                        <button onClick={() => setQty(r.line.itemId, r.line.qty - 1)} aria-label="Reduce quantity">−</button>
                        <span style={{ minWidth: 24, textAlign: 'center' }}>{r.line.qty}</span>
                        <button onClick={() => setQty(r.line.itemId, r.line.qty + 1)} aria-label="Increase quantity">+</button>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{rupees(r.total)}</td>
                    <td><button className="btn-ghost" onClick={() => setQty(r.line.itemId, 0)} aria-label="Remove item">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {bill.rows.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><span>Taxable value</span><strong>{rupees(bill.taxable)}</strong></div>
            {bill.bySlab.map((s) => (
              <div key={s.slab} className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                <span>CGST {s.slab / 2}% + SGST {s.slab / 2}% on {rupees(s.taxable)}</span>
                <span>{rupees(s.tax / 2)} + {rupees(s.tax / 2)}</span>
              </div>
            ))}
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 18 }}>
              <strong>Total</strong><strong>{rupees(bill.total)}</strong>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="primary" onClick={finish}>Complete bill</button>
              <button className="btn-ghost" onClick={() => window.print()}>Print</button>
              <button className="btn-ghost" onClick={() => setLines([])}>Clear</button>
            </div>
          </div>
        )}
      </div>

      <div className="card stack">
        <strong>Items</strong>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {catalogue.map((i) => (
            <button key={i.id} onClick={() => addToBill(i.id)} style={{ textAlign: 'left' }}>
              {i.name} · {rupees(i.price)} · {i.gst}%
            </button>
          ))}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <input aria-label="New item name" style={{ flex: 1, minWidth: 140 }} value={name} placeholder="New item name" onChange={(e) => setName(e.target.value)} />
          <input aria-label="Price" style={{ width: 110 }} value={price} placeholder="Price" inputMode="decimal" onChange={(e) => setPrice(e.target.value)} />
          <select value={gst} onChange={(e) => setGst(Number(e.target.value))} aria-label="GST slab">
            {SLABS.map((s) => <option key={s} value={s}>{s}% GST</option>)}
          </select>
          <button className="primary" onClick={addItem}>Add item</button>
        </div>
      </div>
    </div>
  );
}

export default App;
