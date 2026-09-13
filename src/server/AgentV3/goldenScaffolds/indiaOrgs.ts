// AgentV3 — Golden Scaffolds, India batch 2: the ORGANISATION apps (courier, NGO/trust, school ERP).
//
// WHY THESE THREE ARE PRO. Each one is several linked entities, not one list: a consignment owns a
// STATUS HISTORY, a donation belongs to a donor and to a programme, a student has attendance, marks and
// fees. That is precisely the shape where a weak model ships half an app — one entity wired and the
// others left as empty screens — so they ride the shared pro foundation (proShell.ts) and the free tier
// is never offered them.
//
// WHY THEY ARE WORTH CARRYING AT ALL: each is software an Indian organisation keeps in a register today,
// and that no generic template library ships. A courier firm needs a real audit trail per parcel; a
// trust needs a numbered 80G receipt it can reprint; a school needs a report card that computes itself.
//
// Written with NO backtick and NO backslash anywhere in the embedded code or its prose — one backtick
// would terminate this file's own template literal and the syntax error would land dozens of lines from
// its cause.

export const courierAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, Badge, Button, Field, Select, Empty, StatRow, StatTile } from './lib/ui';
import { useCollection, newId, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

// A parcel's status is not one field that gets overwritten — it is a HISTORY. Overwriting is how a
// courier loses the answer to "when did it leave Kanpur?", which is the only question a caller asks.
interface Leg { status: string; date: string; place: string }

interface Parcel extends Entity {
  awb: string;
  sender: string;
  receiver: string;
  phone: string;
  address: string;
  fromCity: string;
  toCity: string;
  weight: number;
  value: number;
  payMode: 'prepaid' | 'topay';
  zone: 'local' | 'state' | 'national';
  charge: number;
  legs: Leg[];
}

const FLOW = ['Booked', 'Picked up', 'In transit', 'Out for delivery', 'Delivered'];

const ZONES = [
  { value: 'local', label: 'Local (same city)', base: 40, perKg: 15 },
  { value: 'state', label: 'Within the state', base: 60, perKg: 25 },
  { value: 'national', label: 'Outside the state', base: 90, perKg: 45 },
];

function zoneOf(id: string) {
  return ZONES.find((z) => z.value === id) || ZONES[0];
}

/** Charge = the zone's base plus a per-kg rate, rounded up to the next rupee. Shown before booking. */
function priceOf(zone: string, weight: number): number {
  const z = zoneOf(zone);
  return Math.ceil(z.base + z.perKg * Math.max(0.5, weight));
}

function makeAwb(): string {
  return 'NB' + Math.floor(100000 + Math.random() * 899999).toString();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const SEED: Parcel[] = [
  {
    id: 'p1', awb: 'NB204417', sender: 'Verma Traders', receiver: 'Suresh Yadav', phone: '9811122233',
    address: '14, Gandhi Nagar, Kanpur', fromCity: 'Delhi', toCity: 'Kanpur', weight: 2.5, value: 4200,
    payMode: 'topay', zone: 'state', charge: 123,
    legs: [
      { status: 'Booked', date: '2026-09-09', place: 'Delhi' },
      { status: 'Picked up', date: '2026-09-09', place: 'Delhi' },
      { status: 'In transit', date: '2026-09-10', place: 'Agra hub' },
    ],
  },
  {
    id: 'p2', awb: 'NB551902', sender: 'Anita Sharma', receiver: 'Deepa Menon', phone: '9745500112',
    address: '7B, Panampilly Nagar, Kochi', fromCity: 'Mumbai', toCity: 'Kochi', weight: 1, value: 900,
    payMode: 'prepaid', zone: 'national', charge: 135,
    legs: [
      { status: 'Booked', date: '2026-09-11', place: 'Mumbai' },
      { status: 'Picked up', date: '2026-09-11', place: 'Mumbai' },
    ],
  },
  {
    id: 'p3', awb: 'NB778310', sender: 'Kirana Mart', receiver: 'Rakesh Singh', phone: '9900011122',
    address: 'Shop 3, Sadar Bazaar, Jaipur', fromCity: 'Jaipur', toCity: 'Jaipur', weight: 5, value: 1500,
    payMode: 'topay', zone: 'local', charge: 115,
    legs: [
      { status: 'Booked', date: '2026-09-08', place: 'Jaipur' },
      { status: 'Picked up', date: '2026-09-08', place: 'Jaipur' },
      { status: 'Out for delivery', date: '2026-09-09', place: 'Jaipur' },
      { status: 'Delivered', date: '2026-09-09', place: 'Jaipur' },
    ],
  },
];

function statusOf(p: Parcel): string {
  return p.legs.length ? p.legs[p.legs.length - 1].status : 'Booked';
}

function toneFor(status: string): 'good' | 'warn' | 'accent' | 'bad' | 'neutral' {
  if (status === 'Delivered') return 'good';
  if (status === 'Returned') return 'bad';
  if (status === 'Out for delivery') return 'warn';
  if (status === 'Booked') return 'neutral';
  return 'accent';
}

export default function App() {
  const parcels = useCollection<Parcel>('courier.parcels', SEED);
  const [screen, setScreen] = useState('dashboard');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({
    sender: '', receiver: '', phone: '', address: '', fromCity: '', toCity: '',
    weight: '1', value: '0', payMode: 'prepaid', zone: 'local',
  });
  const [note, setNote] = useState('');

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of parcels.items) {
      const s = statusOf(p);
      map[s] = (map[s] || 0) + 1;
    }
    return map;
  }, [parcels.items]);

  // Cash the rider still has to collect: to-pay parcels that have NOT been delivered yet.
  const cashPending = useMemo(
    () => parcels.items.filter((p) => p.payMode === 'topay' && statusOf(p) !== 'Delivered')
      .reduce((sum, p) => sum + p.charge, 0),
    [parcels.items],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return parcels.items;
    return parcels.items.filter((p) =>
      p.awb.toLowerCase().includes(q) || p.phone.includes(q) || p.receiver.toLowerCase().includes(q));
  }, [parcels.items, query]);

  const open = openId ? parcels.items.find((p) => p.id === openId) || null : null;
  const quoted = priceOf(form.zone, Number(form.weight) || 0);

  function book() {
    if (!form.sender.trim() || !form.receiver.trim()) { setNote('Sender and receiver are required.'); return; }
    const awb = makeAwb();
    parcels.add({
      awb,
      sender: form.sender.trim(),
      receiver: form.receiver.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      fromCity: form.fromCity.trim() || 'Local',
      toCity: form.toCity.trim() || 'Local',
      weight: Math.max(0.1, Number(form.weight) || 1),
      value: Math.max(0, Number(form.value) || 0),
      payMode: form.payMode as Parcel['payMode'],
      zone: form.zone as Parcel['zone'],
      charge: quoted,
      legs: [{ status: 'Booked', date: today(), place: form.fromCity.trim() || 'Local' }],
    });
    setForm({ ...form, sender: '', receiver: '', phone: '', address: '', weight: '1', value: '0' });
    setNote('Booked as ' + awb + ' — charge ' + inr(quoted) + '.');
    setScreen('parcels');
  }

  /** Append the next leg. Appending (never replacing) is what keeps the trail auditable. */
  function advance(p: Parcel, place: string) {
    const current = statusOf(p);
    const at = FLOW.indexOf(current);
    if (at < 0 || at >= FLOW.length - 1) return;
    parcels.update(p.id, { legs: [...p.legs, { status: FLOW[at + 1], date: today(), place: place || p.toCity }] });
  }

  function markReturned(p: Parcel) {
    parcels.update(p.id, { legs: [...p.legs, { status: 'Returned', date: today(), place: p.toCity }] });
  }

  return (
    <Shell
      brand="Courier"
      nav={[
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'book', label: 'Book a parcel' },
        { id: 'parcels', label: 'Consignments' },
      ]}
      active={screen}
      onNavigate={(id) => { setScreen(id); setOpenId(null); }}
      actions={<ThemeToggle />}
    >
      {note && <Card><span>{note}</span></Card>}

      {screen === 'dashboard' && (
        <>
          <StatRow>
            <StatTile label="Total parcels" value={String(parcels.items.length)} />
            <StatTile label="In transit" value={String(counts['In transit'] || 0)} hint="moving between hubs" />
            <StatTile label="Out for delivery" value={String(counts['Out for delivery'] || 0)} />
            <StatTile label="Delivered" value={String(counts['Delivered'] || 0)} />
            <StatTile label="To-pay cash pending" value={inr(cashPending)} hint="not yet delivered" />
          </StatRow>
          <Card title="Where every parcel is right now">
            {FLOW.concat(['Returned']).map((s) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <Badge tone={toneFor(s)}>{s}</Badge>
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{counts[s] || 0}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      {screen === 'book' && (
        <Card title="Book a consignment">
          <Field label="Sender" value={form.sender} onChange={(v) => setForm({ ...form, sender: v })} placeholder="Verma Traders" />
          <Field label="Receiver" value={form.receiver} onChange={(v) => setForm({ ...form, receiver: v })} placeholder="Suresh Yadav" />
          <Field label="Receiver phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="9811122233" />
          <Field label="Delivery address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <Field label="From city" value={form.fromCity} onChange={(v) => setForm({ ...form, fromCity: v })} placeholder="Delhi" />
          <Field label="To city" value={form.toCity} onChange={(v) => setForm({ ...form, toCity: v })} placeholder="Kanpur" />
          <Field label="Weight (kg)" value={form.weight} onChange={(v) => setForm({ ...form, weight: v })} type="number" />
          <Field label="Declared value" value={form.value} onChange={(v) => setForm({ ...form, value: v })} type="number" />
          <Select
            label="Destination zone"
            value={form.zone}
            onChange={(v) => setForm({ ...form, zone: v })}
            options={ZONES.map((z) => ({ value: z.value, label: z.label }))}
          />
          <Select
            label="Payment"
            value={form.payMode}
            onChange={(v) => setForm({ ...form, payMode: v })}
            options={[{ value: 'prepaid', label: 'Prepaid' }, { value: 'topay', label: 'To-pay (collect on delivery)' }]}
          />
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            Charge for this parcel: <strong>{inr(quoted)}</strong>
            <span style={{ color: 'var(--muted)' }}> ({zoneOf(form.zone).label}, {zoneOf(form.zone).perKg} per kg over {inr(zoneOf(form.zone).base)} base)</span>
          </p>
          <Button onClick={book}>Book and generate tracking number</Button>
        </Card>
      )}

      {screen === 'parcels' && (
        <>
          <Card>
            <Field label="Search by tracking number, phone or receiver" value={query} onChange={setQuery} placeholder="NB204417" />
          </Card>
          {visible.length === 0 ? (
            <Card><Empty>No consignment matches that search.</Empty></Card>
          ) : (
            visible.map((p) => {
              const s = statusOf(p);
              return (
                <Card key={p.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <strong>{p.awb}</strong>
                    <Badge tone={toneFor(s)}>{s}</Badge>
                    <Badge tone={p.payMode === 'topay' ? 'warn' : 'neutral'}>
                      {p.payMode === 'topay' ? 'To-pay ' + inr(p.charge) : 'Prepaid'}
                    </Badge>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <Button variant="ghost" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                        {openId === p.id ? 'Hide journey' : 'Journey'}
                      </Button>
                      {s !== 'Delivered' && s !== 'Returned' && (
                        <Button onClick={() => advance(p, p.toCity)}>Mark {FLOW[FLOW.indexOf(s) + 1]}</Button>
                      )}
                      {s !== 'Delivered' && s !== 'Returned' && (
                        <Button variant="danger" onClick={() => markReturned(p)}>Returned</Button>
                      )}
                    </span>
                  </div>
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 0' }}>
                    {p.sender} &rarr; {p.receiver} ({p.phone}) · {p.fromCity} to {p.toCity} · {p.weight} kg · value {inr(p.value)}
                  </p>
                  {openId === p.id && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                      {p.legs.map((leg, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 0' }}>
                          <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 62 }}>{shortDate(leg.date)}</span>
                          <strong style={{ fontSize: 13 }}>{leg.status}</strong>
                          <span style={{ color: 'var(--muted)', fontSize: 13 }}>{leg.place}</span>
                        </div>
                      ))}
                      <p style={{ color: 'var(--muted)', fontSize: 12, margin: '8px 0 0' }}>
                        Every line above was appended when it happened — nothing here is overwritten.
                      </p>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </>
      )}
    </Shell>
  );
}
`;

export const ngoAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, Badge, Button, Field, Select, Empty, Modal, StatRow, StatTile } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

// A trust's year is the INDIAN financial year (April to March), and a receipt must be reprintable years
// later — so the receipt number is stored on the donation, never recomputed from the list's position.
// Renumbering on delete is how a trust ends up with two receipts carrying the same number.
interface Donor extends Entity { name: string; phone: string; email: string; pan: string }

interface Donation extends Entity {
  donorId: string;
  amount: number;
  date: string;
  mode: 'UPI' | 'Cash' | 'Cheque' | 'Bank transfer';
  programme: string;
  receiptNo: string;
}

interface Volunteer extends Entity { name: string; phone: string; skills: string; availability: string }

interface Programme extends Entity { name: string; target: number }

const MODES = ['UPI', 'Cash', 'Cheque', 'Bank transfer'];

const DONORS: Donor[] = [
  { id: 'd1', name: 'Ramesh Agarwal', phone: '9810011223', email: 'ramesh@example.in', pan: 'ABCPA1234D' },
  { id: 'd2', name: 'Sunita Joshi', phone: '9822011456', email: 'sunita@example.in', pan: 'BXZPJ5678K' },
  { id: 'd3', name: 'Kiran Foundation', phone: '9900122334', email: 'give@example.in', pan: 'AAFCK9012M' },
];

const PROGRAMMES: Programme[] = [
  { id: 'pr1', name: 'School kits for 500 children', target: 250000 },
  { id: 'pr2', name: 'Mobile health camp', target: 400000 },
  { id: 'pr3', name: 'Clean water tanks', target: 150000 },
];

const DONATIONS: Donation[] = [
  { id: 'n1', donorId: 'd1', amount: 25000, date: '2026-05-12', mode: 'UPI', programme: 'pr1', receiptNo: 'R-0001' },
  { id: 'n2', donorId: 'd3', amount: 100000, date: '2026-06-02', mode: 'Bank transfer', programme: 'pr2', receiptNo: 'R-0002' },
  { id: 'n3', donorId: 'd2', amount: 5100, date: '2026-07-19', mode: 'Cash', programme: 'pr1', receiptNo: 'R-0003' },
  { id: 'n4', donorId: 'd1', amount: 11000, date: '2026-08-30', mode: 'Cheque', programme: 'pr3', receiptNo: 'R-0004' },
];

const VOLUNTEERS: Volunteer[] = [
  { id: 'v1', name: 'Anjali Rao', phone: '9745566778', skills: 'Teaching, Kannada', availability: 'Weekends' },
  { id: 'v2', name: 'Imran Shaikh', phone: '9833344556', skills: 'Logistics, driving', availability: 'Weekday evenings' },
];

/** The Indian financial year a date falls in: April to March. April 2026 and Feb 2027 are the same year. */
function fyOf(iso: string): number {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 0;
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}

function fyLabel(fy: number): string {
  return fy + '-' + String((fy + 1) % 100).padStart(2, '0');
}

function currentFy(): number {
  return fyOf(new Date().toISOString().slice(0, 10));
}

export default function App() {
  const donors = useCollection<Donor>('ngo.donors', DONORS);
  const donations = useCollection<Donation>('ngo.donations', DONATIONS);
  const volunteers = useCollection<Volunteer>('ngo.volunteers', VOLUNTEERS);
  const programmes = useCollection<Programme>('ngo.programmes', PROGRAMMES);

  const [screen, setScreen] = useState('dashboard');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState('all');
  const [progFilter, setProgFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [gift, setGift] = useState({ donorId: 'd1', amount: '', date: new Date().toISOString().slice(0, 10), mode: 'UPI', programme: 'pr1' });
  const [newDonor, setNewDonor] = useState({ name: '', phone: '', email: '', pan: '' });

  const fy = currentFy();
  const donorName = (id: string) => donors.items.find((d) => d.id === id)?.name || 'Unknown donor';
  const progName = (id: string) => programmes.items.find((p) => p.id === id)?.name || id;

  const thisFy = useMemo(() => donations.items.filter((d) => fyOf(d.date) === fy), [donations.items, fy]);

  const stats = useMemo(() => {
    const raised = thisFy.reduce((s, d) => s + d.amount, 0);
    const byMode: Record<string, number> = {};
    for (const d of thisFy) byMode[d.mode] = (byMode[d.mode] || 0) + d.amount;
    const largest = thisFy.reduce((m, d) => (d.amount > m ? d.amount : m), 0);
    return { raised, byMode, largest, donorCount: new Set(thisFy.map((d) => d.donorId)).size };
  }, [thisFy]);

  const raisedFor = (progId: string) =>
    donations.items.filter((d) => d.programme === progId).reduce((s, d) => s + d.amount, 0);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return donations.items
      .filter((d) => (modeFilter === 'all' || d.mode === modeFilter) && (progFilter === 'all' || d.programme === progFilter))
      .filter((d) => !q || donorName(d.donorId).toLowerCase().includes(q) || d.receiptNo.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [donations.items, donors.items, modeFilter, progFilter, query]);

  /** Next receipt number = one past the HIGHEST ever issued, so deleting a row can never reissue one. */
  function nextReceiptNo(): string {
    const highest = donations.items.reduce((max, d) => {
      const n = parseInt(d.receiptNo.replace(/[^0-9]/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return 'R-' + String(highest + 1).padStart(4, '0');
  }

  function recordDonation() {
    const amount = Math.round(Number(gift.amount) || 0);
    if (amount <= 0) { setNote('Enter the amount received.'); return; }
    const made = donations.add({
      donorId: gift.donorId, amount, date: gift.date,
      mode: gift.mode as Donation['mode'], programme: gift.programme, receiptNo: nextReceiptNo(),
    });
    setGift({ ...gift, amount: '' });
    setReceiptId(made.id);
    setNote('Receipt ' + made.receiptNo + ' issued for ' + inr(amount) + '.');
  }

  function addDonor() {
    if (!newDonor.name.trim()) { setNote('A donor needs a name.'); return; }
    const made = donors.add({ name: newDonor.name.trim(), phone: newDonor.phone.trim(), email: newDonor.email.trim(), pan: newDonor.pan.trim().toUpperCase() });
    setNewDonor({ name: '', phone: '', email: '', pan: '' });
    setGift({ ...gift, donorId: made.id });
    setNote(made.name + ' added to the donor register.');
  }

  function exportCsv() {
    const nl = String.fromCharCode(10);
    const cell = (v: string) => '"' + v.split('"').join('""') + '"';
    const head = ['Receipt', 'Date', 'Donor', 'PAN', 'Amount', 'Mode', 'Programme'].map(cell).join(',');
    const rows = donations.items.map((d) => {
      const donor = donors.items.find((x) => x.id === d.donorId);
      return [d.receiptNo, d.date, donor ? donor.name : '', donor ? donor.pan : '', String(d.amount), d.mode, progName(d.programme)]
        .map(cell).join(',');
    }).join(nl);
    const blob = new Blob([head + nl + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'donation-register.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNote('Donation register exported for the accountant.');
  }

  const receipt = receiptId ? donations.items.find((d) => d.id === receiptId) || null : null;
  const receiptDonor = receipt ? donors.items.find((d) => d.id === receipt.donorId) || null : null;

  return (
    <Shell
      brand="Trust Office"
      nav={[
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'record', label: 'Record a donation' },
        { id: 'register', label: 'Donation register' },
        { id: 'programmes', label: 'Programmes' },
        { id: 'volunteers', label: 'Volunteers' },
      ]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {note && <Card><span>{note}</span></Card>}

      {screen === 'dashboard' && (
        <>
          <StatRow>
            <StatTile label={'Raised in FY ' + fyLabel(fy)} value={inr(stats.raised)} hint="April to March" />
            <StatTile label="Donors this year" value={String(stats.donorCount)} />
            <StatTile label="Largest donation" value={inr(stats.largest)} />
            <StatTile label="Volunteers" value={String(volunteers.items.length)} />
          </StatRow>
          <Card title={'How this year came in (FY ' + fyLabel(fy) + ')'}>
            {MODES.map((m) => (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <Badge tone={m === 'Cash' ? 'warn' : 'accent'}>{m}</Badge>
                <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{inr(stats.byMode[m] || 0)}</span>
              </div>
            ))}
            {stats.raised === 0 && <Empty>Nothing recorded in this financial year yet.</Empty>}
          </Card>
        </>
      )}

      {screen === 'record' && (
        <>
          <Card title="Record a donation">
            <Select
              label="Donor"
              value={gift.donorId}
              onChange={(v) => setGift({ ...gift, donorId: v })}
              options={donors.items.map((d) => ({ value: d.id, label: d.name + ' (' + (d.pan || 'no PAN') + ')' }))}
            />
            <Field label="Amount received" value={gift.amount} onChange={(v) => setGift({ ...gift, amount: v })} type="number" placeholder="25000" />
            <Field label="Date" value={gift.date} onChange={(v) => setGift({ ...gift, date: v })} type="date" />
            <Select label="Mode" value={gift.mode} onChange={(v) => setGift({ ...gift, mode: v })} options={MODES.map((m) => ({ value: m, label: m }))} />
            <Select
              label="Programme"
              value={gift.programme}
              onChange={(v) => setGift({ ...gift, programme: v })}
              options={programmes.items.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Button onClick={recordDonation}>Record and issue receipt</Button>
          </Card>
          <Card title="Add a donor">
            <Field label="Name" value={newDonor.name} onChange={(v) => setNewDonor({ ...newDonor, name: v })} />
            <Field label="Phone" value={newDonor.phone} onChange={(v) => setNewDonor({ ...newDonor, phone: v })} />
            <Field label="Email" value={newDonor.email} onChange={(v) => setNewDonor({ ...newDonor, email: v })} />
            <Field label="PAN" value={newDonor.pan} onChange={(v) => setNewDonor({ ...newDonor, pan: v })} placeholder="ABCPA1234D" />
            <Button variant="ghost" onClick={addDonor}>Add to register</Button>
          </Card>
        </>
      )}

      {screen === 'register' && (
        <>
          <Card actions={<Button variant="ghost" onClick={exportCsv}>Export CSV</Button>}>
            <Field label="Search by donor or receipt number" value={query} onChange={setQuery} placeholder="R-0002" />
            <Select label="Mode" value={modeFilter} onChange={setModeFilter} options={[{ value: 'all', label: 'All modes' }, ...MODES.map((m) => ({ value: m, label: m }))]} />
            <Select
              label="Programme"
              value={progFilter}
              onChange={setProgFilter}
              options={[{ value: 'all', label: 'All programmes' }, ...programmes.items.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </Card>
          {visible.length === 0 ? (
            <Card><Empty>No donation matches these filters.</Empty></Card>
          ) : (
            visible.map((d) => (
              <Card key={d.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <strong>{inr(d.amount)}</strong>
                  <Badge tone="accent">{d.mode}</Badge>
                  <Badge tone="neutral">{d.receiptNo}</Badge>
                  <span style={{ marginLeft: 'auto' }}>
                    <Button variant="ghost" onClick={() => setReceiptId(d.id)}>Receipt</Button>
                  </span>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 0' }}>
                  {donorName(d.donorId)} · {shortDate(d.date)} · {progName(d.programme)} · FY {fyLabel(fyOf(d.date))}
                </p>
              </Card>
            ))
          )}
        </>
      )}

      {screen === 'programmes' && (
        programmes.items.length === 0 ? <Card><Empty>No programmes yet.</Empty></Card> : (
          programmes.items.map((p) => {
            const got = raisedFor(p.id);
            const pct = p.target > 0 ? Math.min(100, Math.round((got / p.target) * 100)) : 0;
            return (
              <Card key={p.id} title={p.name}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 8 }}>
                  <strong>{inr(got)}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>of {inr(p.target)} target</span>
                  <span style={{ marginLeft: 'auto' }}><Badge tone={pct >= 100 ? 'good' : pct >= 50 ? 'accent' : 'warn'}>{pct}%</Badge></span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'var(--accent-soft)', overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)' }} />
                </div>
              </Card>
            );
          })
        )
      )}

      {screen === 'volunteers' && (
        volunteers.items.length === 0 ? <Card><Empty>No volunteers on the register yet.</Empty></Card> : (
          volunteers.items.map((v) => (
            <Card key={v.id}>
              <strong>{v.name}</strong>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0' }}>
                {v.phone} · {v.skills} · available {v.availability}
              </p>
            </Card>
          ))
        )
      )}

      {receipt && receiptDonor && (
        <Modal title={'Receipt ' + receipt.receiptNo} onClose={() => setReceiptId(null)}>
          <p style={{ margin: '0 0 10px', fontSize: 14 }}>
            Received with thanks from <strong>{receiptDonor.name}</strong> the sum of <strong>{inr(receipt.amount)}</strong>
            {' '}by {receipt.mode} on {shortDate(receipt.date)} towards <strong>{progName(receipt.programme)}</strong>.
          </p>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--muted)' }}>
            PAN of donor: {receiptDonor.pan || 'not provided'} · Financial year {fyLabel(fyOf(receipt.date))}
          </p>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--muted)' }}>
            Donations to this trust are eligible for deduction under section 80G of the Income Tax Act, 1961.
            Enter your own registration number and address here before issuing this receipt to a donor.
          </p>
          <Button onClick={() => window.print()}>Print this receipt</Button>
        </Modal>
      )}
    </Shell>
  );
}
`;

export const schoolErpAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, Badge, Button, Field, Select, Empty, StatRow, StatTile } from './lib/ui';
import { useCollection, inr, type Entity } from './lib/store';
import ThemeToggle from './theme';

// A school's data is four linked things about ONE student — enrolment, attendance, marks and fees — and
// the app is only useful when all four agree on who the student is. Attendance is stored per DATE per
// student (not as a running percentage) so a wrongly marked day can be corrected and the percentage
// recomputes itself; a stored percentage would have to be un-arithmetic-ed by hand.
interface Student extends Entity {
  name: string; admNo: string; roll: number; cls: string; section: string;
  parent: string; parentPhone: string;
}

interface Teacher extends Entity { name: string; subjects: string }

interface Mark extends Entity { studentId: string; exam: string; subject: string; got: number; outOf: number }

interface Attendance extends Entity { studentId: string; date: string; present: boolean }

interface FeeRule extends Entity { cls: string; term: string; amount: number }

interface Payment extends Entity { studentId: string; term: string; amount: number; date: string; receiptNo: string }

const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const SECTIONS = ['A', 'B', 'C'];
const SUBJECTS = ['Hindi', 'English', 'Maths', 'Science', 'Social Science'];
const EXAMS = ['Unit Test', 'Half Yearly', 'Annual'];
const TERMS = ['Term 1', 'Term 2', 'Term 3'];

const STUDENTS: Student[] = [
  { id: 's1', name: 'Aarav Gupta', admNo: 'ADM-1042', roll: 1, cls: '6', section: 'A', parent: 'Rakesh Gupta', parentPhone: '9810022334' },
  { id: 's2', name: 'Diya Sharma', admNo: 'ADM-1043', roll: 2, cls: '6', section: 'A', parent: 'Neha Sharma', parentPhone: '9820033445' },
  { id: 's3', name: 'Kabir Khan', admNo: 'ADM-1044', roll: 3, cls: '6', section: 'A', parent: 'Imran Khan', parentPhone: '9900044556' },
  { id: 's4', name: 'Ananya Rao', admNo: 'ADM-1101', roll: 1, cls: '9', section: 'B', parent: 'Suresh Rao', parentPhone: '9745055667' },
];

const TEACHERS: Teacher[] = [
  { id: 't1', name: 'Mrs. Kulkarni', subjects: 'Maths, Science' },
  { id: 't2', name: 'Mr. Bansal', subjects: 'Hindi, Social Science' },
];

const MARKS: Mark[] = [
  { id: 'm1', studentId: 's1', exam: 'Half Yearly', subject: 'Maths', got: 78, outOf: 100 },
  { id: 'm2', studentId: 's1', exam: 'Half Yearly', subject: 'Science', got: 84, outOf: 100 },
  { id: 'm3', studentId: 's1', exam: 'Half Yearly', subject: 'Hindi', got: 66, outOf: 100 },
  { id: 'm4', studentId: 's2', exam: 'Half Yearly', subject: 'Maths', got: 91, outOf: 100 },
];

const ATTENDANCE: Attendance[] = [
  { id: 'a1', studentId: 's1', date: '2026-09-11', present: true },
  { id: 'a2', studentId: 's2', date: '2026-09-11', present: true },
  { id: 'a3', studentId: 's3', date: '2026-09-11', present: false },
];

const FEES: FeeRule[] = CLASSES.map((c, i) => ({ id: 'f' + c, cls: c, term: 'Term 1', amount: 4000 + i * 250 }));

const PAYMENTS: Payment[] = [
  { id: 'y1', studentId: 's1', term: 'Term 1', amount: 5250, date: '2026-04-12', receiptNo: 'F-0001' },
];

function gradeFor(pct: number): string {
  if (pct >= 90) return 'A1';
  if (pct >= 80) return 'A2';
  if (pct >= 70) return 'B1';
  if (pct >= 60) return 'B2';
  if (pct >= 50) return 'C';
  if (pct >= 33) return 'D';
  return 'Needs improvement';
}

export default function App() {
  const students = useCollection<Student>('erp.students', STUDENTS);
  const teachers = useCollection<Teacher>('erp.teachers', TEACHERS);
  const marks = useCollection<Mark>('erp.marks', MARKS);
  const attendance = useCollection<Attendance>('erp.attendance', ATTENDANCE);
  const feeRules = useCollection<FeeRule>('erp.feeRules', FEES);
  const payments = useCollection<Payment>('erp.payments', PAYMENTS);

  const [screen, setScreen] = useState('dashboard');
  const [cls, setCls] = useState('6');
  const [section, setSection] = useState('A');
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [exam, setExam] = useState('Half Yearly');
  const [term, setTerm] = useState('Term 1');
  const [query, setQuery] = useState('');
  const [cardFor, setCardFor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ name: '', admNo: '', roll: '', parent: '', parentPhone: '' });

  const roster = useMemo(
    () => students.items.filter((s) => s.cls === cls && s.section === section).slice().sort((a, b) => a.roll - b.roll),
    [students.items, cls, section],
  );

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return students.items.filter((s) =>
      s.name.toLowerCase().includes(q) || s.admNo.toLowerCase().includes(q) || s.parentPhone.includes(q));
  }, [students.items, query]);

  function attendanceFor(studentId: string, date: string) {
    return attendance.items.find((a) => a.studentId === studentId && a.date === date) || null;
  }

  /** Percentage is DERIVED from the marked days, so correcting a day fixes the figure automatically. */
  function attendancePct(studentId: string): number {
    const rows = attendance.items.filter((a) => a.studentId === studentId);
    if (rows.length === 0) return 0;
    return Math.round((rows.filter((a) => a.present).length / rows.length) * 100);
  }

  function mark(studentId: string, present: boolean) {
    const existing = attendanceFor(studentId, day);
    if (existing) attendance.update(existing.id, { present });
    else attendance.add({ studentId, date: day, present });
  }

  function markWholeClass(present: boolean) {
    for (const s of roster) mark(s.id, present);
    setNote('Marked all of ' + cls + '-' + section + ' as ' + (present ? 'present' : 'absent') + ' for ' + day + '.');
  }

  function setMark(studentId: string, subject: string, value: string) {
    const got = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const existing = marks.items.find((m) => m.studentId === studentId && m.exam === exam && m.subject === subject);
    if (existing) marks.update(existing.id, { got });
    else marks.add({ studentId, exam, subject, got, outOf: 100 });
  }

  function markOf(studentId: string, subject: string): Mark | null {
    return marks.items.find((m) => m.studentId === studentId && m.exam === exam && m.subject === subject) || null;
  }

  function feeFor(studentCls: string, t: string): number {
    const rule = feeRules.items.find((f) => f.cls === studentCls && f.term === t);
    return rule ? rule.amount : 0;
  }

  function paidBy(studentId: string, t: string): number {
    return payments.items.filter((p) => p.studentId === studentId && p.term === t).reduce((s, p) => s + p.amount, 0);
  }

  function nextFeeReceipt(): string {
    const highest = payments.items.reduce((max, p) => {
      const n = parseInt(p.receiptNo.replace(/[^0-9]/g, ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    return 'F-' + String(highest + 1).padStart(4, '0');
  }

  function collectFee(s: Student) {
    const due = feeFor(s.cls, term) - paidBy(s.id, term);
    if (due <= 0) { setNote(s.name + ' has no dues for ' + term + '.'); return; }
    const made = payments.add({ studentId: s.id, term, amount: due, date: new Date().toISOString().slice(0, 10), receiptNo: nextFeeReceipt() });
    setNote('Receipt ' + made.receiptNo + ' — ' + inr(due) + ' collected from ' + s.name + '.');
  }

  function admit() {
    if (!form.name.trim()) { setNote('A student needs a name.'); return; }
    students.add({
      name: form.name.trim(),
      admNo: form.admNo.trim() || 'ADM-' + Math.floor(1000 + Math.random() * 8999),
      roll: Math.max(1, Math.round(Number(form.roll) || roster.length + 1)),
      cls, section,
      parent: form.parent.trim(),
      parentPhone: form.parentPhone.trim(),
    });
    setForm({ name: '', admNo: '', roll: '', parent: '', parentPhone: '' });
    setNote('Admitted to ' + cls + '-' + section + '.');
  }

  const todayMarked = roster.filter((s) => attendanceFor(s.id, day));
  const todayPresent = roster.filter((s) => { const a = attendanceFor(s.id, day); return a && a.present; });
  const todayPct = todayMarked.length ? Math.round((todayPresent.length / todayMarked.length) * 100) : 0;

  const termCollected = useMemo(
    () => payments.items.filter((p) => p.term === term).reduce((s, p) => s + p.amount, 0),
    [payments.items, term],
  );
  const termPending = useMemo(
    () => students.items.reduce((s, st) => s + Math.max(0, feeFor(st.cls, term) - paidBy(st.id, term)), 0),
    [students.items, payments.items, feeRules.items, term],
  );

  const card = cardFor ? students.items.find((s) => s.id === cardFor) || null : null;
  const cardRows = card ? SUBJECTS.map((sub) => markOf(card.id, sub)).filter((m): m is Mark => m !== null) : [];
  const cardTotal = cardRows.reduce((s, m) => s + m.got, 0);
  const cardOutOf = cardRows.reduce((s, m) => s + m.outOf, 0);
  const cardPct = cardOutOf > 0 ? Math.round((cardTotal / cardOutOf) * 100) : 0;

  function exportClassList() {
    const nl = String.fromCharCode(10);
    const cell = (v: string) => '"' + v.split('"').join('""') + '"';
    const head = ['Roll', 'Admission no', 'Name', 'Class', 'Parent', 'Phone', 'Attendance %'].map(cell).join(',');
    const rows = roster.map((s) => [String(s.roll), s.admNo, s.name, s.cls + '-' + s.section, s.parent, s.parentPhone, String(attendancePct(s.id))].map(cell).join(',')).join(nl);
    const blob = new Blob([head + nl + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'class-' + cls + '-' + section + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNote('Class list exported.');
  }

  const classPicker = (
    <Card>
      <Select label="Class" value={cls} onChange={setCls} options={CLASSES.map((c) => ({ value: c, label: 'Class ' + c }))} />
      <Select label="Section" value={section} onChange={setSection} options={SECTIONS.map((x) => ({ value: x, label: 'Section ' + x }))} />
    </Card>
  );

  return (
    <Shell
      brand="School Office"
      nav={[
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'students', label: 'Students' },
        { id: 'attendance', label: 'Attendance' },
        { id: 'marks', label: 'Marks' },
        { id: 'fees', label: 'Fees' },
        { id: 'teachers', label: 'Teachers' },
      ]}
      active={screen}
      onNavigate={(id) => { setScreen(id); setCardFor(null); }}
      actions={<ThemeToggle />}
    >
      {note && <Card><span>{note}</span></Card>}

      {screen === 'dashboard' && (
        <>
          <StatRow>
            <StatTile label="Students" value={String(students.items.length)} />
            <StatTile label={'Attendance ' + cls + '-' + section} value={todayPct + '%'} hint={todayMarked.length + ' marked on ' + day} />
            <StatTile label={'Collected in ' + term} value={inr(termCollected)} />
            <StatTile label={'Pending in ' + term} value={inr(termPending)} />
          </StatRow>
          <Card title="Find a student">
            <Field label="Name, admission number or parent phone" value={query} onChange={setQuery} placeholder="ADM-1042" />
            {query.trim() === '' ? (
              <Empty>Type to search across every class.</Empty>
            ) : found.length === 0 ? (
              <Empty>No student matches that.</Empty>
            ) : found.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <strong>{s.name}</strong>
                <Badge tone="neutral">{s.cls}-{s.section}</Badge>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{s.admNo} · {s.parent} {s.parentPhone}</span>
                <span style={{ marginLeft: 'auto' }}><Badge tone={attendancePct(s.id) >= 75 ? 'good' : 'warn'}>{attendancePct(s.id)}%</Badge></span>
              </div>
            ))}
          </Card>
        </>
      )}

      {screen === 'students' && (
        <>
          {classPicker}
          <Card title={'Class ' + cls + '-' + section} actions={<Button variant="ghost" onClick={exportClassList}>Export CSV</Button>}>
            {roster.length === 0 ? <Empty>No students enrolled in this class yet.</Empty> : roster.map((s) => (
              <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--muted)', minWidth: 26 }}>{s.roll}</span>
                <strong>{s.name}</strong>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{s.admNo} · {s.parent} {s.parentPhone}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <Badge tone={attendancePct(s.id) >= 75 ? 'good' : 'warn'}>{attendancePct(s.id)}%</Badge>
                  <Button variant="ghost" onClick={() => { setCardFor(s.id); setScreen('marks'); }}>Report card</Button>
                </span>
              </div>
            ))}
          </Card>
          <Card title="Admit a student into this class">
            <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Admission number" value={form.admNo} onChange={(v) => setForm({ ...form, admNo: v })} placeholder="left blank, one is generated" />
            <Field label="Roll number" value={form.roll} onChange={(v) => setForm({ ...form, roll: v })} type="number" />
            <Field label="Parent name" value={form.parent} onChange={(v) => setForm({ ...form, parent: v })} />
            <Field label="Parent phone" value={form.parentPhone} onChange={(v) => setForm({ ...form, parentPhone: v })} />
            <Button onClick={admit}>Admit</Button>
          </Card>
        </>
      )}

      {screen === 'attendance' && (
        <>
          {classPicker}
          <Card
            title={'Attendance for ' + cls + '-' + section}
            actions={<span style={{ display: 'flex', gap: 6 }}>
              <Button variant="ghost" onClick={() => markWholeClass(true)}>All present</Button>
              <Button variant="ghost" onClick={() => markWholeClass(false)}>All absent</Button>
            </span>}
          >
            <Field label="Date" value={day} onChange={setDay} type="date" />
            {roster.length === 0 ? <Empty>No students in this class.</Empty> : roster.map((s) => {
              const a = attendanceFor(s.id, day);
              return (
                <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--muted)', minWidth: 26 }}>{s.roll}</span>
                  <strong>{s.name}</strong>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {a ? <Badge tone={a.present ? 'good' : 'bad'}>{a.present ? 'Present' : 'Absent'}</Badge> : <Badge tone="neutral">Not marked</Badge>}
                    <Button variant="ghost" onClick={() => mark(s.id, true)}>P</Button>
                    <Button variant="ghost" onClick={() => mark(s.id, false)}>A</Button>
                  </span>
                </div>
              );
            })}
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '10px 0 0' }}>
              Each day is stored on its own, so correcting a wrongly marked day updates the percentage by itself.
            </p>
          </Card>
        </>
      )}

      {screen === 'marks' && (
        <>
          {classPicker}
          <Card title="Exam">
            <Select label="Exam" value={exam} onChange={setExam} options={EXAMS.map((e) => ({ value: e, label: e }))} />
          </Card>
          {card ? (
            <Card title={'Report card — ' + card.name + ' (' + exam + ')'} actions={<Button variant="ghost" onClick={() => setCardFor(null)}>Back to entry</Button>}>
              {cardRows.length === 0 ? <Empty>No marks entered for this exam yet.</Empty> : (
                <>
                  {cardRows.map((m) => (
                    <div key={m.id} style={{ display: 'flex', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                      <span>{m.subject}</span>
                      <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{m.got} / {m.outOf}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 10, paddingTop: 10, alignItems: 'center' }}>
                    <strong>Total {cardTotal} / {cardOutOf}</strong>
                    <Badge tone={cardPct >= 60 ? 'good' : cardPct >= 33 ? 'warn' : 'bad'}>{cardPct}% · {gradeFor(cardPct)}</Badge>
                    <span style={{ marginLeft: 'auto' }}><Button onClick={() => window.print()}>Print</Button></span>
                  </div>
                </>
              )}
            </Card>
          ) : (
            <Card title={'Enter marks — ' + exam}>
              {roster.length === 0 ? <Empty>No students in this class.</Empty> : roster.map((s) => (
                <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                    <strong>{s.name}</strong>
                    <span style={{ marginLeft: 'auto' }}><Button variant="ghost" onClick={() => setCardFor(s.id)}>Report card</Button></span>
                  </div>
                  <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
                    {SUBJECTS.map((sub) => {
                      const m = markOf(s.id, sub);
                      return (
                        <label key={sub} style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {sub}
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={m ? String(m.got) : ''}
                            onChange={(e) => setMark(s.id, sub, e.target.value)}
                            style={{ width: '100%', padding: '7px 9px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg)' }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {screen === 'fees' && (
        <>
          {classPicker}
          <Card title="Term">
            <Select label="Term" value={term} onChange={setTerm} options={TERMS.map((t) => ({ value: t, label: t }))} />
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              Fee for class {cls}, {term}: <strong>{inr(feeFor(cls, term))}</strong>
            </p>
          </Card>
          <Card title={'Dues — ' + cls + '-' + section + ', ' + term}>
            {roster.length === 0 ? <Empty>No students in this class.</Empty> : roster.map((s) => {
              const due = Math.max(0, feeFor(s.cls, term) - paidBy(s.id, term));
              return (
                <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                  <strong>{s.name}</strong>
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>paid {inr(paidBy(s.id, term))}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Badge tone={due === 0 ? 'good' : 'bad'}>{due === 0 ? 'Cleared' : inr(due) + ' due'}</Badge>
                    {due > 0 && <Button onClick={() => collectFee(s)}>Collect</Button>}
                  </span>
                </div>
              );
            })}
          </Card>
        </>
      )}

      {screen === 'teachers' && (
        teachers.items.length === 0 ? <Card><Empty>No teachers on record.</Empty></Card> : (
          teachers.items.map((t) => (
            <Card key={t.id}>
              <strong>{t.name}</strong>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0' }}>Teaches {t.subjects}</p>
            </Card>
          ))
        )
      )}
    </Shell>
  );
}
`;
