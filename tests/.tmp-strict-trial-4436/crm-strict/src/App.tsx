import { useMemo, useState } from 'react';
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
