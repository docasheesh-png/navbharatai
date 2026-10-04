import { useMemo, useState } from 'react';
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
