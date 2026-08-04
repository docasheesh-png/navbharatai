// AgentV3 — Golden Scaffolds: PRO-tier apps, batch E (community forum, events platform, LMS).
//
// The last three pro chips. Same contract as every earlier batch: a real working app on the shared pro
// foundation (proShell.ts), never a mockup. With these, EVERY starter chip a user can click — simple and
// pro alike — starts from something already proven to compile and run.

export const communityAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, shortDate, newId, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface Reply { id: string; author: string; text: string; at: string; votes: number }
interface Topic extends Entity {
  title: string; body: string; author: string; tag: string; at: string;
  votes: number; replies: Reply[]; locked: boolean;
}

const ME = 'You';
const TAGS = ['General', 'Help', 'Showcase', 'Feedback'];

const SEED: Topic[] = [
  {
    id: 't1', title: 'How do you handle offline data in a village app?', body: 'Network drops constantly. What has worked for you?',
    author: 'Rohit', tag: 'Help', at: '2026-08-02', votes: 12, locked: false,
    replies: [{ id: 'r1', author: 'Asha', text: 'Queue writes locally and sync when the connection returns.', at: '2026-08-02', votes: 5 }],
  },
  {
    id: 't2', title: 'Built a clinic booking app in a weekend', body: 'Sharing what I learned.',
    author: 'Meera', tag: 'Showcase', at: '2026-08-01', votes: 8, locked: false, replies: [],
  },
];

export default function App() {
  const topics = useCollection<Topic>('forum.topics', SEED);
  const [tag, setTag] = useState('all');
  const [sort, setSort] = useState('top');
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', tag: 'General' });
  const [replyText, setReplyText] = useState('');

  /** Reputation is EARNED from real activity, never stored — it can never drift from what happened. */
  const reputation = useMemo(() => {
    const map = new Map<string, number>();
    const bump = (who: string, by: number) => map.set(who, (map.get(who) || 0) + by);
    for (const t of topics.items) {
      bump(t.author, t.votes);
      for (const r of t.replies) bump(r.author, r.votes);
    }
    return map;
  }, [topics.items]);

  const visible = useMemo(() => {
    const list = topics.items.filter((t) => tag === 'all' || t.tag === tag);
    return sort === 'top'
      ? [...list].sort((a, b) => b.votes - a.votes)
      : [...list].sort((a, b) => b.at.localeCompare(a.at));
  }, [topics.items, tag, sort]);

  const open = openId ? topics.items.find((t) => t.id === openId) || null : null;

  function post() {
    if (!form.title.trim()) return;
    topics.add({
      title: form.title.trim(), body: form.body.trim(), author: ME, tag: form.tag,
      at: new Date().toISOString().slice(0, 10), votes: 0, replies: [], locked: false,
    });
    setForm({ title: '', body: '', tag: 'General' });
    setComposing(false);
  }

  function reply() {
    if (!open || !replyText.trim() || open.locked) return;
    const r: Reply = { id: newId(), author: ME, text: replyText.trim(), at: new Date().toISOString().slice(0, 10), votes: 0 };
    topics.update(open.id, { replies: [...open.replies, r] });
    setReplyText('');
  }

  return (
    <Shell
      brand="Chaupal Forum"
      nav={[{ id: 'all', label: 'All topics' }, ...TAGS.map((t) => ({ id: t, label: t }))]}
      active={tag}
      onNavigate={setTag}
      actions={<ThemeToggle />}
    >
      <Card actions={<Button onClick={() => setComposing(true)}>New topic</Button>} title="Sort">
        <Select
          label="Order"
          value={sort}
          onChange={setSort}
          options={[{ value: 'top', label: 'Most upvoted' }, { value: 'new', label: 'Newest' }]}
        />
      </Card>

      {visible.length === 0 ? (
        <Empty>No topics here yet — start one.</Empty>
      ) : visible.map((t) => (
        <Card key={t.id}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'center', minWidth: 44 }}>
              <button onClick={() => topics.update(t.id, { votes: t.votes + 1 })} aria-label="Upvote" style={{ padding: '2px 8px' }}>▲</button>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{t.votes}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <button
                onClick={() => setOpenId(t.id)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--fg)', textAlign: 'left', fontWeight: 700, fontSize: 15 }}
              >
                {t.title}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                <Badge tone="accent">{t.tag}</Badge>
                {t.locked && <Badge tone="warn">locked</Badge>}
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {t.author} ({reputation.get(t.author) || 0} rep) · {shortDate(t.at)} · {t.replies.length} repl{t.replies.length === 1 ? 'y' : 'ies'}
                </span>
              </div>
            </div>
          </div>
        </Card>
      ))}

      {composing && (
        <Modal title="New topic" onClose={() => setComposing(false)}>
          <Field label="Title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} />
          <Field label="Body" value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
          <Select label="Tag" value={form.tag} onChange={(v) => setForm({ ...form, tag: v })} options={TAGS.map((t) => ({ value: t, label: t }))} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={post}>Post</Button>
            <Button variant="ghost" onClick={() => setComposing(false)}>Cancel</Button>
          </div>
        </Modal>
      )}

      {open && (
        <Modal title={open.title} onClose={() => setOpenId(null)}>
          {open.body && <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 0 }}>{open.body}</p>}
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{open.author} · {shortDate(open.at)}</div>
          {open.replies.map((r) => (
            <div key={r.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
              <div style={{ fontSize: 14 }}>{r.text}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>{r.author} · {shortDate(r.at)}</span>
                <button
                  onClick={() => topics.update(open.id, { replies: open.replies.map((x) => (x.id === r.id ? { ...x, votes: x.votes + 1 } : x)) })}
                  style={{ padding: '2px 8px', fontSize: 12 }}
                >
                  ▲ {r.votes}
                </button>
              </div>
            </div>
          ))}
          {open.locked ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>This topic is locked — no new replies.</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              <Field label="Reply" value={replyText} onChange={setReplyText} placeholder="Share what you know" />
              <Button onClick={reply}>Post reply</Button>
            </div>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={() => topics.update(open.id, { locked: !open.locked })}>
              {open.locked ? 'Unlock' : 'Lock topic'}
            </Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
`;

export const eventsAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Field, Select, Modal, Empty } from './lib/ui';
import { useCollection, inr, shortDate, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface TicketType { id: string; name: string; price: number; capacity: number }
interface Event extends Entity { title: string; venue: string; on: string; about: string; tickets: TicketType[] }
interface Registration extends Entity {
  eventId: string; ticketId: string; name: string; email: string; code: string; checkedIn: boolean;
}

const SEED_EVENTS: Event[] = [
  {
    id: 'e1', title: 'Jaipur Dev Meetup', venue: 'Central Park, Jaipur', on: '2026-09-14',
    about: 'Talks on building for the next billion users, then chai.',
    tickets: [
      { id: 'tt1', name: 'Free entry', price: 0, capacity: 80 },
      { id: 'tt2', name: 'Supporter', price: 500, capacity: 20 },
    ],
  },
];

/** A short human-readable code the organiser can check at the gate. */
function ticketCode(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function App() {
  const events = useCollection<Event>('events.list', SEED_EVENTS);
  const regs = useCollection<Registration>('events.regs', []);
  const [screen, setScreen] = useState('events');
  const [openId, setOpenId] = useState<string | null>(null);
  const [ticketId, setTicketId] = useState('');
  const [form, setForm] = useState({ name: '', email: '' });
  const [checkCode, setCheckCode] = useState('');
  const [checkResult, setCheckResult] = useState('');

  const open = openId ? events.items.find((e) => e.id === openId) || null : null;

  /** Seats left = capacity minus real registrations. Never a stored counter that can drift. */
  const soldFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of regs.items) map.set(r.ticketId, (map.get(r.ticketId) || 0) + 1);
    return map;
  }, [regs.items]);

  const revenue = useMemo(() => {
    let total = 0;
    for (const r of regs.items) {
      const ev = events.items.find((e) => e.id === r.eventId);
      const tt = ev?.tickets.find((t) => t.id === r.ticketId);
      if (tt) total += tt.price;
    }
    return total;
  }, [regs.items, events.items]);

  function register() {
    if (!open || !ticketId || !form.name.trim()) return;
    const tt = open.tickets.find((t) => t.id === ticketId);
    if (!tt) return;
    // Capacity is re-checked at the moment of writing — the last seat can go while this form is open.
    if ((soldFor.get(ticketId) || 0) >= tt.capacity) return;
    regs.add({ eventId: open.id, ticketId, name: form.name.trim(), email: form.email.trim(), code: ticketCode(), checkedIn: false });
    setForm({ name: '', email: '' });
    setTicketId('');
    setOpenId(null);
    setScreen('tickets');
  }

  function checkIn() {
    const code = checkCode.trim().toUpperCase();
    const found = regs.items.find((r) => r.code === code);
    if (!found) { setCheckResult('No ticket with that code.'); return; }
    if (found.checkedIn) { setCheckResult(found.name + ' was already checked in.'); return; }
    regs.update(found.id, { checkedIn: true });
    setCheckResult('Welcome, ' + found.name + '.');
    setCheckCode('');
  }

  return (
    <Shell
      brand="Events"
      nav={[
        { id: 'events', label: 'Events' },
        { id: 'tickets', label: 'My tickets (' + regs.items.length + ')' },
        { id: 'organiser', label: 'Organiser' },
      ]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      {screen === 'events' && (
        events.items.length === 0 ? <Empty>No events yet.</Empty> : events.items.map((e) => (
          <Card key={e.id}>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{e.title}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 10px' }}>
              {shortDate(e.on)} · {e.venue}
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.5, margin: '0 0 12px' }}>{e.about}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {e.tickets.map((t) => {
                const left = t.capacity - (soldFor.get(t.id) || 0);
                return <Badge key={t.id} tone={left > 0 ? 'accent' : 'bad'}>{t.name} · {t.price === 0 ? 'Free' : inr(t.price)} · {left} left</Badge>;
              })}
            </div>
            <Button onClick={() => { setOpenId(e.id); setTicketId(e.tickets[0]?.id || ''); }}>Register</Button>
          </Card>
        ))
      )}

      {screen === 'tickets' && (
        <Card title="Your tickets">
          {regs.items.length === 0 ? (
            <Empty>No tickets yet.</Empty>
          ) : regs.items.map((r) => {
            const ev = events.items.find((e) => e.id === r.eventId);
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{ev ? ev.title : 'Event'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.name} · code {r.code}</div>
                </div>
                <Badge tone={r.checkedIn ? 'good' : 'accent'}>{r.checkedIn ? 'checked in' : 'valid'}</Badge>
              </div>
            );
          })}
        </Card>
      )}

      {screen === 'organiser' && (
        <>
          <StatRow>
            <StatTile label="Registrations" value={String(regs.items.length)} />
            <StatTile label="Checked in" value={String(regs.items.filter((r) => r.checkedIn).length)} />
            <StatTile label="Revenue" value={inr(revenue)} />
          </StatRow>
          <Card title="Check in a guest">
            <Field label="Ticket code" value={checkCode} onChange={(v) => { setCheckCode(v); setCheckResult(''); }} placeholder="A1B2-C3D4" />
            <Button onClick={checkIn}>Check in</Button>
            {checkResult && <p style={{ fontSize: 14, marginBottom: 0 }}>{checkResult}</p>}
          </Card>
          <Card title="Attendees">
            {regs.items.length === 0 ? (
              <Empty>Nobody has registered yet.</Empty>
            ) : regs.items.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ flex: 1, fontSize: 14 }}>{r.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.email || 'no email'}</span>
                <Badge tone={r.checkedIn ? 'good' : 'neutral'}>{r.code}</Badge>
              </div>
            ))}
          </Card>
        </>
      )}

      {open && (
        <Modal title={'Register — ' + open.title} onClose={() => setOpenId(null)}>
          <Select
            label="Ticket"
            value={ticketId}
            onChange={setTicketId}
            options={open.tickets.map((t) => ({
              value: t.id,
              label: t.name + ' · ' + (t.price === 0 ? 'Free' : inr(t.price)) + ' · ' + (t.capacity - (soldFor.get(t.id) || 0)) + ' left',
            }))}
          />
          <Field label="Your name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Button onClick={register}>Confirm</Button>
            <Button variant="ghost" onClick={() => setOpenId(null)}>Cancel</Button>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
`;

export const lmsAppTsx = `import { useMemo, useState } from 'react';
import { Shell, Card, StatTile, StatRow, Badge, Button, Empty } from './lib/ui';
import { useCollection, type Entity } from './lib/store';
import ThemeToggle from './theme';

interface Question { id: string; prompt: string; options: string[]; answer: number }
interface Lesson { id: string; title: string; content: string }
interface Course extends Entity { title: string; about: string; lessons: Lesson[]; quiz: Question[] }
interface Progress extends Entity { courseId: string; doneLessons: string[]; score: number | null }

const SEED_COURSES: Course[] = [
  {
    id: 'c1', title: 'Start a small business online', about: 'Four short lessons on getting your shop onto the internet.',
    lessons: [
      { id: 'l1', title: 'Why go online', content: 'Your customers already search online before they buy. Being findable is most of the work.' },
      { id: 'l2', title: 'Pick what to sell', content: 'Start with the three things you sell most. Do not put your whole catalogue up on day one.' },
      { id: 'l3', title: 'Taking payments', content: 'Offer UPI first — it is what most customers in India already use every day.' },
      { id: 'l4', title: 'Getting your first orders', content: 'Tell your existing customers first. A WhatsApp message beats an ad for your first ten orders.' },
    ],
    quiz: [
      { id: 'q1', prompt: 'What should you put online first?', options: ['Your entire catalogue', 'Your three best sellers', 'Nothing until it is perfect'], answer: 1 },
      { id: 'q2', prompt: 'Which payment method should you offer first in India?', options: ['UPI', 'Cheque', 'Foreign cards'], answer: 0 },
    ],
  },
];

export default function App() {
  const courses = useCollection<Course>('lms.courses', SEED_COURSES);
  const progress = useCollection<Progress>('lms.progress', []);
  const [screen, setScreen] = useState('catalog');
  const [courseId, setCourseId] = useState<string | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [graded, setGraded] = useState(false);

  const course = courseId ? courses.items.find((c) => c.id === courseId) || null : null;
  const lesson = course && lessonId ? course.lessons.find((l) => l.id === lessonId) || null : null;

  const progressFor = (id: string) => progress.items.find((p) => p.courseId === id) || null;

  const percent = useMemo(() => {
    if (!course) return 0;
    const p = progressFor(course.id);
    return Math.round(((p?.doneLessons.length || 0) / Math.max(1, course.lessons.length)) * 100);
  }, [course, progress.items]);

  function enrol(c: Course) {
    if (!progressFor(c.id)) progress.add({ courseId: c.id, doneLessons: [], score: null });
    setCourseId(c.id);
    setLessonId(c.lessons[0]?.id || null);
    setAnswers({});
    setGraded(false);
    setScreen('learn');
  }

  function markDone(l: Lesson) {
    if (!course) return;
    const p = progressFor(course.id);
    if (!p || p.doneLessons.includes(l.id)) return;
    progress.update(p.id, { doneLessons: [...p.doneLessons, l.id] });
  }

  function grade() {
    if (!course) return;
    const right = course.quiz.filter((q) => answers[q.id] === q.answer).length;
    const score = Math.round((right / Math.max(1, course.quiz.length)) * 100);
    const p = progressFor(course.id);
    if (p) progress.update(p.id, { score });
    setGraded(true);
  }

  const enrolled = progress.items.length;
  const completed = progress.items.filter((p) => {
    const c = courses.items.find((x) => x.id === p.courseId);
    return c && p.doneLessons.length >= c.lessons.length;
  }).length;

  return (
    <Shell
      brand="Learn"
      nav={[{ id: 'catalog', label: 'Courses' }, { id: 'learn', label: 'My learning' }]}
      active={screen}
      onNavigate={setScreen}
      actions={<ThemeToggle />}
    >
      <StatRow>
        <StatTile label="Enrolled" value={String(enrolled)} />
        <StatTile label="Completed" value={String(completed)} />
        <StatTile label="Courses" value={String(courses.items.length)} />
      </StatRow>

      {screen === 'catalog' && (
        courses.items.length === 0 ? <Empty>No courses yet.</Empty> : courses.items.map((c) => {
          const p = progressFor(c.id);
          return (
            <Card key={c.id}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{c.title}</div>
              <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5, margin: '6px 0 10px' }}>{c.about}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Badge tone="accent">{c.lessons.length} lessons</Badge>
                <Badge>{c.quiz.length} quiz questions</Badge>
                {p && <Badge tone="good">{p.doneLessons.length}/{c.lessons.length} done</Badge>}
              </div>
              <Button onClick={() => enrol(c)}>{p ? 'Continue' : 'Start course'}</Button>
            </Card>
          );
        })
      )}

      {screen === 'learn' && (
        !course ? (
          <Empty>Pick a course from the catalog to begin.</Empty>
        ) : (
          <>
            <Card title={course.title}>
              <div style={{ height: 8, borderRadius: 999, background: 'var(--accent-soft)', overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ width: percent + '%', height: '100%', background: 'var(--accent)' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{percent}% complete</div>
            </Card>

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(190px,1fr) 2fr' }} className="nb-lms">
              <Card title="Lessons">
                {course.lessons.map((l) => {
                  const done = progressFor(course.id)?.doneLessons.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => setLessonId(l.id)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: 10, marginBottom: 6,
                        borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--fg)',
                        border: '1px solid ' + (l.id === lessonId ? 'var(--accent)' : 'var(--border)'),
                        background: l.id === lessonId ? 'var(--accent-soft)' : 'transparent',
                      }}
                    >
                      {done ? '✓ ' : ''}{l.title}
                    </button>
                  );
                })}
              </Card>

              <Card>
                {!lesson ? (
                  <Empty>Choose a lesson.</Empty>
                ) : (
                  <>
                    <h2 style={{ fontSize: 17, fontWeight: 700, marginTop: 0 }}>{lesson.title}</h2>
                    <p style={{ fontSize: 15, lineHeight: 1.65 }}>{lesson.content}</p>
                    <Button onClick={() => markDone(lesson)}>Mark as done</Button>
                  </>
                )}
              </Card>
            </div>

            <Card title="Quiz">
              {course.quiz.map((q) => (
                <div key={q.id} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{q.prompt}</div>
                  {q.options.map((opt, i) => {
                    const chosen = answers[q.id] === i;
                    const correct = graded && i === q.answer;
                    const wrong = graded && chosen && i !== q.answer;
                    return (
                      <button
                        key={opt}
                        onClick={() => !graded && setAnswers({ ...answers, [q.id]: i })}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 5,
                          borderRadius: 8, fontSize: 13, cursor: graded ? 'default' : 'pointer', color: 'var(--fg)',
                          border: '1px solid ' + (correct ? '#16a34a' : wrong ? '#dc2626' : chosen ? 'var(--accent)' : 'var(--border)'),
                          background: chosen ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        {opt}{correct ? '  ✓' : ''}
                      </button>
                    );
                  })}
                </div>
              ))}
              {graded ? (
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 0 }}>
                  You scored {progressFor(course.id)?.score ?? 0}%.
                </p>
              ) : (
                <Button onClick={grade}>Submit answers</Button>
              )}
            </Card>
            <style>{'@media(max-width:760px){.nb-lms{grid-template-columns:1fr!important}}'}</style>
          </>
        )
      )}
    </Shell>
  );
}
`;
