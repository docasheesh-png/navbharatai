// Fitness / gym domain-vertical starter generator (roadmap remaining #19 — more verticals).
//
// Mirrors the established recipe pattern. Distinct real guarantees (not overlapping events-capacity or
// school-attendance): the value here is DETERMINISTIC MEMBERSHIP DATE-MATH + a validity gate:
//   1. MEMBERSHIP VALIDITY GATE: a check-in is allowed ONLY with an ACTIVE membership — an expired or
//      frozen membership is rejected. `isActive(member, at)` is computed exactly from the dates.
//   2. DETERMINISTIC RENEW/FREEZE: renew() extends the end date by the plan's days from max(now, currentEnd)
//      (no lost days, no double-credit); freeze() pauses and unfreeze() shifts the end date forward by the
//      exact frozen duration — so a member never loses paid days.
//   3. IDEMPOTENT CHECK-IN: at most one check-in per member per day (a repeat is a no-op, never a duplicate).
// In-memory by default (swap the Maps for a real DB, same contracts). No API key.

export const FITNESS_SERVICE_SOURCE = `// Fitness / gym domain logic — dependency-free and framework-agnostic.
//
// THREE real guarantees (not a stub):
//  1) A check-in requires an ACTIVE membership (expired/frozen rejected).
//  2) Renew/freeze date-math is DETERMINISTIC — a member never loses paid days.
//  3) Check-in is idempotent per member per day.
// In-memory by default — replace the Maps with your database, keeping the same method contracts.
// All times are epoch ms; pass 'now' explicitly to the date-sensitive methods for testable, deterministic
// behaviour (default Date.now()).

export interface Plan { id: string; name: string; days: number; price: number; }

export type MembershipStatus = 'active' | 'frozen' | 'expired';

export interface Member {
  id: string;
  name: string;
  phone: string;
  planId: string;
  startAt: number;
  endAt: number;         // membership valid through this instant
  frozenAt: number | null; // when the current freeze began (null ⇒ not frozen)
  createdAt: number;
}

export interface CheckIn { id: string; memberId: string; day: string; at: number; }

const DAY_MS = 24 * 60 * 60 * 1000;
const dayKey = (at: number): string => new Date(at).toISOString().slice(0, 10);

export class MembershipInactiveError extends Error {
  constructor(status: MembershipStatus) { super(\`Membership is \${status} — a check-in needs an active membership\`); this.name = 'MembershipInactiveError'; }
}

let seq = 0;
const nextId = (p: string): string => \`\${p}_\${Date.now().toString(36)}_\${(seq++).toString(36)}\`;

export class FitnessService {
  private plans = new Map<string, Plan>();
  private members = new Map<string, Member>();
  private checkins = new Map<string, CheckIn>(); // keyed \`\${memberId}|\${day}\`

  addPlan(data: { name: string; days: number; price: number }): Plan {
    if (!(data.days > 0)) throw new Error('Plan days must be > 0');
    const plan: Plan = { id: nextId('pln'), name: data.name, days: data.days, price: data.price };
    this.plans.set(plan.id, plan);
    return plan;
  }

  join(data: { name: string; phone: string; planId: string }, now: number = Date.now()): Member {
    const plan = this.plans.get(data.planId);
    if (!plan) throw new Error(\`Unknown plan \${data.planId}\`);
    if (!data.name?.trim() || !data.phone?.trim()) throw new Error('Member name and phone are required');
    const member: Member = {
      id: nextId('mem'), name: data.name.trim(), phone: data.phone.trim(), planId: plan.id,
      startAt: now, endAt: now + plan.days * DAY_MS, frozenAt: null, createdAt: now,
    };
    this.members.set(member.id, member);
    return member;
  }

  /** The membership status at a given instant — computed exactly from the dates. */
  statusOf(member: Member, at: number = Date.now()): MembershipStatus {
    if (member.frozenAt !== null) return 'frozen';
    return at <= member.endAt ? 'active' : 'expired';
  }
  isActive(member: Member, at: number = Date.now()): boolean {
    return this.statusOf(member, at) === 'active';
  }

  /** Extend by the plan's days from max(now, currentEnd) — no lost days when renewing early, no double-credit. */
  renew(memberId: string, now: number = Date.now()): Member {
    const member = this.members.get(memberId);
    if (!member) throw new Error(\`Unknown member \${memberId}\`);
    const plan = this.plans.get(member.planId);
    if (!plan) throw new Error('Member has no valid plan');
    const base = Math.max(now, member.endAt);
    member.endAt = base + plan.days * DAY_MS;
    return member;
  }

  freeze(memberId: string, now: number = Date.now()): Member {
    const member = this.members.get(memberId);
    if (!member) throw new Error(\`Unknown member \${memberId}\`);
    if (member.frozenAt !== null) throw new Error('Membership is already frozen');
    member.frozenAt = now;
    return member;
  }

  /** Unfreeze: shift the end date forward by exactly the frozen duration, so no paid day is lost. */
  unfreeze(memberId: string, now: number = Date.now()): Member {
    const member = this.members.get(memberId);
    if (!member) throw new Error(\`Unknown member \${memberId}\`);
    if (member.frozenAt === null) throw new Error('Membership is not frozen');
    const frozenMs = Math.max(0, now - member.frozenAt);
    member.endAt += frozenMs;
    member.frozenAt = null;
    return member;
  }

  /** Check in — requires an ACTIVE membership; idempotent per member per day. */
  checkIn(memberId: string, now: number = Date.now()): CheckIn {
    const member = this.members.get(memberId);
    if (!member) throw new Error(\`Unknown member \${memberId}\`);
    const status = this.statusOf(member, now);
    if (status !== 'active') throw new MembershipInactiveError(status);
    const key = \`\${memberId}|\${dayKey(now)}\`;
    const existing = this.checkins.get(key);
    if (existing) return existing; // idempotent — one check-in per day
    const ci: CheckIn = { id: nextId('chk'), memberId, day: dayKey(now), at: now };
    this.checkins.set(key, ci);
    return ci;
  }

  checkInsFor(memberId: string): CheckIn[] {
    return [...this.checkins.values()].filter((c) => c.memberId === memberId).sort((a, b) => a.at - b.at);
  }

  get(memberId: string): Member | undefined { return this.members.get(memberId); }
  listMembers(filter?: { status?: MembershipStatus }, at: number = Date.now()): Member[] {
    return [...this.members.values()].filter((m) => !filter?.status || this.statusOf(m, at) === filter.status);
  }
}

export const fitness = new FitnessService();
`;

export const FITNESS_ROUTES_SOURCE = `import { Router } from 'express';
import { fitness, MembershipInactiveError } from './fitnessService';

export const fitnessRouter = Router();

function handle(res: import('express').Response, fn: () => unknown): void {
  try {
    const out = fn();
    if (out === undefined) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(out);
  } catch (e) {
    if (e instanceof MembershipInactiveError) { res.status(409).json({ error: e.message }); return; }
    res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request' });
  }
}

fitnessRouter.post('/plans', (req, res) => handle(res, () => fitness.addPlan(req.body)));
fitnessRouter.post('/members', (req, res) => handle(res, () => fitness.join(req.body)));
fitnessRouter.get('/members/:id', (req, res) => handle(res, () => fitness.get(req.params.id)));
fitnessRouter.get('/members', (req, res) => handle(res, () => fitness.listMembers({ status: req.query.status as never })));
fitnessRouter.post('/members/:id/renew', (req, res) => handle(res, () => fitness.renew(req.params.id)));
fitnessRouter.post('/members/:id/freeze', (req, res) => handle(res, () => fitness.freeze(req.params.id)));
fitnessRouter.post('/members/:id/unfreeze', (req, res) => handle(res, () => fitness.unfreeze(req.params.id)));
fitnessRouter.post('/members/:id/checkin', (req, res) => handle(res, () => fitness.checkIn(req.params.id))); // 409 if not active
fitnessRouter.get('/members/:id/checkins', (req, res) => handle(res, () => fitness.checkInsFor(req.params.id)));
`;

export const FITNESS_README = `# Fitness / gym starter

A dependency-free gym / fitness backend under \`server/fitness/\`, wired for Express.

## Real guarantees (not a stub)
- **Membership validity gate** — a check-in is accepted ONLY with an **active** membership; an expired or
  frozen membership is rejected (**409**). Status is computed exactly from the dates.
- **Deterministic renew / freeze** — \`renew()\` extends by the plan's days from \`max(now, currentEnd)\` (no
  lost days on an early renewal, no double-credit); \`freeze()\`/\`unfreeze()\` shift the end date forward by
  the exact frozen duration, so a member never loses paid days.
- **Idempotent check-in** — at most one check-in per member per day (a repeat is a no-op, never a duplicate).

## Endpoints (mount with \`app.use("/api", fitnessRouter)\`)
- \`POST /plans\`, \`POST /members\`, \`GET /members\` (filter by status), \`GET /members/:id\`
- \`POST /members/:id/renew\`, \`POST /members/:id/freeze\`, \`POST /members/:id/unfreeze\`
- \`POST /members/:id/checkin\` (**409** if not active), \`GET /members/:id/checkins\`

In-memory by default; swap the Maps in \`fitnessService.ts\` for your DB. Pairs with the auth/payment/notification recipes.
`;

export interface FitnessConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Fitness / gym starter wired under server/fitness/ (dependency-free domain logic + an Express router). ' +
  'Three real guarantees: (1) MEMBERSHIP VALIDITY GATE — a check-in needs an ACTIVE membership (expired/frozen ' +
  'rejected, 409); (2) DETERMINISTIC renew/freeze — renew extends by the plan days from max(now, currentEnd) ' +
  '(no lost days), freeze/unfreeze shift the end date by the exact frozen duration; (3) IDEMPOTENT check-in — ' +
  'one per member per day. Endpoints: POST /plans, POST /members, GET /members(/:id), POST /members/:id/renew, ' +
  '/freeze, /unfreeze, /checkin (409 if not active), GET /members/:id/checkins. Mount with app.use("/api", ' +
  'fitnessRouter). In-memory by default — swap the Maps for your DB, same contracts. Pairs with the ' +
  'auth/payment/notification recipes. No key.';

export function generateFitnessIntegration(): FitnessConfig {
  return {
    files: {
      'server/fitness/fitnessService.ts': FITNESS_SERVICE_SOURCE,
      'server/fitness/routes.ts': FITNESS_ROUTES_SOURCE,
      'server/fitness/README.md': FITNESS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
