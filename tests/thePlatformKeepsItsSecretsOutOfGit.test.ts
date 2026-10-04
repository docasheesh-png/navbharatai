// THE SECURITY CHECKLIST, APPLIED TO NAVBHARATAI ITSELF (admin 2026-10-04).
//
// The admin forwarded a 21-point "don't ship your app until you check this" list and asked which ones
// NavBharatAI meets. The audit found five real gaps, each locked here as a CLASS:
//   1. `.gitignore` and `.dockerignore` did not ignore a live `.env` (points 2, 3).
//   2. Nothing scanned THIS repository for committed secrets — the engine scans users' apps, never its
//      own code (points 3, 18).
//   3. Every per-address limit read the caller-written first X-Forwarded-For entry, so the admin login
//      lockout, the OTP send limit and the bot guard could be walked past with one header (point 17).
//      `guestDailyQuota.ts` had found it and fixed it for itself only — the instance, not the class.
//   4. The phone build pushed a workspace `.env` whole to the user's GitHub repo, server secrets
//      included, and in a static app packaged it INTO the APK at www/.env (points 2, 3, 7).
//   5. The GitHub push excluded only a ROOT-level `.env`; `apps/web/.env` went through.
// Plus the lock that admin routes stay guarded server-side (point 10), which held but had no census.

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import http from 'node:http';
import express from 'express';
import { scanSecurity } from '../src/server/AgentV3/SecurityAnalysis';
import { isLiveEnvFilePath } from '../src/lib/envFile';
import { clientAddress, TRUSTED_PROXY_HOPS } from '../src/server/lib/clientAddress';
import { requestAddress } from '../src/server/lib/guestDailyQuota';
import { publicEnvOnly, hasNoAssignments } from '../src/server/lib/publicEnvOnly';
import { assembleMobileProject } from '../src/server/lib/mobileProjectAssembler';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const tracked = (): string[] => execSync('git ls-files', { cwd: root }).toString().split('\n').filter(Boolean);

// ── 1. ignore files ──────────────────────────────────────────────────────────────────────────────
describe('a live .env never enters git or the image', () => {
  it('.gitignore and .dockerignore ignore .env and .env.*, and keep the template', () => {
    for (const file of ['.gitignore', '.dockerignore']) {
      const lines = read(file).split('\n').map((l) => l.trim());
      expect(lines, file).toContain('.env');
      expect(lines, file).toContain('.env.*');
      expect(lines, file).toContain('!.env.example');
    }
  });

  it('no live env file is tracked', () => {
    expect(tracked().filter((f) => isLiveEnvFilePath(f))).toEqual([]);
  });

  it('the one definition: live files yes, committed templates no', () => {
    for (const f of ['.env', '.env.local', 'apps/web/.env.production']) expect(isLiveEnvFilePath(f), f).toBe(true);
    for (const f of ['.env.example', 'server/.env.sample', '.env.template', 'env.ts', 'src/.envrc.md']) expect(isLiveEnvFilePath(f), f).toBe(false);
  });
});

// ── 2. the repository's own secret census ───────────────────────────────────────────────────────
const SECRET_RULES = new Set([
  'hardcoded-secret', 'connection-string-credentials', 'url-embedded-credentials', 'hardcoded-jwt-secret',
  'aws-access-key', 'private-key', 'hardcoded-auth-header', 'hardcoded-provider-token',
]);

/**
 * What the scanner flags today and why each is not a secret. Keyed by file + rule, so a NEW finding in
 * any file — or a new rule firing in a listed one — fails CI. Adding a row is a decision with a reason.
 */
const NOT_A_SECRET: Record<string, string> = {
  'android/app/google-services.json|hardcoded-provider-token': 'Firebase web API key — public by design; protected by Firestore rules, App Check and API-key restrictions',
  'ios-config/GoogleService-Info.plist|hardcoded-provider-token': 'Firebase web API key — public by design',
  'firebase-applet-config.json|hardcoded-provider-token': 'Firebase web API key — public by design',
  'src/firebase-applet-config.json|hardcoded-provider-token': 'Firebase web API key — public by design',
  'src/config/firebase.ts|hardcoded-provider-token': 'Firebase web API key fallback — public by design',
  '.github/workflows/ios-ipa.yml|private-key': 'PEM header/footer text used to rebuild a key from a repo secret — no key material',
  'src/server/lib/mobileShipKit.ts|private-key': 'the same PEM header/footer text inside a generated workflow — no key material',
  'src/server/AgentV3/SecurityAnalysis.ts|url-embedded-credentials': 'the detection regex itself',
  'src/server/lib/DeployArtifactGenerator.ts|connection-string-credentials': "local docker-compose dev database passwords in a template for the USER's app",
  'src/components/ide/GitPanel.tsx|hardcoded-auth-header': "a literal placeholder ('vercel-api') sent to our own route, not a credential",
  'src/server/AgentV3/signInExplore.ts|hardcoded-secret': 'the throwaway password the sign-in check makes at random for a browser-only app and discards with its browser profile (#3526) — not a credential',
  'src/server/lib/appImageKeyOptions.ts|hardcoded-secret': "the label text 'sk_…' naming the key FORMAT the owner must paste (#3528) — no key material",
};

describe('🔒 this repository ships no secret (census)', () => {
  const files = tracked()
    .filter((f) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f) && !f.startsWith('tests/'))
    .filter((f) => /\.(ts|tsx|js|mjs|cjs|json|ya?ml|sh|toml|plist|gradle|xml|html|properties)$/.test(f));

  const findings = (() => {
    const out = new Set<string>();
    for (const f of files) {
      let c = '';
      try { if (statSync(join(root, f)).size > 2_000_000) continue; c = readFileSync(join(root, f), 'utf8'); } catch { continue; }
      for (const x of scanSecurity(f, c)) if (SECRET_RULES.has(x.rule) && x.severity === 'high') out.add(`${f}|${x.rule}`);
    }
    return [...out];
  })();

  it('scans real files (canary — a scanner that reads nothing passes forever)', () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(scanSecurity('src/cfg.ts', 'const k = "AKIAZ4XY7QWERTY12345";').some((x) => x.rule === 'aws-access-key')).toBe(true);
  });

  it('every finding is a listed non-secret', () => {
    const unexplained = findings.filter((k) => !NOT_A_SECRET[k]);
    expect(unexplained, 'a new hardcoded credential — move it to Cloud Run env / Secret Manager').toEqual([]);
  });

  it('every listed non-secret still exists, so the list cannot rot into a blanket pass', () => {
    for (const k of Object.keys(NOT_A_SECRET)) expect(findings, k).toContain(k);
  });
});

// ── 3. the caller's address ─────────────────────────────────────────────────────────────────────
describe('🔒 a caller cannot choose its own address', () => {
  const req = (xff: string | string[] | undefined, remote = '10.0.0.1') =>
    ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } }) as never;

  it('reads the entry Google appended, never the one the caller wrote', () => {
    expect(clientAddress(req('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(req('6.6.6.6,7.7.7.7, 203.0.113.9'))).toBe('203.0.113.9');
    expect(clientAddress(req(['6.6.6.6', '203.0.113.9']))).toBe('203.0.113.9');
    expect(clientAddress(req(undefined))).toBe('10.0.0.1');
    expect(requestAddress(req('6.6.6.6, 203.0.113.9'))).toBe('203.0.113.9'); // the guest quota agrees
  });

  it('server.ts trusts exactly one hop, never `true`', () => {
    const server = read('server.ts');
    expect(server).toContain("app.set('trust proxy', TRUSTED_PROXY_HOPS);");
    expect(server).not.toMatch(/app\.set\('trust proxy',\s*true\)/);
    expect(TRUSTED_PROXY_HOPS).toBe(1);
  });

  it('with one trusted hop, Express gives req.ip the same answer (real request)', async () => {
    const app = express();
    app.set('trust proxy', TRUSTED_PROXY_HOPS);
    app.get('/ip', (r, s) => { s.json({ ip: r.ip, ours: clientAddress(r) }); });
    const srv = http.createServer(app);
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const port = (srv.address() as { port: number }).port;
    try {
      const body = await new Promise<string>((ok, bad) => {
        http.get({ host: '127.0.0.1', port, path: '/ip', headers: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' } }, (res) => {
          let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => ok(d));
        }).on('error', bad);
      });
      expect(JSON.parse(body)).toEqual({ ip: '203.0.113.9', ours: '203.0.113.9' });
    } finally { srv.close(); }
  });

  it('no platform server file parses the caller-written first entry (census)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(root, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(root, rel)).isDirectory()) { walk(rel); continue; }
        if (!/\.ts$/.test(name) || /\.test\.ts$/.test(name)) continue;
        // *Generator.ts files are templates written into USERS' apps, not this server.
        if (/Generator\.ts$/.test(name)) continue;
        const src = readFileSync(join(root, rel), 'utf8');
        if (/x-forwarded-for[^\n]{0,120}split\(\s*['"],['"]\s*\)\s*\[\s*0\s*\]/i.test(src)) offenders.push(rel);
      }
    };
    walk('src/server');
    if (/x-forwarded-for[^\n]{0,120}split\(\s*['"],['"]\s*\)\s*\[\s*0\s*\]/i.test(read('server.ts'))) offenders.push('server.ts');
    expect(offenders).toEqual([]);
  });
});

// ── 4/5. files that leave NavBharatAI ───────────────────────────────────────────────────────────
describe('🔒 a workspace .env never leaves whole', () => {
  const env = '# keys\nVITE_SUPABASE_URL=https://x.supabase.co\nDATABASE_URL=postgres://u:p@h/db\nexport STRIPE_SECRET_KEY=sk_live_abc\nNEXT_PUBLIC_MAPS=pk\n';

  it('keeps only client-public lines, and names (never values) what it removed', () => {
    const r = publicEnvOnly(env);
    expect(r.content).toContain('VITE_SUPABASE_URL=https://x.supabase.co');
    expect(r.content).toContain('NEXT_PUBLIC_MAPS=pk');
    expect(r.content).not.toContain('sk_live_abc');
    expect(r.content).not.toContain('postgres://');
    expect(r.removed).toEqual(['DATABASE_URL', 'STRIPE_SECRET_KEY']);
    expect(hasNoAssignments('# only a comment\n\n')).toBe(true);
  });

  const opts = { appName: 'Bharat Alpha', appId: 'com.bharat.alpha' };

  it('a static app: the .env is dropped — it would have been packaged into the APK', () => {
    const shipped = assembleMobileProject({ 'index.html': '<html>hi</html>', '.env': env }, {}, opts);
    expect(Object.keys(shipped.files).some((p) => /(^|\/)\.env$/.test(p))).toBe(false);
    expect(JSON.stringify(shipped.files)).not.toContain('sk_live_abc');
    expect(shipped.notes.join(' ')).toContain('STRIPE_SECRET_KEY');
    expect(shipped.notes.join(' ')).not.toContain('sk_live_abc');
  });

  it('a built app: the .env keeps the values its bundler publishes, and loses the server secrets', () => {
    const vite = {
      'package.json': JSON.stringify({ name: 'shop', scripts: { build: 'vite build' }, dependencies: { vite: '^5.0.0' } }),
      'index.html': '<html><script type="module" src="/src/main.tsx"></script></html>',
      'src/main.tsx': 'export {}',
      '.env': env,
      '.env.example': 'STRIPE_SECRET_KEY=your_key_here\n',
    };
    const shipped = assembleMobileProject(vite, {}, opts);
    expect(shipped.files['.env']).toContain('VITE_SUPABASE_URL=https://x.supabase.co');
    expect(shipped.files['.env']).not.toContain('sk_live_abc');
    expect(shipped.files['.env.example']).toBe('STRIPE_SECRET_KEY=your_key_here\n'); // a template is untouched
    expect(JSON.stringify(shipped.files)).not.toContain('postgres://u:p@h/db');
  });

  it('the GitHub push uses the one definition, so a nested .env is excluded too', () => {
    const gh = read('src/server/routes/github.ts');
    expect(gh).toContain('isLiveEnvFilePath(path)');
    expect(gh).not.toContain("lowerPath.startsWith('.env')");
  });
});

// ── point 10 ────────────────────────────────────────────────────────────────────────────────────
describe('🔒 every /api/admin route is guarded on the server (census)', () => {
  const OPEN_ON_PURPOSE = new Set(['post /api/admin/login']);
  const GUARD = /verifyAdminToken|requireAdmin|adminOk\(|adminRequestOk\(/;

  it('no admin route is reachable without the admin check', () => {
    const unguarded: string[] = [];
    const routesDir = join(root, 'src/server/routes');
    const sources = readdirSync(routesDir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
      .map((n) => [`src/server/routes/${n}`, readFileSync(join(routesDir, n), 'utf8')] as const)
      .concat([['server.ts', read('server.ts')] as const]);
    let count = 0;
    for (const [file, src] of sources) {
      const re = /app\.(get|post|put|patch|delete)\(\s*'(\/api\/admin[^']*)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        count++;
        const key = `${m[1]} ${m[2]}`;
        if (OPEN_ON_PURPOSE.has(key)) continue;
        if (!GUARD.test(src.slice(m.index, m.index + 1500))) unguarded.push(`${key} (${file})`);
      }
    }
    expect(count).toBeGreaterThan(80);
    expect(unguarded).toEqual([]);
  });
});
