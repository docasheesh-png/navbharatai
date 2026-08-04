// Roadmap breadth — consent / GDPR-consent log starter (a packaged domain vertical).
//
// A compliance-critical vertical for GDPR / cookie consent / marketing opt-in on any app with EU (or DPDP-India)
// users. The real feature is CONSENT-LOG INTEGRITY: consent is an APPEND-ONLY event log (grant / withdraw, with
// a policy version + source), the CURRENT state for a (user, purpose) is exactly the MOST-RECENT event, and the
// full history is retained for audit (you can prove when and how consent was given or revoked). This emits a
// dependency-free ConsentService + an Express router + a README. Real logic, not a stub — the latest-wins +
// append-only-history rules are unit-tested against the emitted code. Pure builder → the caller writes files.

export const CONSENT_SERVICE_SOURCE = `// Consent-log domain logic. The core guarantees: (1) consent is an APPEND-ONLY event log (record() only adds;
// there is no edit/delete of history), (2) the CURRENT consent for a (user, purpose) is exactly the MOST-RECENT
// event (grant or withdraw — latest wins), and (3) the full history is queryable for audit/proof. In-memory
// here; swap the array for an append-only table, keeping the same method contracts.

export type ConsentAction = 'grant' | 'withdraw';

export interface ConsentEvent {
  id: string;
  user: string;
  purpose: string;      // e.g. 'analytics', 'marketing_email', 'cookies.functional'
  action: ConsentAction;
  policyVersion: string; // the version of the privacy policy/terms the user acted against
  source: string;        // where it happened (e.g. 'cookie_banner', 'settings', 'signup')
  at: string;            // ISO timestamp
}

export class ConsentService {
  private events: ConsentEvent[] = [];
  private seq = 0;

  /** Append a consent event. There is deliberately NO edit/delete — history is immutable. */
  record(input: { user: string; purpose: string; action: ConsentAction; policyVersion?: string; source?: string }, now: Date = new Date()): ConsentEvent {
    const user = String(input?.user ?? '').trim();
    const purpose = String(input?.purpose ?? '').trim();
    if (!user) throw new Error('user is required');
    if (!purpose) throw new Error('purpose is required');
    if (input?.action !== 'grant' && input?.action !== 'withdraw') throw new Error("action must be 'grant' or 'withdraw'");
    const event: ConsentEvent = {
      id: String(++this.seq),
      user,
      purpose,
      action: input.action,
      policyVersion: String(input?.policyVersion ?? '').trim(),
      source: String(input?.source ?? '').trim(),
      at: now.toISOString(),
    };
    this.events.push(event);
    return event;
  }

  /** Convenience wrappers. */
  grant(user: string, purpose: string, meta: { policyVersion?: string; source?: string } = {}, now: Date = new Date()): ConsentEvent {
    return this.record({ user, purpose, action: 'grant', ...meta }, now);
  }
  withdraw(user: string, purpose: string, meta: { policyVersion?: string; source?: string } = {}, now: Date = new Date()): ConsentEvent {
    return this.record({ user, purpose, action: 'withdraw', ...meta }, now);
  }

  private latest(user: string, purpose: string): ConsentEvent | undefined {
    const u = String(user).trim();
    const p = String(purpose).trim();
    let found: ConsentEvent | undefined;
    for (const e of this.events) {
      if (e.user === u && e.purpose === p) found = e; // events are append-order → last match is the newest
    }
    return found;
  }

  /** Is consent CURRENTLY granted for (user, purpose)? False if never recorded or last event was a withdraw. */
  hasConsent(user: string, purpose: string): boolean {
    return this.latest(user, purpose)?.action === 'grant';
  }

  /** The current consent state per purpose for a user: { purpose: 'grant' | 'withdraw' }. */
  stateOf(user: string): Record<string, ConsentAction> {
    const u = String(user).trim();
    const state: Record<string, ConsentAction> = {};
    for (const e of this.events) {
      if (e.user === u) state[e.purpose] = e.action; // append-order → ends on the latest per purpose
    }
    return state;
  }

  /** The full audit history for a user (optionally one purpose), oldest first. */
  history(user: string, purpose?: string): ConsentEvent[] {
    const u = String(user).trim();
    const p = purpose ? String(purpose).trim() : null;
    return this.events.filter((e) => e.user === u && (!p || e.purpose === p)).map((e) => ({ ...e }));
  }

  /** Every user who CURRENTLY has consent granted for a purpose (e.g. build a marketing-eligible list). */
  grantedUsers(purpose: string): string[] {
    const p = String(purpose).trim();
    const users = new Set<string>();
    for (const e of this.events) if (e.purpose === p) users.add(e.user);
    return [...users].filter((u) => this.hasConsent(u, p)).sort();
  }
}

// A ready-to-use singleton for the routes. Swap for an append-only-table-backed instance in production.
export const consent = new ConsentService();
`;

export const CONSENT_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { consent } from './consentService';

// REST endpoints for the consent log. Mount with: app.use('/api', consentRouter).
// NOTE: there is deliberately NO update/delete route — the consent log is append-only by design.
export const consentRouter = Router();

// Record a consent event. { user, purpose, action: 'grant'|'withdraw', policyVersion?, source? }.
consentRouter.post('/consent', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    return res.status(201).json(consent.record({
      user: String(body.user ?? ''), purpose: String(body.purpose ?? ''), action: body.action as 'grant',
      policyVersion: String(body.policyVersion ?? ''), source: String(body.source ?? ''),
    }));
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// A user's current consent state across purposes.
consentRouter.get('/consent/:user', (req: Request, res: Response) => {
  return res.status(200).json({ user: req.params.user, state: consent.stateOf(req.params.user) });
});

// Whether a specific (user, purpose) currently has consent.
consentRouter.get('/consent/:user/:purpose', (req: Request, res: Response) => {
  return res.status(200).json({ user: req.params.user, purpose: req.params.purpose, granted: consent.hasConsent(req.params.user, req.params.purpose) });
});

// The full audit history for a user (?purpose=).
consentRouter.get('/consent/:user/history', (req: Request, res: Response) => {
  const q = req.query as { purpose?: string };
  return res.status(200).json(consent.history(req.params.user, q.purpose));
});
`;

const CONSENT_README = `# Consent / GDPR consent log

A real consent-tracking backend. The core guarantees: consent is an **append-only** event log (grant / withdraw,
with a policy version + source), the **current** consent for a \`(user, purpose)\` is exactly the **most-recent**
event (latest wins), and the full history is retained for **audit/proof**. Files:

- \`consentService.ts\` — the domain logic (\`ConsentService\` + a \`consent\` singleton). In-memory; swap the array
  for an **append-only** table in production.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { consentRouter } from './server/consent/routes';
app.use('/api', consentRouter);
\`\`\`

Endpoints:
- \`POST /api/consent\` \`{ user, purpose, action: 'grant'|'withdraw', policyVersion?, source? }\` → append an event.
- \`GET  /api/consent/:user\` → current state per purpose (\`{ analytics: 'grant', marketing: 'withdraw' }\`).
- \`GET  /api/consent/:user/:purpose\` → \`{ granted: boolean }\`.
- \`GET  /api/consent/:user/history\` (\`?purpose=\`) → the full audit trail (oldest first).

Gate features on \`hasConsent(user, purpose)\`. Record \`policyVersion\` + \`source\` on every event so you can prove
exactly what the user agreed to and where. Use an append-only table so history can never be silently rewritten.
`;

export interface ConsentConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'Consent / GDPR-consent log starter wired under server/consent/ (dependency-free domain logic + an Express ' +
  'router). The real guarantee is CONSENT-LOG INTEGRITY: record() APPENDS a grant/withdraw event (no edit/delete ' +
  'of history); hasConsent(user, purpose) is exactly the MOST-RECENT event (latest wins — false if never set or ' +
  'last was a withdraw); stateOf(user) gives the current state per purpose; history() returns the full audit ' +
  'trail; grantedUsers(purpose) lists everyone currently opted-in. routes.ts exposes POST /consent, GET ' +
  '/consent/:user (state), GET /consent/:user/:purpose (granted bool) and GET /consent/:user/history (?purpose=). ' +
  'Mount with app.use("/api", consentRouter). Record policyVersion + source on every event for proof; use an ' +
  'append-only table so history cannot be rewritten. In-memory by default — swap the array for your DB.';

export function generateConsentIntegration(): ConsentConfig {
  return {
    files: {
      'server/consent/consentService.ts': CONSENT_SERVICE_SOURCE,
      'server/consent/routes.ts': CONSENT_ROUTES_SOURCE,
      'server/consent/README.md': CONSENT_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
