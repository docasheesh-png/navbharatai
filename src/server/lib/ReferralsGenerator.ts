// Roadmap breadth — referral / invite starter (a packaged domain vertical).
//
// A high-leverage growth vertical for any app that wants viral invites. The real feature is ATTRIBUTION
// INTEGRITY: every user gets ONE unique referral code, a new user can be referred AT MOST ONCE (a second
// attribution is rejected), SELF-REFERRAL is rejected, an unknown code is rejected, and the referrer is
// CREDITED EXACTLY ONCE when the referred user completes a qualifying event (e.g. first purchase) — a repeat
// completion never double-credits. This emits a dependency-free ReferralService + an Express router + a
// README. Real logic, not a stub — the attribution + credit-once rules are unit-tested against the emitted
// code. Pure builder → the caller writes the files.

export const REFERRAL_SERVICE_SOURCE = `// Referral / invite domain logic. The core guarantees: (1) every user has ONE unique referral code,
// (2) a referred user is attributed to AT MOST ONE referrer (self-referral / unknown code / double-attribution
// rejected), and (3) the referrer is credited EXACTLY ONCE when the referred user completes the qualifying
// event. In-memory here; swap the Maps for your database, keeping the same method contracts.

export type ReferralStatus = 'pending' | 'completed';

export interface Referral {
  code: string;         // the referrer's code that was used
  referrer: string;     // user id who owns the code
  referred: string;     // the new user id
  status: ReferralStatus;
  createdAt: string;
  completedAt: string | null;
}

// Unambiguous code alphabet (no 0/O/1/I) so codes are easy to read aloud/type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class ReferralService {
  private codeToUser = new Map<string, string>(); // referral code -> owner user id
  private userToCode = new Map<string, string>(); // owner user id -> their code
  private referrals = new Map<string, Referral>(); // referred user id -> the single referral edge
  private seq = 0;

  /** Deterministic-ish code from a counter, so a materialize+execute test is reproducible without RNG. */
  private mintCode(): string {
    let n = ++this.seq;
    let code = '';
    // Base-32 encode the counter into the alphabet, min length 6, padded with the first letter.
    do {
      code = ALPHABET[n % ALPHABET.length] + code;
      n = Math.floor(n / ALPHABET.length);
    } while (n > 0);
    return code.padStart(6, ALPHABET[0]);
  }

  /** Get (or lazily create) the caller's own referral code. Stable for a given user. */
  codeFor(user: string): string {
    const who = String(user).trim();
    if (!who) throw new Error('user is required');
    const existing = this.userToCode.get(who);
    if (existing) return existing;
    let code = this.mintCode();
    while (this.codeToUser.has(code)) code = this.mintCode(); // guarantee uniqueness
    this.codeToUser.set(code, who);
    this.userToCode.set(who, code);
    return code;
  }

  /** Who owns this code (if any). */
  ownerOf(code: string): string | undefined {
    return this.codeToUser.get(String(code).trim().toUpperCase());
  }

  /**
   * Attribute a NEW user to the referrer that owns \`code\`. Rejects: unknown code, self-referral, and a user
   * who was already referred (attribution is one-time and immutable). Returns the pending Referral.
   */
  attribute(code: string, newUser: string, now: Date = new Date()): Referral {
    const c = String(code).trim().toUpperCase();
    const referred = String(newUser).trim();
    if (!referred) throw new Error('newUser is required');
    const referrer = this.codeToUser.get(c);
    if (!referrer) throw new Error('unknown referral code');
    if (referrer === referred) throw new Error('cannot refer yourself');
    if (this.referrals.has(referred)) throw new Error('user already referred');
    const ref: Referral = {
      code: c,
      referrer,
      referred,
      status: 'pending',
      createdAt: now.toISOString(),
      completedAt: null,
    };
    this.referrals.set(referred, ref);
    return ref;
  }

  /** The referral edge for a referred user, if any. */
  referralOf(referredUser: string): Referral | undefined {
    return this.referrals.get(String(referredUser).trim());
  }

  /**
   * Mark the referred user's qualifying event complete → credit the referrer EXACTLY ONCE. A repeat call is a
   * no-op (returns the already-completed edge) so a retried webhook never double-credits. Returns null if the
   * user was never referred.
   */
  complete(referredUser: string, now: Date = new Date()): Referral | null {
    const ref = this.referrals.get(String(referredUser).trim());
    if (!ref) return null;
    if (ref.status === 'completed') return ref; // idempotent — already credited
    ref.status = 'completed';
    ref.completedAt = now.toISOString();
    return ref;
  }

  /** How many referrals a referrer has, split by status — the basis for reward payout. */
  statsFor(referrer: string): { total: number; pending: number; completed: number } {
    const who = String(referrer).trim();
    let pending = 0;
    let completed = 0;
    for (const r of this.referrals.values()) {
      if (r.referrer !== who) continue;
      if (r.status === 'completed') completed++;
      else pending++;
    }
    return { total: pending + completed, pending, completed };
  }

  /** All referrals made by a referrer. */
  listFor(referrer: string): Referral[] {
    const who = String(referrer).trim();
    return [...this.referrals.values()].filter((r) => r.referrer === who);
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const referrals = new ReferralService();
`;

export const REFERRAL_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { referrals } from './referralService';

// REST endpoints for the referral service. Mount with: app.use('/api', referralRouter).
export const referralRouter = Router();

// Get (or create) the caller's own referral code. In production, take the user from the auth session.
referralRouter.get('/referrals/:user/code', (req: Request, res: Response) => {
  try {
    return res.status(200).json({ user: req.params.user, code: referrals.codeFor(req.params.user) });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Attribute a new user to a referral code. { code, newUser } — 409 on self / unknown / already-referred.
referralRouter.post('/referrals/attribute', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { code?: unknown; newUser?: unknown };
  try {
    return res.status(201).json(referrals.attribute(String(body.code ?? ''), String(body.newUser ?? '')));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad request';
    if (message === 'newUser is required') return res.status(400).json({ error: message });
    return res.status(409).json({ error: message });
  }
});

// Mark a referred user's qualifying event complete → credit the referrer once (idempotent).
referralRouter.post('/referrals/:referred/complete', (req: Request, res: Response) => {
  const ref = referrals.complete(req.params.referred);
  if (!ref) return res.status(404).json({ error: 'user was not referred' });
  return res.status(200).json(ref);
});

// A referrer's stats (total / pending / completed) — the basis for reward payout.
referralRouter.get('/referrals/:referrer/stats', (req: Request, res: Response) => {
  return res.status(200).json({ referrer: req.params.referrer, ...referrals.statsFor(req.params.referrer) });
});
`;

const REFERRAL_README = `# Referral / invite system

A real referral backend. The core guarantees: every user has **one unique referral code**, a referred user is
attributed to **at most one referrer** (self-referral, unknown code and double-attribution are rejected), and
the referrer is **credited exactly once** when the referred user completes the qualifying event — a retried
completion never double-credits. Files:

- \`referralService.ts\` — the domain logic (\`ReferralService\` + a \`referrals\` singleton). In-memory; swap the
  Maps for your database, keeping the same method contracts.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { referralRouter } from './server/referrals/routes';
app.use('/api', referralRouter);
\`\`\`

Endpoints:
- \`GET  /api/referrals/:user/code\` → the caller's stable referral code (created on first call).
- \`POST /api/referrals/attribute\` \`{ code, newUser }\` → attributes a new signup; **409** on self-referral,
  unknown code, or a user who was already referred.
- \`POST /api/referrals/:referred/complete\` → marks the qualifying event done and credits the referrer **once**
  (idempotent — safe to call from a retried webhook).
- \`GET  /api/referrals/:referrer/stats\` → \`{ total, pending, completed }\` for reward payout.

Call \`complete\` from wherever the qualifying event happens (first purchase, verified email, etc.). Pay the
reward off the \`completed\` count. Take the user id from the auth session in production.
`;

export interface ReferralsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Referral / invite starter wired under server/referrals/ (dependency-free domain logic + an Express router). ' +
  'The real guarantee is ATTRIBUTION INTEGRITY: codeFor() gives each user ONE stable unique code; attribute() ' +
  'links a new user to a referrer but rejects self-referral, an unknown code, and a user who was already ' +
  'referred (one-time, immutable); complete() credits the referrer EXACTLY ONCE and is idempotent (a retried ' +
  'webhook never double-credits). routes.ts exposes GET /referrals/:user/code, POST /referrals/attribute (409 ' +
  'on self/unknown/already-referred), POST /referrals/:referred/complete and GET /referrals/:referrer/stats. ' +
  'Mount with app.use("/api", referralRouter). Pay rewards off statsFor().completed. Take the user id from the ' +
  'auth session in production. In-memory by default — swap the Maps for your DB.';

export function generateReferralsIntegration(): ReferralsConfig {
  return {
    files: {
      'server/referrals/referralService.ts': REFERRAL_SERVICE_SOURCE,
      'server/referrals/routes.ts': REFERRAL_ROUTES_SOURCE,
      'server/referrals/README.md': REFERRAL_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
