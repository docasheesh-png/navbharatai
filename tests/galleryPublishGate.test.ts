/**
 * The publish gate — what may leave a workspace and become PUBLIC SOURCE.
 *
 * Every other publish path here ships an artefact (a rendered snapshot, a signed APK). This one ships
 * source, which sits next to the user's `.env`, their database keys and their payment credentials.
 * Publishing that is not a bug with a bad message; it is handing a stranger their live database.
 *
 * So the tests that matter are the ones asserting a leak CANNOT get out, and — just as important —
 * that an ordinary demo app CAN. A gate that refuses everything gets switched off, and a switched-off
 * gate protects nobody.
 */

import { describe, it, expect } from 'vitest';
import {
  preparePublishBundle,
  findPublishBlockers,
  exclusionFor,
  exclusionSummary,
  MAX_PUBLISH_BYTES,
  MAX_PUBLISH_FILES,
} from '../src/server/lib/galleryPublishGate';

/**
 * A Stripe-SHAPED string, assembled at runtime.
 *
 * It is invented, not a real key — but it matches the format closely enough that GitHub's push
 * protection blocks the branch, which is the detector working as intended on our own repo. Building it
 * from parts keeps the test exercising the real pattern without putting a key-shaped literal in the
 * file, and without anyone reaching for the "allow this secret" bypass.
 */
const FAKE_STRIPE_KEY = ['sk', 'live', '51H8xQ2eZvKYlo2CabcdefghijklmnopqrstuvwxYZ'].join('_');

const app = (extra: Record<string, string> = {}) => ({
  'src/App.tsx': 'export default function App(){ return <div>Hi</div>; }',
  'src/main.tsx': "import App from './App';",
  'package.json': '{"name":"my-app"}',
  ...extra,
});

describe('🔒 secrets can never be published', () => {
  it('a .env file never travels — it is not even a decision', () => {
    const bundle = preparePublishBundle(app({ '.env': 'SUPABASE_KEY=eyJreal.token.value' }));
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(Object.keys(bundle.files)).not.toContain('.env');
    expect(bundle.excluded.find((e) => e.path === '.env')?.reason).toBe('secrets-file');
  });

  it('every .env variant is excluded', () => {
    for (const f of ['.env', '.env.local', '.env.production', '.env.development.local']) {
      expect(exclusionFor(f), f).toBe('secrets-file');
    }
  });

  it('🔒 a real key hardcoded in SOURCE BLOCKS the publish outright', () => {
    // Stripping it silently would leave the user believing they published something they did not.
    const bundle = preparePublishBundle(app({
      'src/pay.ts': `const key = '${FAKE_STRIPE_KEY}';`,
    }));
    expect(bundle.ok).toBe(false);
    if (bundle.ok) return;
    expect(bundle.blockers.length).toBeGreaterThan(0);
    expect(bundle.message).toContain('Cannot publish');
  });

  it('names the exact file and line, so the user can actually fix it', () => {
    const bundle = preparePublishBundle(app({
      'src/aws.ts': "// setup\nconst id = 'AKIAIOSFODNN7EXAMPLZ';",
    }));
    expect(bundle.ok).toBe(false);
    if (bundle.ok) return;
    const b = bundle.blockers.find((x) => x.path === 'src/aws.ts');
    expect(b).toBeTruthy();
    expect(b!.line).toBe(2);
    expect(bundle.message).toContain('src/aws.ts');
  });

  it('🔒 a private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    const bundle = preparePublishBundle(app({ 'src/key.ts': `const k = \`${pem}\`;` }));
    expect(bundle.ok).toBe(false);
  });

  it('🔒 a real value left in a published .env.example blocks', () => {
    // The template DOES travel (it is useful to a remixer), which is exactly why a real value in it is
    // the classic route a key reaches a public repo.
    const bundle = preparePublishBundle(app({ '.env.example': 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456' }));
    expect(bundle.ok).toBe(false);
    if (bundle.ok) return;
    expect(bundle.blockers[0].path).toBe('.env.example');
    expect(bundle.blockers[0].message).toMatch(/placeholders only/);
  });

  it('a .env.example with placeholders publishes fine', () => {
    const bundle = preparePublishBundle(app({ '.env.example': 'OPENAI_API_KEY=your-key-here\nDB_URL=<your-database-url>' }));
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(Object.keys(bundle.files)).toContain('.env.example');
  });

  it('does not scan files that are not travelling anyway', () => {
    // A secret inside node_modules is not ours to report and would only produce noise.
    expect(findPublishBlockers({ 'node_modules/p/i.js': `const k='${FAKE_STRIPE_KEY}';` })).toEqual([]);
  });
});

describe('🔒 but an ordinary app still publishes — a gate that refuses everything gets switched off', () => {
  it('a normal generated app publishes cleanly', () => {
    const bundle = preparePublishBundle(app());
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(Object.keys(bundle.files).sort()).toEqual(['package.json', 'src/App.tsx', 'src/main.tsx']);
  });

  it('a demo/mock credential does NOT block', () => {
    // scanSecurity already downgrades credential-shaped strings in obvious fixture files. If demo apps
    // could not be published, the gallery would be empty and the gate would be removed.
    const bundle = preparePublishBundle(app({
      'src/data/mockData.ts': "export const demoUser = { password: 'password123', apiKey: 'test-key-123' };",
    }));
    expect(bundle.ok).toBe(true);
  });

  it('a placeholder that merely looks like a key does not block', () => {
    const bundle = preparePublishBundle(app({
      'src/config.ts': "const key = process.env.STRIPE_KEY || 'your-stripe-key-here';",
    }));
    expect(bundle.ok).toBe(true);
  });
});

describe('what never travels, and why', () => {
  it('excludes dependencies, build output and lockfiles — all regenerable', () => {
    expect(exclusionFor('node_modules/react/index.js')).toBe('dependency');
    expect(exclusionFor('dist/bundle.js')).toBe('dependency');
    expect(exclusionFor('package-lock.json')).toBe('generated');
    expect(exclusionFor('pnpm-lock.yaml')).toBe('generated');
  });

  it('excludes binaries — a gallery entry is source, not assets', () => {
    expect(exclusionFor('public/logo.png')).toBe('binary');
    expect(exclusionFor('assets/font.woff2')).toBe('binary');
  });

  it('keeps ordinary source', () => {
    for (const f of ['src/App.tsx', 'README.md', 'package.json', 'migrations/001.sql', '.env.example']) {
      expect(exclusionFor(f), f).toBe(null);
    }
  });

  it('drops a single enormous file rather than letting it eat the whole budget', () => {
    const bundle = preparePublishBundle(app({ 'src/generated.ts': 'x'.repeat(250_000) }));
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    expect(bundle.excluded.find((e) => e.path === 'src/generated.ts')?.reason).toBe('too-large');
  });

  it('tells the user plainly what was left out', () => {
    const bundle = preparePublishBundle(app({ '.env': 'K=v', 'package-lock.json': '{}' }));
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    const summary = exclusionSummary(bundle.excluded);
    expect(summary).toContain('your keys stay private');
    expect(summary).toContain('generated or binary');
    expect(exclusionSummary([])).toBe('Everything in your project will be published.');
  });
});

describe('honest refusals', () => {
  it('refuses an empty workspace instead of publishing nothing', () => {
    const bundle = preparePublishBundle({});
    expect(bundle.ok).toBe(false);
    if (bundle.ok) return;
    expect(bundle.message).toContain('build an app first');
  });

  it('refuses a project that is too large, and says the real numbers', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) files[`src/f${i}.ts`] = 'x'.repeat(60_000);
    const bundle = preparePublishBundle(files);
    expect(bundle.ok).toBe(false);
    if (bundle.ok) return;
    expect(bundle.message).toContain(`${Math.round(MAX_PUBLISH_BYTES / 1024)} KB`);
  });

  it('refuses a project with too many files', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_PUBLISH_FILES + 10; i += 1) files[`src/f${i}.ts`] = 'export default 1;';
    const bundle = preparePublishBundle(files);
    expect(bundle.ok).toBe(false);
    if (bundle.ok) return;
    expect(bundle.message).toContain(String(MAX_PUBLISH_FILES));
  });

  it('🔒 never returns a partially-scrubbed bundle alongside ok:true', () => {
    // "Published" must mean what the user thinks it means.
    const bundle = preparePublishBundle(app({ 'src/pay.ts': `const k='${FAKE_STRIPE_KEY}';` }));
    expect(bundle.ok).toBe(false);
    expect((bundle as { files?: unknown }).files).toBeUndefined();
  });

  it('handles junk input without throwing', () => {
    expect(() => preparePublishBundle(undefined as never)).not.toThrow();
    expect(preparePublishBundle({ 'a.ts': null as never }).ok).toBe(false);
  });
});
