import { useMemo, useState } from 'react';
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
  const [planId, setPlanId] = useState(() => {
    try { return localStorage.getItem('saas.plan') || 'growth'; } catch { return 'growth'; }
  });
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
