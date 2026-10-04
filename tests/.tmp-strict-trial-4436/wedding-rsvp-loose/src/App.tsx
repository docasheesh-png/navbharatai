import { useMemo, useState } from 'react';
import ThemeToggle from './theme';

// An Indian wedding is SEVERAL functions, not one, and a guest is invited to only some of them — so the
// number a caterer actually needs is a head count PER EVENT. A single "120 guests" figure is the thing
// this app exists to replace, which is why every total below is computed per function.
const EVENTS = [
  { id: 'mehendi', label: 'Mehendi' },
  { id: 'haldi', label: 'Haldi' },
  { id: 'sangeet', label: 'Sangeet' },
  { id: 'wedding', label: 'Shaadi (Wedding)' },
  { id: 'reception', label: 'Reception' },
];

type Rsvp = 'invited' | 'coming' | 'no' | 'pending';

const RSVP_LABEL: Record<Rsvp, string> = {
  invited: 'Nimantran bheja (Invited)',
  coming: 'Aa rahe hain (Coming)',
  no: 'Nahi aa rahe (Not coming)',
  pending: 'Jawab nahi aaya (No reply)',
};

interface Guest {
  id: string;
  name: string;
  phone: string;
  side: 'bride' | 'groom';
  // People coming WITH this guest. The head count is 1 + extra, so a family of four is one row.
  extra: number;
  events: string[];
  rsvp: Rsvp;
}

const KEY = 'shaadi-guests-v1';

const SEED: Guest[] = [
  { id: 'g1', name: 'Sharma ji parivaar', phone: '9810012345', side: 'bride', extra: 3, events: ['mehendi', 'sangeet', 'wedding', 'reception'], rsvp: 'coming' },
  { id: 'g2', name: 'Anil Verma', phone: '9820098765', side: 'groom', extra: 1, events: ['wedding', 'reception'], rsvp: 'pending' },
  { id: 'g3', name: 'Meera Nair', phone: '9745511223', side: 'bride', extra: 0, events: ['haldi', 'wedding'], rsvp: 'no' },
  { id: 'g4', name: 'Gupta Uncle', phone: '9900112233', side: 'groom', extra: 2, events: ['sangeet', 'wedding'], rsvp: 'invited' },
];

function loadGuests(): Guest[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return SEED;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Guest[]) : SEED;
  } catch {
    // A corrupted entry must never throw during the first render — that blanks the whole app.
    return SEED;
  }
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export default function App() {
  const [guests, setGuests] = useState<Guest[]>(loadGuests);
  const [side, setSide] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', side: 'bride', extra: '0', events: ['wedding'] as string[] });
  const [note, setNote] = useState('');

  function persist(next: Guest[]) {
    setGuests(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode — keep working in memory */ }
  }

  function addGuest() {
    const name = form.name.trim();
    if (!name) { setNote('Naam likhna zaroori hai (name is required).'); return; }
    if (form.events.length === 0) { setNote('Kam se kam ek function chunein (pick at least one event).'); return; }
    const extra = Math.max(0, Math.floor(Number(form.extra) || 0));
    persist([{ id: newId(), name, phone: form.phone.trim(), side: form.side as Guest['side'], extra, events: form.events.slice(), rsvp: 'invited' }, ...guests]);
    setForm({ name: '', phone: '', side: form.side, extra: '0', events: ['wedding'] });
    setNote(name + ' jud gaye (added).');
  }

  function setRsvp(id: string, rsvp: Rsvp) {
    persist(guests.map((g) => (g.id === id ? { ...g, rsvp } : g)));
  }

  function removeGuest(id: string) {
    persist(guests.filter((g) => g.id !== id));
  }

  function toggleFormEvent(id: string) {
    setForm((f) => ({ ...f, events: f.events.includes(id) ? f.events.filter((e) => e !== id) : [...f.events, id] }));
  }

  // Per-event head count: ONLY confirmed guests count, and each row contributes 1 + the people with them.
  // Counting "invited" or "no reply" here is how a caterer ends up cooking for people who never came.
  const perEvent = useMemo(
    () => EVENTS.map((ev) => {
      const rows = guests.filter((g) => g.rsvp === 'coming' && g.events.includes(ev.id));
      const heads = rows.reduce((sum, g) => sum + 1 + g.extra, 0);
      const awaited = guests.filter((g) => g.events.includes(ev.id) && (g.rsvp === 'invited' || g.rsvp === 'pending')).length;
      return { ...ev, heads, rows: rows.length, awaited };
    }),
    [guests],
  );

  const totals = useMemo(() => {
    const confirmed = guests.filter((g) => g.rsvp === 'coming');
    return {
      invited: guests.length,
      confirmedRows: confirmed.length,
      confirmedHeads: confirmed.reduce((sum, g) => sum + 1 + g.extra, 0),
      declined: guests.filter((g) => g.rsvp === 'no').length,
      waiting: guests.filter((g) => g.rsvp === 'invited' || g.rsvp === 'pending').length,
    };
  }, [guests]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guests.filter((g) => {
      if (side !== 'all' && g.side !== side) return false;
      if (eventFilter !== 'all' && !g.events.includes(eventFilter)) return false;
      if (status !== 'all' && g.rsvp !== status) return false;
      if (q && !(g.name.toLowerCase().includes(q) || g.phone.includes(q))) return false;
      return true;
    });
  }, [guests, side, eventFilter, status, query]);

  function exportCsv() {
    const nl = String.fromCharCode(10);
    const cell = (v: string) => '"' + v.split('"').join('""') + '"';
    const head = ['Name', 'Phone', 'Side', 'With them', 'Head count', 'Events', 'RSVP'].map(cell).join(',');
    const body = guests.map((g) => [
      g.name, g.phone, g.side === 'bride' ? 'Bride side' : 'Groom side',
      String(g.extra), String(1 + g.extra),
      g.events.map((id) => { const e = EVENTS.find((x) => x.id === id); return e ? e.label : id; }).join(' + '),
      RSVP_LABEL[g.rsvp],
    ].map(cell).join(',')).join(nl);
    const blob = new Blob([head + nl + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shaadi-guest-list.csv';
    a.click();
    URL.revokeObjectURL(url);
    setNote('CSV download ho gaya (exported ' + guests.length + ' guests).');
  }

  return (
    <div className="container" style={{ maxWidth: 920, paddingTop: 28, paddingBottom: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Shaadi RSVP</h1>
        <ThemeToggle />
      </div>

      {note && <div className="alert alert-success" style={{ marginBottom: 12 }}>{note}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <strong>Har function ka head count (per-event head count)</strong>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          Sirf confirmed mehmaan gine jaate hain (only confirmed guests are counted) — har row ke saath aane wale log bhi.
        </p>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginTop: 10 }}>
          {perEvent.map((ev) => (
            <div key={ev.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{ev.label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, marginTop: 2 }}>{ev.heads}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{ev.rows} confirmed · {ev.awaited} jawab baaki</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
          <span><strong>{totals.invited}</strong> nimantran (invited)</span>
          <span><strong>{totals.confirmedHeads}</strong> aa rahe hain (coming)</span>
          <span><strong>{totals.waiting}</strong> jawab baaki (awaiting)</span>
          <span><strong>{totals.declined}</strong> nahi aa rahe (declined)</span>
          <button onClick={exportCsv} style={{ marginLeft: 'auto' }}>CSV export</button>
        </div>
      </div>

      <div className="card stack" style={{ marginBottom: 16 }}>
        <strong>Naya mehmaan jodein (add a guest)</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input aria-label="Naam (name)" placeholder="Naam (name)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: '2 1 180px' }} />
          <input aria-label="Phone" placeholder="Phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={{ flex: '1 1 130px' }} />
          <select aria-label="Kis taraf se (side)" value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })} style={{ flex: '1 1 130px' }}>
            <option value="bride">Ladki ki taraf (bride)</option>
            <option value="groom">Ladke ki taraf (groom)</option>
          </select>
          <input type="number" aria-label="Saath aane wale (extra guests)" min={0} placeholder="Saath aane wale" value={form.extra} onChange={(e) => setForm({ ...form, extra: e.target.value })} style={{ flex: '1 1 110px' }} />
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {EVENTS.map((ev) => (
            <label key={ev.id} className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={form.events.includes(ev.id)} onChange={() => toggleFormEvent(ev.id)} />
              <span>{ev.label}</span>
            </label>
          ))}
        </div>
        <button onClick={addGuest}>Jodein (Add guest)</button>
      </div>

      <div className="card stack">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input aria-label="Naam ya phone se dhoondein (search)" placeholder="Naam ya phone se dhoondein (search)" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: '2 1 200px' }} />
          <select aria-label="Taraf se chhaantein (filter by side)" value={side} onChange={(e) => setSide(e.target.value)} style={{ flex: '1 1 130px' }}>
            <option value="all">Dono taraf (both sides)</option>
            <option value="bride">Ladki ki taraf</option>
            <option value="groom">Ladke ki taraf</option>
          </select>
          <select aria-label="Function se chhaantein (filter by event)" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} style={{ flex: '1 1 140px' }}>
            <option value="all">Sabhi function (all events)</option>
            {EVENTS.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
          </select>
          <select aria-label="RSVP se chhaantein (filter by RSVP)" value={status} onChange={(e) => setStatus(e.target.value)} style={{ flex: '1 1 150px' }}>
            <option value="all">Sabhi RSVP</option>
            <option value="coming">Aa rahe hain</option>
            <option value="pending">Jawab nahi aaya</option>
            <option value="invited">Nimantran bheja</option>
            <option value="no">Nahi aa rahe</option>
          </select>
        </div>

        {visible.length === 0 ? (
          <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>
            Is filter me koi mehmaan nahi (no guests match this filter).
          </p>
        ) : (
          <div className="stack">
            {visible.map((g) => (
              <div key={g.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong>{g.name}</strong>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {g.phone || 'phone nahi'} · {g.side === 'bride' ? 'Ladki ki taraf' : 'Ladke ki taraf'} · {1 + g.extra} log
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
                      {g.events.map((id) => { const e = EVENTS.find((x) => x.id === id); return e ? e.label : id; }).join(' + ')}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <select aria-label="RSVP badlein (change RSVP)" value={g.rsvp} onChange={(e) => setRsvp(g.id, e.target.value as Rsvp)}>
                      <option value="invited">Nimantran bheja</option>
                      <option value="pending">Jawab nahi aaya</option>
                      <option value="coming">Aa rahe hain</option>
                      <option value="no">Nahi aa rahe</option>
                    </select>
                    <button onClick={() => removeGuest(g.id)}>Hatayein</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
