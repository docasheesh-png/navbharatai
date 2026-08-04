// Roadmap breadth — A/B testing / experiment-assignment starter (a packaged domain vertical).
//
// A high-value vertical for any product doing A/B tests or staged rollouts. The real feature is DETERMINISTIC
// STICKY ASSIGNMENT: assign(experiment, user) is a PURE function of the ids (SHA-256 hash → a stable [0,1)
// bucket → a weighted variant), so the SAME user ALWAYS gets the SAME variant with no storage needed, variant
// split WEIGHTS are respected across the population, and exposure logging gives exact per-variant counts. This
// emits a dependency-free ExperimentService (node:crypto) + an Express router + a README. Real logic, not a
// stub — the determinism + weight-split + exposure rules are unit-tested against the emitted code. Pure builder.

export const EXPERIMENTS_SERVICE_SOURCE = `import { createHash } from 'node:crypto';

// A/B testing / experiment-assignment domain logic. The core guarantees: (1) assign() is DETERMINISTIC and
// STICKY — a pure hash of (experiment salt + user), so the same user always lands in the same variant with no
// stored state, (2) variant WEIGHTS are respected (a user's [0,1) bucket maps to the weighted variant ranges),
// and (3) exposure logging is per (experiment, user) once, giving exact per-variant counts. In-memory here for
// definitions + exposures; swap the Maps for your database, keeping the same method contracts.

export interface Variant {
  key: string;
  weight: number; // relative weight; ranges are proportional to the sum
}

export interface Experiment {
  key: string;
  salt: string;      // mixed into the hash so two experiments bucket users independently
  active: boolean;
  variants: Variant[];
}

// Hash (salt + '\\u0000' + user) into a stable float in [0, 1).
function bucket(salt: string, user: string): number {
  const hex = createHash('sha256').update(salt + '\\u0000' + user).digest('hex').slice(0, 8);
  return parseInt(hex, 16) / 0x100000000; // 2^32
}

export class ExperimentService {
  private experiments = new Map<string, Experiment>();
  // exposures: experimentKey -> Map<user, variantKey>
  private exposures = new Map<string, Map<string, string>>();

  /** Define/replace an experiment. variants must be non-empty with positive weights. */
  define(key: string, variants: Array<{ key: string; weight?: number }>, opts: { salt?: string; active?: boolean } = {}): Experiment {
    const k = String(key).trim();
    if (!k) throw new Error('experiment key is required');
    if (!Array.isArray(variants) || variants.length === 0) throw new Error('at least one variant is required');
    const norm: Variant[] = variants.map((v) => {
      const vk = String(v?.key ?? '').trim();
      if (!vk) throw new Error('each variant needs a key');
      const w = v.weight === undefined ? 1 : Number(v.weight);
      if (!Number.isFinite(w) || w <= 0) throw new Error('variant weight must be a positive number');
      return { key: vk, weight: w };
    });
    const experiment: Experiment = { key: k, salt: String(opts.salt ?? k), active: opts.active !== false, variants: norm };
    this.experiments.set(k, experiment);
    return experiment;
  }

  get(key: string): Experiment | undefined {
    return this.experiments.get(String(key).trim());
  }

  /**
   * Assign a user to a variant. DETERMINISTIC + STICKY: a pure hash of (salt, user) → the weighted variant.
   * An inactive/unknown experiment returns the first-declared variant as the control (never throws on hot path).
   * Does NOT log exposure — call expose() for that.
   */
  assign(experimentKey: string, user: string): string {
    const exp = this.experiments.get(String(experimentKey).trim());
    const who = String(user).trim();
    if (!exp || !exp.active || !who) return exp?.variants[0]?.key ?? 'control';
    const total = exp.variants.reduce((s, v) => s + v.weight, 0);
    const point = bucket(exp.salt, who) * total;
    let acc = 0;
    for (const v of exp.variants) {
      acc += v.weight;
      if (point < acc) return v.key;
    }
    return exp.variants[exp.variants.length - 1].key; // float-safety fallback
  }

  /** Assign AND record the exposure once (idempotent per user). Returns the variant. */
  expose(experimentKey: string, user: string): string {
    const k = String(experimentKey).trim();
    const who = String(user).trim();
    const variant = this.assign(k, who);
    if (who) {
      const log = this.exposures.get(k) ?? new Map<string, string>();
      if (!log.has(who)) log.set(who, variant);
      this.exposures.set(k, log);
    }
    return variant;
  }

  /** Per-variant exposure counts for an experiment (exact, distinct users). */
  counts(experimentKey: string): Record<string, number> {
    const exp = this.experiments.get(String(experimentKey).trim());
    const out: Record<string, number> = {};
    if (exp) for (const v of exp.variants) out[v.key] = 0;
    const log = this.exposures.get(String(experimentKey).trim());
    if (log) for (const variant of log.values()) out[variant] = (out[variant] ?? 0) + 1;
    return out;
  }

  list(): Experiment[] {
    return [...this.experiments.values()];
  }
}

// A ready-to-use singleton for the routes. Swap for a DB-backed instance in production.
export const experiments = new ExperimentService();
`;

export const EXPERIMENTS_ROUTES_SOURCE = `import { Router, type Request, type Response } from 'express';
import { experiments } from './experimentService';

// REST endpoints for the experiment service. Mount with: app.use('/api', experimentRouter).
export const experimentRouter = Router();

// Define an experiment. { key, variants: [{ key, weight? }], salt?, active? }.
experimentRouter.post('/experiments', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { key?: unknown; variants?: unknown; salt?: unknown; active?: unknown };
  try {
    const variants = Array.isArray(body.variants) ? (body.variants as Array<{ key: string; weight?: number }>) : [];
    const exp = experiments.define(String(body.key ?? ''), variants, { salt: body.salt === undefined ? undefined : String(body.salt), active: body.active === undefined ? undefined : Boolean(body.active) });
    return res.status(201).json(exp);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'bad request' });
  }
});

// Assign a user (deterministic; does NOT log exposure). /experiments/:key/assign/:user
experimentRouter.get('/experiments/:key/assign/:user', (req: Request, res: Response) => {
  return res.status(200).json({ experiment: req.params.key, user: req.params.user, variant: experiments.assign(req.params.key, req.params.user) });
});

// Assign AND log exposure (idempotent). { user }.
experimentRouter.post('/experiments/:key/expose', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { user?: unknown };
  return res.status(200).json({ experiment: req.params.key, variant: experiments.expose(req.params.key, String(body.user ?? '')) });
});

// Per-variant exposure counts.
experimentRouter.get('/experiments/:key/counts', (req: Request, res: Response) => {
  return res.status(200).json({ experiment: req.params.key, counts: experiments.counts(req.params.key) });
});

// List experiments.
experimentRouter.get('/experiments', (_req: Request, res: Response) => {
  return res.status(200).json(experiments.list());
});
`;

const EXPERIMENTS_README = `# A/B testing / experiments

A real experiment-assignment backend. The core guarantees: \`assign()\` is **deterministic and sticky** — a pure
hash of \`(salt, user)\`, so the **same user always gets the same variant** with **no stored state** — variant
**weights** are respected across the population, and exposure logging gives exact per-variant counts. Files:

- \`experimentService.ts\` — the domain logic (\`ExperimentService\` + an \`experiments\` singleton). Uses
  \`node:crypto\` only (no deps). In-memory for definitions/exposures; swap the Maps for your DB.
- \`routes.ts\` — REST endpoints. Mount them:

\`\`\`ts
import { experimentRouter } from './server/experiments/routes';
app.use('/api', experimentRouter);
\`\`\`

Endpoints:
- \`POST /api/experiments\` \`{ key, variants: [{ key, weight? }], salt?, active? }\`.
- \`GET  /api/experiments/:key/assign/:user\` → the user's variant (deterministic; no exposure logged).
- \`POST /api/experiments/:key/expose\` \`{ user }\` → assigns AND logs the exposure once.
- \`GET  /api/experiments/:key/counts\` → per-variant exposure counts.
- \`GET  /api/experiments\` → all experiments.

Because assignment is a pure function of the ids, you can call \`assign\` on the client OR server and get the
same answer — no round-trip needed for stickiness. Set \`active:false\` to force everyone to the control (the
first-declared variant). Feed \`counts\` into your stats to read the result.
`;

export interface ExperimentsConfig {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

const INSTRUCTIONS =
  'A/B testing / experiment-assignment starter wired under server/experiments/ (dependency-free domain logic ' +
  'using node:crypto + an Express router). The real guarantee is DETERMINISTIC STICKY ASSIGNMENT: assign() is a ' +
  'PURE hash of (experiment salt + user) → a stable [0,1) bucket → the weighted variant, so the SAME user ' +
  'ALWAYS gets the SAME variant with no stored state; variant WEIGHTS are respected across the population; ' +
  'expose() logs the exposure once per user for exact counts(). An inactive/unknown experiment returns the ' +
  'first-declared variant (control) and never throws on the hot path. routes.ts exposes POST /experiments, GET ' +
  '/experiments/:key/assign/:user (no logging), POST /experiments/:key/expose ({user}), GET ' +
  '/experiments/:key/counts and GET /experiments. Mount with app.use("/api", experimentRouter). Assignment is ' +
  'pure so client and server agree with no round-trip. Distinct from generate_feature_flags (LaunchDarkly/' +
  'Unleash provider). In-memory by default — swap the Maps for your DB.';

export function generateExperimentsIntegration(): ExperimentsConfig {
  return {
    files: {
      'server/experiments/experimentService.ts': EXPERIMENTS_SERVICE_SOURCE,
      'server/experiments/routes.ts': EXPERIMENTS_ROUTES_SOURCE,
      'server/experiments/README.md': EXPERIMENTS_README,
    },
    dependencies: [{ name: 'express', version: '^4.21.0' }],
    instructions: INSTRUCTIONS,
  };
}
