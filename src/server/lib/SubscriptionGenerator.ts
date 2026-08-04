// Roadmap breadth — subscriptions / recurring-billing starter (a packaged domain vertical).
//
// A high-demand vertical for SaaS, memberships and any recurring-revenue business. The real features are a
// correct SUBSCRIPTION-LIFECYCLE STATE-MACHINE (active ↔ paused, → past_due → cancelled, with reactivate)
// and deterministic RENEWAL-DATE math (next renewal = start/renew + the plan's interval). This emits a
// dependency-free SubscriptionService + an Express router + a README. Real logic, not a stub — the lifecycle
// + renewal rules are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const SUBSCRIPTION_SERVICE_SOURCE = `// Subscriptions domain logic. The core guarantees: (1) status changes follow an allowed lifecycle
// (invalid jumps rejected), and (2) the next renewal date is start/renew time + the plan's interval. In-memory
// here; swap the Maps for your database, keeping the same method contracts. Billing/charging is YOUR gateway's
// job — this tracks the subscription STATE + renewal schedule and tells you when a renewal is due.

export type SubStatus = 'active' | 'paused' | 'past_due' | 'cancelled';

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  intervalDays: number;
}

export interface Subscription {
  id: string;
  customer: string;
  planId: string;
  status: SubStatus;
  startedAt: string;
  renewalAt: string;
  updatedAt: string;
}

// Allowed lifecycle transitions.
const STATUS_FLOW: Record<SubStatus, SubStatus[]> = {
  active: ['paused', 'past_due', 'cancelled'],
  paused: ['active', 'cancelled'],
  past_due: ['active', 'cancelled'],
  cancelled: ['active'], // reactivate
};

const DAY_MS = 24 * 60 * 60 * 1000;

export class SubscriptionService {
  private plans = new Map<string, Plan>();
  private subs = new Map<string, Subscription>();
  private seq = 0;

  definePlan(input: { id: string; name: string; priceCents: number; intervalDays: number }): Plan {
    const id = String(input?.id ?? '').trim();
    const name = String(input?.name ?? '').trim();
    if (!id) throw new Error('plan id is required');
    if (!name) throw new Error('plan name is required');
    const priceCents = Math.max(0, Math.floor(Number(input.priceCents) || 0));
    const intervalDays = Math.floor(Number(input.intervalDays));
    if (!Number.isFinite(intervalDays) || intervalDays <= 0) throw new Error('intervalDays must be a positive number');
    const plan: Plan = { id, name, priceCents, intervalDays };
    this.plans.set(id, plan);
    return plan;
  }

  getPlan(id: string): Plan | undefined {
    return this.plans.get(String(id).trim());
  }

  /** Subscribe a customer to a plan. Starts 'active'; renewalAt = now + the plan's interval. */
  subscribe(customer: string, planId: string, now: Date = new Date()): Subscription {
    const who = String(customer).trim();
    if (!who) throw new Error('customer is required');
    const plan = this.plans.get(String(planId).trim());
    if (!plan) throw new Error('unknown plan');
    const iso = now.toISOString();
    const sub: Subscription = {
      id: String(++this.seq),
      customer: who,
      planId: plan.id,
      status: 'active',
      startedAt: iso,
      renewalAt: new Date(now.getTime() + plan.intervalDays * DAY_MS).toISOString(),
      updatedAt: iso,
    };
    this.subs.set(sub.id, sub);
    return sub;
  }

  get(id: string): Subscription | undefined {
    return this.subs.get(id);
  }

  private require(id: string): Subscription {
    const s = this.subs.get(id);
    if (!s) throw new Error('subscription not found');
    return s;
  }

  /** Change status, enforcing the allowed lifecycle. */
  setStatus(id: string, to: SubStatus, now: Date = new Date()): Subscription {
    const s = this.require(id);
    if (s.status === to) return s;
    if (!STATUS_FLOW[s.status].includes(to)) {
      throw new Error('invalid status transition: ' + s.status + ' -> ' + to);
    }
    s.status = to;
    s.updatedAt = now.toISOString();
    return s;
  }

  /** Process a renewal: advance renewalAt by the plan's interval and (re)activate. Call when a charge succeeds. */
  renew(id: string, now: Date = new Date()): Subscription {
    const s = this.require(id);
    if (s.status === 'cancelled') throw new Error('cannot renew a cancelled subscription');
    const plan = this.plans.get(s.planId);
    if (!plan) throw new Error('unknown plan');
    // Advance from the later of (current renewalAt) and now, so a late renewal doesn't stack up in the past.
    const base = Math.max(new Date(s.renewalAt).getTime(), now.getTime());
    s.renewalAt = new Date(base + plan.intervalDays * DAY_MS).toISOString();
    s.status = 'active';
    s.updatedAt = now.toISOString();
    return s;
  }

  /** Is this subscription due for renewal at the given time (renewalAt <= now) and still billable? */
  isDue(id: string, now: Date = new Date()): boolean {
    const s = this.subs.get(id);
    if (!s || s.status === 'cancelled') return false;
    return new Date(s.renewalAt).getTime() <= now.getTime();
  }

  isActive(id: string): boolean {
    return this.subs.get(id)?.status === 'active';
  }

  list(filter: { status?: SubStatus; customer?: string; planId?: string } = {}): Subscription[] {
    let out = [...this.subs.values()];
    if (filter.status) out = out.filter((s) => s.status === filter.status);
    if (filter.customer) out = out.filter((s) => s.customer === String(filter.customer).trim());
    if (filter.planId) out = out.filter((s) => s.planId === String(filter.planId).trim());
    return out;
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const subscriptions = new SubscriptionService();
`;

export const SUBSCRIPTION_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { subscriptions } from './subscriptionService';

// REST endpoints for the subscription service. Mount with: app.use('/api', subscriptionRouter).
export const subscriptionRouter = Router();

subscriptionRouter.post('/plans', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { id?: unknown; name?: unknown; priceCents?: unknown; intervalDays?: unknown };
  try {
    return res.status(201).json(subscriptions.definePlan({ id: String(body.id ?? ''), name: String(body.name ?? ''), priceCents: Number(body.priceCents), intervalDays: Number(body.intervalDays) }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

subscriptionRouter.post('/subscriptions', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { customer?: unknown; planId?: unknown };
  try {
    return res.status(201).json(subscriptions.subscribe(String(body.customer ?? ''), String(body.planId ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    return res.status(message === 'unknown plan' ? 404 : 400).json({ error: message });
  }
});

subscriptionRouter.get('/subscriptions', (req: Request, res: Response) => {
  const q = req.query as { status?: string; customer?: string; planId?: string };
  const status = ['active', 'paused', 'past_due', 'cancelled'].includes(String(q.status)) ? (q.status as 'active') : undefined;
  return res.status(200).json(subscriptions.list({ status, customer: q.customer, planId: q.planId }));
});

subscriptionRouter.get('/subscriptions/:id', (req: Request, res: Response) => {
  const s = subscriptions.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'subscription not found' });
  return res.status(200).json({ ...s, due: subscriptions.isDue(s.id) });
});

// Change status. { status } — 409 on an invalid lifecycle transition, 404 if unknown.
subscriptionRouter.patch('/subscriptions/:id/status', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { status?: unknown };
  try {
    return res.status(200).json(subscriptions.setStatus(req.params.id, String(body.status ?? '') as 'active'));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not update';
    if (message === 'subscription not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

// Process a renewal (advance the renewal date + reactivate). Call this when your gateway confirms a charge.
subscriptionRouter.post('/subscriptions/:id/renew', (req: Request, res: Response) => {
  try {
    return res.status(200).json(subscriptions.renew(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'could not renew';
    if (message === 'subscription not found') return res.status(404).json({ error: message });
    return res.status(409).json({ error: message });
  }
});
`;

const SUBSCRIPTION_README = `# Subscriptions / recurring billing

A real subscription-state backend. The core guarantees: a subscription's status follows an allowed
**lifecycle state-machine** (\`active ↔ paused\`, \`→ past_due → cancelled\`, reactivate from cancelled), and the
next **renewal date** is start/renew time + the plan's interval. It tracks the subscription STATE + renewal
schedule; the actual charging is your payment gateway's job (call \`renew\` when a charge succeeds). Files:

- \`subscriptionService.ts\` — the domain logic (\`SubscriptionService\` + a \`subscriptions\` singleton). In-memory;
  swap the Maps for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { subscriptionRouter } from './server/subscriptions/routes';
app.use('/api', subscriptionRouter);
\`\`\`

Endpoints:
- \`POST /api/plans\` \`{ id, name, priceCents, intervalDays }\`.
- \`POST /api/subscriptions\` \`{ customer, planId }\` → starts 'active', sets \`renewalAt\`.
- \`GET  /api/subscriptions\` (\`?status=&customer=&planId=\`) / \`GET /api/subscriptions/:id\` (+ \`due\`).
- \`PATCH /api/subscriptions/:id/status\` \`{ status }\` → **409** on an invalid transition.
- \`POST /api/subscriptions/:id/renew\` → advance the renewal date + reactivate (call on a successful charge).

Use \`isDue()\` in a scheduled job (pairs with the background-jobs recipe) to find subscriptions to charge.
`;

export interface SubscriptionConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Subscriptions / recurring-billing starter wired under server/subscriptions/ (dependency-free domain logic + ' +
  'an Express router). The real guarantees are a lifecycle STATE-MACHINE (active↔paused, →past_due→cancelled, ' +
  'reactivate) enforced by setStatus(), and deterministic renewal math (renewalAt = start/renew + the plan\'s ' +
  'intervalDays) via renew()/isDue(). routes.ts exposes POST /plans, POST/GET /subscriptions(/:id), PATCH ' +
  '/subscriptions/:id/status (409 on invalid transition) and POST /subscriptions/:id/renew. Mount with ' +
  'app.use("/api", subscriptionRouter). Charging is your gateway\'s job — call renew() on a successful charge; ' +
  'use isDue() in a scheduled job (pairs with generate_jobs). In-memory by default — swap the Maps for your DB.';

export function generateSubscriptionIntegration(): SubscriptionConfig {
  return {
    files: {
      'server/subscriptions/subscriptionService.ts': SUBSCRIPTION_SERVICE_SOURCE,
      'server/subscriptions/routes.ts': SUBSCRIPTION_ROUTES_SOURCE,
      'server/subscriptions/README.md': SUBSCRIPTION_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
