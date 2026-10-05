import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Q-622 (forensic audit 2026-10-04): a caller with NO account must never run on the paid tier.
 *
 * THE INSTANCE. With `PROFESSIONAL_FREE_QUOTA=off`, the shared Professionals / Doctor AI gate returned
 * `tier: 'paid'` for an anonymous caller — the full chain, Claude included — and charged nothing, because
 * there was no wallet. The Other-AI tool gate returned the same `'paid'` for an anonymous caller while its
 * flag was off.
 *
 * THE CLASS. "What does a caller without an account get?" was answered separately inside each gate, and
 * the answers drifted. Now ONE table answers it (`src/server/lib/anonymousCapabilities.ts`), every gate
 * asks it first, and this file is the census: the table never says `paid`, every gate consults it, every
 * guest route carries the guest allowance, every sign-in route enforces the sign-in, and every route file
 * that calls a model is accounted for — so a new route or a new gate cannot quietly bypass it.
 */

const state = { used: 0, balance: 100 as number | null };

vi.mock('../src/server/professionals/ProfessionalPassStore', () => ({
  professionalPassStore: { getStatus: async () => ({ active: false, expiresAt: null, plan: null }) },
}));
vi.mock('../src/server/professionals/ProfessionalUsageStore', () => ({
  professionalUsageStore: { getTodayCount: async () => state.used, increment: async () => state.used + 1 },
  professionalExamUsageStore: { getTodayCount: async () => 0, increment: async () => 1 },
  istDayKey: () => '2026-10-05',
}));
vi.mock('../src/server/tools/ToolUsageStore', () => ({
  toolUsageStore: { getTodayCount: async () => 0, increment: async () => 1 },
  usageDocId: (uid: string, bucket: string) => `${uid}__${bucket}`,
}));
vi.mock('../src/server/AgentV3/WalletBalance', () => ({
  readWalletBalanceInr: async () => state.balance,
  firestoreWalletReader: () => ({}),
}));
vi.mock('../src/server/lib/serverDb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/lib/serverDb')>()),
  getServerDb: () => ({}),
}));

const { ANONYMOUS_CAPABILITIES, anonymousCallerTier, anonymousCapabilityFor } =
  await import('../src/server/lib/anonymousCapabilities');
const { gateProfessionalTurn, gateProfessionalExam } = await import('../src/server/professionals/passGate');
const { gateToolAction } = await import('../src/server/tools/toolGate');

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comments out, so a sentence ABOUT a call never counts as the call. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1');

const ROUTES_DIR = 'src/server/routes';
const routeFiles = readdirSync(join(ROOT, ROUTES_DIR))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => `${ROUTES_DIR}/${f}`);
const SERVER_FILES = [...routeFiles, 'server.ts'];

type Cap = (typeof ANONYMOUS_CAPABILITIES)[keyof typeof ANONYMOUS_CAPABILITIES];
const entries = Object.entries(ANONYMOUS_CAPABILITIES) as Array<[string, Cap]>;

/** Path constants used in place of a literal in a registration (`app.post(GATEWAY_PATH, …)`). */
function pathConstants(): Record<string, string> {
  const out: Record<string, string> = {};
  const files = [...SERVER_FILES, 'src/server/lib/appAiGateway.ts'];
  for (const f of files) {
    for (const m of read(f).matchAll(/export const ([A-Z_]+_PATH) = '([^']+)'/g)) out[m[1]] = m[2];
  }
  return out;
}

interface Registration { file: string; path: string; line: string; handler: string }

/** Every Express registration in the server, with its line and its handler's source. */
function registrations(): Registration[] {
  const consts = pathConstants();
  const out: Registration[] = [];
  for (const file of SERVER_FILES) {
    const src = code(read(file));
    const re = /app\.(?:post|get|put|patch|delete|all)\(\s*(?:'([^']+)'|"([^"]+)"|([A-Z_]+_PATH))/g;
    const hits = [...src.matchAll(re)];
    hits.forEach((m, i) => {
      const path = m[1] ?? m[2] ?? consts[m[3]];
      if (!path) return;
      const start = m.index ?? 0;
      const end = i + 1 < hits.length ? (hits[i + 1].index ?? src.length) : src.length;
      const lineEnd = src.indexOf('\n', start);
      out.push({ file, path, line: src.slice(start, lineEnd === -1 ? undefined : lineEnd), handler: src.slice(start, end) });
    });
  }
  return out;
}
const REGS = registrations();

const savedEnv = { ...process.env };
beforeEach(() => {
  state.used = 0;
  state.balance = 100;
  delete process.env.PROFESSIONAL_FREE_QUOTA;
  delete process.env.PROFESSIONAL_PAID_ENABLED;
  delete process.env.AGENTV3_FREE_LIST;
  process.env.AI_WALLET_SPEND = 'on';
});
afterEach(() => { process.env = { ...savedEnv }; });

describe('🔒 the table: an anonymous caller is never on the paid tier', () => {
  it('no surface maps an anonymous caller to `paid`', () => {
    for (const [surface, cap] of entries) {
      expect(['guest', 'owner-billed', 'sign-in'], surface).toContain(cap.access);
      if (cap.access !== 'sign-in') expect(cap.tier, surface).toBe('free');
      expect(JSON.stringify(cap), surface).not.toContain('paid');
    }
  });

  it('the resolver never returns `paid`, for any surface, and refuses an unknown one (fail-closed)', () => {
    for (const [surface, cap] of entries) {
      const r = anonymousCallerTier(surface);
      if (r.allow) {
        expect(cap.access, surface).not.toBe('sign-in');
        expect(r.tier, surface).toBe('free');
        expect(r.uid).toBeNull();
      } else {
        expect(cap.access, surface).toBe('sign-in');
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('login_required');
      }
    }
    const unknown = anonymousCallerTier('a-new-ai-route-nobody-declared');
    expect(unknown.allow).toBe(false);
    expect(anonymousCapabilityFor('toString')).toBeUndefined(); // no prototype key is a surface
  });

  it('the sign-in prompt is the shared one, naming the surface', () => {
    const r = anonymousCallerTier('doctor-ai');
    expect(r.allow).toBe(false);
    if (!r.allow) {
      expect(String(r.body.error)).toContain('Please sign in to use Doctor AI.');
      expect(r.body.noun).toBe('Doctor AI');
    }
  });

  it('the type forbids it: `{ uid: null, tier: "paid" }` is not a CallerTier', () => {
    const src = read('src/server/lib/anonymousCapabilities.ts');
    expect(src).toMatch(/export type AnonymousTier = Exclude<ModelTier, 'paid'>;/);
    expect(src).toMatch(/\| \{ uid: null; tier: AnonymousTier \}/);
    expect(src).toMatch(/satisfies Record<string, AnonymousCapability>/);
  });
});

describe('🔴 the instance: PROFESSIONAL_FREE_QUOTA=off no longer hands an anonymous caller the paid chain', () => {
  it('Professionals, anonymous, allowance OFF → sign in (was: allow, tier "paid", uncharged)', async () => {
    process.env.PROFESSIONAL_FREE_QUOTA = 'off';
    const g = await gateProfessionalTurn(null, null);
    expect(g.allow).toBe(false);
    if (!g.allow) {
      expect(g.status).toBe(401);
      expect(g.body.code).toBe('login_required');
    }
  });

  it('Doctor AI, anonymous, allowance OFF → sign in, naming Doctor AI', async () => {
    process.env.PROFESSIONAL_FREE_QUOTA = 'off';
    const g = await gateProfessionalTurn(null, null, 'doctor-ai');
    expect(g.allow).toBe(false);
    if (!g.allow) expect(g.body.noun).toBe('Doctor AI');
  });

  it('Exam mode, anonymous, allowance OFF → sign in', async () => {
    process.env.PROFESSIONAL_FREE_QUOTA = 'off';
    const g = await gateProfessionalExam(null, null, 5);
    expect(g.allow).toBe(false);
  });

  it('allowance ON (the default) → anonymous is still asked to sign in, in every gate', async () => {
    for (const g of [await gateProfessionalTurn(null, null), await gateProfessionalExam(null, null, 3)]) {
      expect(g.allow).toBe(false);
      if (!g.allow) expect(g.body.code).toBe('login_required');
    }
  });

  it('a SIGNED-IN caller with the allowance OFF is exactly as before: the paid chain, charged in full', async () => {
    process.env.PROFESSIONAL_FREE_QUOTA = 'off';
    const g = await gateProfessionalTurn('student-1', null);
    expect(g.allow && g.tier === 'paid' && g.billableFraction === 1 && g.uid === 'student-1').toBe(true);
  });

  it('a SIGNED-IN caller inside the allowance is still on the free chain', async () => {
    const g = await gateProfessionalTurn('student-1', null);
    expect(g.allow && g.tier === 'free' && g.billableFraction === 0).toBe(true);
  });
});

describe('🔴 the sibling: the Other-AI tool gate', () => {
  it('flag off, anonymous, guest tool surface → allowed on the FREE tier (was "paid")', async () => {
    for (const surface of ['debug', 'design', 'app-debug'] as const) {
      const r = await gateToolAction(null, null, 'ai_tool', surface);
      expect(r.allow, surface).toBe(true);
      if (r.allow) expect(r.tier, surface).toBe('free');
    }
  });

  it('flag off, anonymous, sign-in surface → refused (was: allowed, "paid")', async () => {
    for (const [bucket, surface] of [['image', 'image-generation'], ['image', 'picture-editing'], ['ai_tool', 'screenshot-to-code']] as const) {
      const r = await gateToolAction(null, null, bucket, surface);
      expect(r.allow, surface).toBe(false);
    }
  });

  it('a SIGNED-IN caller, flag off, is exactly as before', async () => {
    const r = await gateToolAction('u1', null, 'ai_tool', 'debug');
    expect(r.allow && r.tier === 'paid' && r.uid === 'u1').toBe(true);
  });
});

describe('🔒 SOURCE CENSUS — every AI route reaches the one table', () => {
  it('every gate that can produce `tier: "paid"` imports the table and types its result with CallerTier', () => {
    const scan = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? scan(`${dir}/${d.name}`) : d.name.endsWith('.ts') && !d.name.endsWith('.test.ts') ? [`${dir}/${d.name}`] : []);
    const deciders = ['src/server/routes', 'src/server/professionals', 'src/server/tools', 'src/server/lib']
      .flatMap(scan)
      .filter((f) => /tier:\s*'paid'/.test(code(read(f))));
    // The census must find the two known gates — an empty list would mean the scan broke, not that we are safe.
    expect(deciders.sort()).toEqual(['src/server/professionals/passGate.ts', 'src/server/tools/toolGate.ts']);
    for (const f of deciders) {
      const src = code(read(f));
      expect(src, f).toMatch(/from '\.\.\/lib\/anonymousCapabilities'/);
      expect(src, f).toContain('anonymousCallerTier(');
      expect(src, f).toContain('& CallerTier)');
    }
  });

  it('each anonymous check comes FIRST in its gate — before any env flag is read', () => {
    const pass = code(read('src/server/professionals/passGate.ts'));
    for (const fn of ['export async function gateProfessionalTurn(', 'export async function gateProfessionalExam(']) {
      const body = pass.slice(pass.indexOf(fn));
      expect(body.indexOf('if (!uid)'), fn).toBeGreaterThan(-1);
      expect(body.indexOf('if (!uid)'), fn).toBeLessThan(body.indexOf('professionalFreeQuotaEnabled()'));
    }
    const tool = code(read('src/server/tools/toolGate.ts'));
    const body = tool.slice(tool.indexOf('export async function gateToolAction('));
    expect(body.indexOf('anonymousCallerTier(surface)')).toBeGreaterThan(-1);
    expect(body.indexOf('anonymousCallerTier(surface)')).toBeLessThan(body.indexOf('aiWalletSpendEnabled()'));
  });

  it('every gate call in a route names a surface that is in the table', () => {
    let calls = 0;
    for (const f of routeFiles) {
      const src = code(read(f));
      for (const m of src.matchAll(/gate(?:ToolAction|ProfessionalTurn)\(([^;]*?)\);/g)) {
        calls++;
        const surface = m[1].match(/'([a-z-]+)'\s*$/)?.[1];
        expect(surface, `${f}: ${m[0]}`).toBeDefined();
        expect(anonymousCapabilityFor(surface as string), `${f}: ${surface}`).toBeDefined();
      }
    }
    expect(calls).toBeGreaterThanOrEqual(9);
  });

  it('every route in the table is really registered', () => {
    for (const [surface, cap] of entries) {
      for (const path of cap.routes) {
        expect(REGS.filter((r) => r.path === path).length, `${surface} → ${path}`).toBe(1);
      }
    }
  });

  it('every `guestDailyQuota(...)` route is a GUEST surface of the table, listed under that surface', () => {
    const guarded = REGS.filter((r) => r.line.includes('guestDailyQuota('));
    expect(guarded.length).toBeGreaterThanOrEqual(11);
    for (const r of guarded) {
      const surface = r.line.match(/guestDailyQuota\('([^']+)'\)/)?.[1] as string;
      const cap = anonymousCapabilityFor(surface);
      expect(cap?.access, `${r.file} ${r.path}`).toBe('guest');
      expect(cap?.routes, `${r.file} ${r.path}`).toContain(r.path);
    }
    // And nothing mounts the middleware off a registration line, where this census could not see it.
    for (const f of SERVER_FILES) {
      const src = code(read(f));
      const uses = (src.match(/guestDailyQuota\(/g) ?? []).length;
      const onLines = REGS.filter((r) => r.file === f && r.line.includes('guestDailyQuota(')).length;
      expect(uses, f).toBe(onLines);
    }
  });

  it('every GUEST surface route carries the guest daily allowance (a guest surface is never unbounded)', () => {
    for (const [surface, cap] of entries) {
      if (cap.access !== 'guest') continue;
      for (const path of cap.routes) {
        const reg = REGS.find((r) => r.path === path);
        expect(reg?.line, `${surface} → ${path}`).toContain(`guestDailyQuota('${surface}')`);
      }
    }
  });

  it('every SIGN-IN surface route enforces the sign-in before it serves', () => {
    const enforcerFor = (surface: string, noun: string): RegExp[] => [
      new RegExp(`requireAccountForCostlyAi\\(req, '${noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`),
      new RegExp(`gateProfessionalTurn\\([^;]*'${surface}'\\)`),
      ...(surface === 'professional-exam' ? [/gateProfessionalExam\(/] : []),
      ...(surface === 'app-builder' ? [/buildRequiresSignIn\(/] : []),
    ];
    for (const [surface, cap] of entries) {
      if (cap.access !== 'sign-in') continue;
      const handlers = cap.routes.length
        ? cap.routes.map((p) => REGS.find((r) => r.path === p)?.handler ?? '')
        // A surface with no route of its own (picture editing lives inside the free chat).
        : [code(read(`${ROUTES_DIR}/chat.ts`))];
      for (const h of handlers) {
        expect(enforcerFor(surface, cap.noun).some((re) => re.test(h)), surface).toBe(true);
      }
    }
  });

  it('every OWNER-BILLED route answers through the owner-billed paths', () => {
    for (const [surface, cap] of entries) {
      if (cap.access !== 'owner-billed') continue;
      for (const path of cap.routes) {
        const h = REGS.find((r) => r.path === path)?.handler ?? '';
        expect(/answerForApp\(|imageForApp\(/.test(h), `${surface} → ${path}`).toBe(true);
      }
    }
    expect(code(read('src/server/lib/appAiAnswer.ts'))).toContain("anonymousCallerTier('app-assistant')");
  });

  it('every route file that can run a model is accounted for — by the table or by a written reason', () => {
    const AI_MARKERS = /from '\.\.\/(?:lib|AI|professionals|repoAnalyst)\/(?:aiRouter|professionalRouting|aiCalls|visionChain|imageEditRun|AIRouterManager|engine|analyst|generate|appAiAnswer|appAiImage)'/;
    const NOT_ANONYMOUS: Record<string, string> = {
      'developerApi.ts': 'API-key auth on every route: each caller is an account, billed to it',
      'pro.ts': 'every model route here is retired with a 410 and touches no model',
      'appAiOwner.ts': "owner-only: a verified token that owns the workspace (the owner's preview)",
      'agentv3Resilient.ts': 'no routes: a build helper reached only after the build sign-in check',
      'warm.ts': 'builds the routers and probes provider health; runs no model turn on caller input',
    };
    const tableFiles = new Set(entries.flatMap(([, cap]) => cap.routes.map((p) => REGS.find((r) => r.path === p)?.file)));
    const aiFiles = routeFiles.filter((f) => AI_MARKERS.test(read(f)));
    expect(aiFiles.length).toBeGreaterThanOrEqual(15);
    for (const f of aiFiles) {
      const name = f.split('/').pop() as string;
      expect(tableFiles.has(f) || name in NOT_ANONYMOUS, `${f} calls a model but is not in the anonymous table`).toBe(true);
    }
  });
});
