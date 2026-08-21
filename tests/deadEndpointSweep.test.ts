import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

/**
 * EVERY ENDPOINT THE APP CALLS MUST EXIST.
 *
 * The second absolute rule says a button must do what it says. The quietest way to break that is not a
 * missing handler — it is a handler that posts to a path nobody ever built. Nothing fails at compile
 * time, nothing fails in review, and the user gets an error message that blames THEM.
 *
 * Found 2026-08-21, sweeping the client after the `/api/notifications` route collision: the "Have a
 * promo code?" box in the Professional Pass modal posted to `/api/payment/validate-mode-promo`. That
 * path appeared exactly once in the entire repository — in the call itself. Every promo code a user
 * typed, valid or not, came back "Validation failed". Its success branch also promised a ₹1 checkout
 * that `create-order` knows nothing about, so there was no honest way to wire it either; the box was
 * removed, and the promo redemption that genuinely works (`POST /api/payment/redeem-coupon`, in Wallet
 * & Billing) is where a code goes.
 *
 * This test walks every `fetch(...)` / `axios.<verb>(...)` / `useSWR(...)` in the client and checks the
 * path against the routes the server actually registers.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !full.includes('.test.')) out.push(full);
  }
  return out;
}

/** Comments out, so an endpoint named in prose is never mistaken for a call. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Multi-line template literals out. NavBharatAI ships a lot of Express and React code AS TEXT — plugin
 * `setupCode`, the PWA push snippet, payment-integration recipes — and that text is full of `fetch()`
 * calls to endpoints in the USER'S generated app, which have nothing to do with our server. A real
 * call in our own code always has its URL on one line, so the line count is what separates them.
 */
function stripMultilineTemplates(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const start = src.indexOf('`', i);
    if (start < 0) { out += src.slice(i); break; }
    let end = start + 1;
    while (end < src.length && src[end] !== '`') end += src[end] === '\\' ? 2 : 1;
    const span = src.slice(start, end + 1);
    out += src.slice(i, start) + (span.includes('\n') ? '``' : span);
    i = end + 1;
  }
  return out;
}

// ── Server side ─────────────────────────────────────────────────────────────

const REGISTRATION = /^[ \t]*(?:app|router|r)\.(?:get|post|put|delete|patch|use|all)\(\s*['"`]([^'"`]+)['"`]/gm;

function registeredPaths(): string[] {
  const files = [join(process.cwd(), 'server.ts'), ...walk(join(process.cwd(), 'src/server')).filter((f) => f.endsWith('.ts'))];
  const paths = new Set<string>();
  for (const file of files) {
    for (const m of [...stripComments(readFileSync(file, 'utf8')).matchAll(REGISTRATION)]) {
      if (m[1].startsWith('/')) paths.add(m[1]);
    }
  }
  return [...paths];
}

/** `/api/wallet/:userId` → a matcher for one concrete path. */
const routeMatcher = (path: string) => new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`);

// ── Client side ─────────────────────────────────────────────────────────────

const CALL = /(?:fetch|axios\.(?:get|post|put|delete|patch)|useSWR)\(\s*['"`](\/api\/[^'"`]*)/g;
const SEGMENT = '\u0001'; // stands in for a `${…}` the test cannot evaluate

/**
 * Paths the sweep reports but which are NOT ours to serve. Kept short and explained on purpose — an
 * allowlist that grows without reasons is how a guard stops guarding.
 */
const NOT_OUR_SERVER = new Set([
  // Plugin catalogue `setupCode` samples (SWR / auth), shown to the user as code for THEIR app. They
  // survive template-stripping only because a nested `${}` inside the sample confuses the scanner.
  '/api/user',
  '/api/verify',
]);

function clientCalls(): Array<{ path: string; file: string }> {
  const roots = ['src/components', 'src/hooks', 'src/lib', 'src/contexts'];
  const files = [join(process.cwd(), 'src/App.tsx'), join(process.cwd(), 'src/main.tsx')]
    .filter(existsSync)
    .concat(roots.flatMap((r) => (existsSync(join(process.cwd(), r)) ? walk(join(process.cwd(), r)) : [])));

  const calls: Array<{ path: string; file: string }> = [];
  for (const file of files) {
    const src = stripMultilineTemplates(stripComments(readFileSync(file, 'utf8')));
    for (const m of [...src.matchAll(CALL)]) {
      const path = m[1].replace(/\$\{[^}]*\}/g, SEGMENT).split('?')[0].replace(/\/$/, '');
      if (!path || path === '/api') continue;
      calls.push({ path, file: file.replace(process.cwd() + '/', '') });
    }
  }
  return calls;
}

describe('the client never calls an endpoint the server does not have', () => {
  const routes = registeredPaths();

  it('finds the routes and the calls at all', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(clientCalls().length).toBeGreaterThan(100);
  });

  it('every fetched path resolves to a registered route', () => {
    const dead = new Map<string, Set<string>>();
    for (const { path, file } of clientCalls()) {
      if (NOT_OUR_SERVER.has(path)) continue;
      // A path containing `${…}` is checked both ways: the placeholder may stand where a route has a
      // `:param`, or a route's `:param` may stand where the client interpolates.
      const concrete = path.split(SEGMENT).join('x');
      const served = routes.some(
        (r) => routeMatcher(r).test(concrete) || new RegExp(`^${path.split(SEGMENT).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`).test(r.replace(/:[A-Za-z0-9_]+/g, 'y')),
      );
      if (!served) {
        const label = path.split(SEGMENT).join('${…}');
        dead.set(label, (dead.get(label) ?? new Set()).add(file));
      }
    }
    const report = [...dead.entries()].map(([p, files]) => `${p} called from ${[...files].join(', ')}`);
    // A path with no route is a button that cannot work, and the user is told it is their fault.
    expect(report).toEqual([]);
  });

  it('the promo box that posted nowhere stays gone, and the working one stays', () => {
    const engine = readFileSync(join(process.cwd(), 'src/hooks/usePaymentEngine.ts'), 'utf8');
    // The CALL, not the word — the file explains in prose why the endpoint was removed, and that
    // explanation is the most useful line in it. Asserting on the axios call keeps both true.
    expect(engine).not.toMatch(/axios\.\w+\(\s*['"`]\/api\/payment\/validate-mode-promo/);
    // Removing the broken one must never take the real redemption with it.
    expect(engine).toContain("axios.post('/api/payment/redeem-coupon'");
    const modals = readFileSync(join(process.cwd(), 'src/components/panels/AppModals.tsx'), 'utf8');
    expect(modals).not.toContain('redeemVishwakarmaPromo');
  });

  it('the generated-app template island is gone from our own source tree', () => {
    // src/pages/InventoryPage.tsx + ProductTable + ProductForm were sample code for apps we GENERATE,
    // sitting in NavBharatAI's own src/ and imported by nothing. CodeGenerator.ts keeps its own copies
    // keyed by those filenames, so deleting the files changes nothing for a generated app — it only
    // stops our tree from carrying pages that call /api/products, a route we do not serve.
    for (const f of ['src/pages/InventoryPage.tsx', 'src/components/ProductTable.tsx', 'src/components/ProductForm.tsx']) {
      expect(existsSync(join(process.cwd(), f))).toBe(false);
    }
    expect(readFileSync(join(process.cwd(), 'src/server/BuildEngine/CodeGenerator.ts'), 'utf8')).toContain('src/pages/InventoryPage.tsx');
  });
});
