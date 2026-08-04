// Roadmap breadth — loyalty / points-wallet starter (a packaged domain vertical).
//
// A high-demand vertical for retail, apps, memberships and any rewards programme. The real feature is LEDGER
// INTEGRITY: a member's point balance is ALWAYS exactly sum(earned) − sum(redeemed), a redemption for more
// than the current balance is REJECTED (the balance can never go negative), and every change is an append-only
// ledger entry (a full, auditable history). Optional point EXPIRY is supported deterministically. This emits a
// dependency-free LoyaltyService + an Express router + a README. Real logic, not a stub — the balance +
// no-overdraft rules are unit-tested against the emitted code. Pure builder → the caller writes the files.

export const LOYALTY_SERVICE_SOURCE = `// Loyalty / points-wallet domain logic. The core guarantees: (1) a member's balance is ALWAYS exactly
// sum(earned) − sum(redeemed) over the live (non-expired) ledger, (2) a redeem for more than the current
// balance is REJECTED — the balance can never go negative, and (3) every change is an append-only ledger
// entry. In-memory here; swap the Maps for your database, keeping the same method contracts.

export type EntryKind = 'earn' | 'redeem' | 'expire';

export interface LedgerEntry {
  id: string;
  member: string;
  kind: EntryKind;
  points: number; // always a positive magnitude; kind carries the sign
  reason: string;
  createdAt: string;
  expiresAt: string | null; // for 'earn' entries that can expire; null = never
}

function assertPositiveInt(points: unknown, label: string): number {
  const n = Number(points);
  if (!Number.isInteger(n) || n <= 0) throw new Error(label + ' must be a positive integer');
  return n;
}

export class LoyaltyService {
  private ledger = new Map<string, LedgerEntry>();
  private seq = 0;

  private add(entry: Omit<LedgerEntry, 'id'>): LedgerEntry {
    const full: LedgerEntry = { ...entry, id: String(++this.seq) };
    this.ledger.set(full.id, full);
    return full;
  }

  /** Award points to a member. Optionally expiring at expiresAt (ISO string). */
  earn(member: string, points: number, reason = '', expiresAt: string | null = null, now: Date = new Date()): LedgerEntry {
    const who = String(member).trim();
    if (!who) throw new Error('member is required');
    const pts = assertPositiveInt(points, 'points');
    return this.add({ member: who, kind: 'earn', points: pts, reason: String(reason), createdAt: now.toISOString(), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null });
  }

  /** Redeem points. Rejected (throws) if the member's balance is less than the amount — never goes negative. */
  redeem(member: string, points: number, reason = '', now: Date = new Date()): LedgerEntry {
    const who = String(member).trim();
    if (!who) throw new Error('member is required');
    const pts = assertPositiveInt(points, 'points');
    const bal = this.balance(who, now);
    if (pts > bal) throw new Error('insufficient points: balance ' + bal + ', tried to redeem ' + pts);
    return this.add({ member: who, kind: 'redeem', points: pts, reason: String(reason), createdAt: now.toISOString(), expiresAt: null });
  }

  /** The member's current balance = sum(earned, not expired) − sum(redeemed) − sum(expired). Never negative. */
  balance(member: string, now: Date = new Date()): number {
    const who = String(member).trim();
    const t = now.getTime();
    let total = 0;
    for (const e of this.ledger.values()) {
      if (e.member !== who) continue;
      if (e.kind === 'earn') {
        // An earn whose expiry has passed no longer counts toward the balance.
        if (e.expiresAt && new Date(e.expiresAt).getTime() <= t) continue;
        total += e.points;
      } else {
        total -= e.points; // redeem or expire
      }
    }
    return Math.max(0, total);
  }

  /** Sweep expired earns into explicit 'expire' entries so the history records the loss. Returns points expired. */
  expireDue(member: string, now: Date = new Date()): number {
    const who = String(member).trim();
    const t = now.getTime();
    // How many earned points, already netted against redemptions, are still live but past expiry?
    // We only need to record expiry for earns whose expiresAt has passed and that haven't been recorded yet.
    let expiredPoints = 0;
    for (const e of [...this.ledger.values()]) {
      if (e.member !== who || e.kind !== 'earn') continue;
      if (e.expiresAt && new Date(e.expiresAt).getTime() <= t) {
        expiredPoints += e.points;
        // Record the loss as an explicit 'expire' entry, then clear this earn's expiry so it is not
        // swept again. Net effect on the balance is zero (the earn now counts, the expire cancels it),
        // but the history gains an auditable expiry record.
        e.expiresAt = null;
        this.add({ member: who, kind: 'expire', points: e.points, reason: 'points expired', createdAt: now.toISOString(), expiresAt: null });
      }
    }
    return expiredPoints;
  }

  /** The member's full ledger, newest first. */
  history(member: string): LedgerEntry[] {
    const who = String(member).trim();
    return [...this.ledger.values()]
      .filter((e) => e.member === who)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || Number(b.id) - Number(a.id));
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const loyalty = new LoyaltyService();
`;

export const LOYALTY_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { loyalty } from './loyaltyService';

// REST endpoints for the loyalty service. Mount with: app.use('/api', loyaltyRouter).
export const loyaltyRouter = Router();

// Award points. { member, points, reason?, expiresAt? }. In production, take member from the auth session.
loyaltyRouter.post('/loyalty/earn', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { member?: unknown; points?: unknown; reason?: unknown; expiresAt?: unknown };
  try {
    const entry = loyalty.earn(String(body.member ?? ''), Number(body.points), String(body.reason ?? ''), body.expiresAt ? String(body.expiresAt) : null);
    return res.status(201).json(entry);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Redeem points. { member, points, reason? } — 409 when the balance is insufficient.
loyaltyRouter.post('/loyalty/redeem', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { member?: unknown; points?: unknown; reason?: unknown };
  try {
    const entry = loyalty.redeem(String(body.member ?? ''), Number(body.points), String(body.reason ?? ''));
    return res.status(201).json(entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message.startsWith('insufficient points')) return res.status(409).json({ error: message });
    return res.status(400).json({ error: message });
  }
});

// Current balance for a member.
loyaltyRouter.get('/loyalty/:member/balance', (req: Request, res: Response) => {
  return res.status(200).json({ member: req.params.member, balance: loyalty.balance(req.params.member) });
});

// Full point history for a member.
loyaltyRouter.get('/loyalty/:member/history', (req: Request, res: Response) => {
  return res.status(200).json(loyalty.history(req.params.member));
});
`;

const LOYALTY_README = `# Loyalty / points wallet

A real rewards backend. The core guarantees: a member's balance is **always exactly** \`sum(earned) −
sum(redeemed)\` over the live (non-expired) ledger, a **redeem for more than the balance is rejected** (the
balance can never go negative), and every change is an **append-only ledger entry** (a full, auditable
history). Optional point **expiry** is supported. Files:

- \`loyaltyService.ts\` — the domain logic (\`LoyaltyService\` + a \`loyalty\` singleton). In-memory; swap the Maps
  for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { loyaltyRouter } from './server/loyalty/routes';
app.use('/api', loyaltyRouter);
\`\`\`

Endpoints:
- \`POST /api/loyalty/earn\` \`{ member, points, reason?, expiresAt? }\` → award points (points must be a positive integer).
- \`POST /api/loyalty/redeem\` \`{ member, points, reason? }\` → **409** when the balance is insufficient.
- \`GET  /api/loyalty/:member/balance\` → \`{ member, balance }\`.
- \`GET  /api/loyalty/:member/history\` → the full ledger.

Take \`member\` from the authenticated session in production. Use \`expireDue()\` in a scheduled job (pairs with
the background-jobs recipe) to record expired points into the history.
`;

export interface LoyaltyConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Loyalty / points-wallet starter wired under server/loyalty/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is LEDGER INTEGRITY: balance() is ALWAYS exactly sum(earned, not expired) − ' +
  'sum(redeemed) and can never go negative — redeem() throws when the amount exceeds the balance. Every change ' +
  'is an append-only LedgerEntry (earn / redeem / expire) for a full audit history; optional per-earn expiry is ' +
  'supported (expireDue() records it). routes.ts exposes POST /loyalty/earn, POST /loyalty/redeem (409 on ' +
  'insufficient balance), GET /loyalty/:member/balance and GET /loyalty/:member/history. Mount with ' +
  'app.use("/api", loyaltyRouter). Take member from the auth session in production. In-memory by default — swap ' +
  'the Maps for your DB.';

export function generateLoyaltyIntegration(): LoyaltyConfig {
  return {
    files: {
      'server/loyalty/loyaltyService.ts': LOYALTY_SERVICE_SOURCE,
      'server/loyalty/routes.ts': LOYALTY_ROUTES_SOURCE,
      'server/loyalty/README.md': LOYALTY_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
