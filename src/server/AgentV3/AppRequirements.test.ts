import { describe, it, expect } from 'vitest';
import { detectAppRequirements, unconfiguredRequirements, appRequirementsNotice } from './AppRequirements';

const pkg = (deps: Record<string, string>) => JSON.stringify({ name: 'app', dependencies: deps });

describe('detectAppRequirements — real signals only (packages + env refs)', () => {
  it('returns nothing for an empty / plain app (never nags)', () => {
    expect(detectAppRequirements({ files: null })).toEqual([]);
    expect(detectAppRequirements({ files: {} })).toEqual([]);
    expect(
      detectAppRequirements({
        files: { 'package.json': pkg({ react: '^18.0.0', vite: '^5.0.0' }), 'src/App.tsx': 'export default () => <div/>;' },
      }),
    ).toEqual([]);
  });

  it('detects a service from its package.json dependency', () => {
    const found = detectAppRequirements({ files: { 'package.json': pkg({ razorpay: '^2.9.0' }) } });
    expect(found.map((r) => r.id)).toEqual(['payments_razorpay']);
    expect(found[0].kind).toBe('user');
    expect(found[0].envVars).toContain('RAZORPAY_KEY_ID');
  });

  it('detects a service from a real env reference in source', () => {
    const found = detectAppRequirements({
      files: { 'server/mail.ts': 'const key = process.env.SENDGRID_API_KEY;' },
    });
    expect(found.map((r) => r.id)).toEqual(['email_api']);
  });

  it('detects the bracket + import.meta.env forms too', () => {
    expect(
      detectAppRequirements({ files: { 'src/map.tsx': "const t = import.meta.env['VITE_MAPBOX_TOKEN'];" } }).map((r) => r.id),
    ).toEqual(['maps']);
    expect(
      detectAppRequirements({ files: { 'src/pay.ts': 'const k = process.env["STRIPE_SECRET_KEY"];' } }).map((r) => r.id),
    ).toEqual(['payments_stripe']);
  });

  it('the PROMPT alone never conjures a requirement (high precision)', () => {
    expect(
      detectAppRequirements({ prompt: 'build me an online shop with payments and maps', files: { 'src/App.tsx': 'export default () => null;' } }),
    ).toEqual([]);
  });

  it('a 3-4 feature app surfaces every service it really uses, deduped and catalogue-ordered', () => {
    const found = detectAppRequirements({
      files: {
        'package.json': pkg({ razorpay: '^2.9.0', nodemailer: '^6.9.0', twilio: '^4.0.0', '@supabase/supabase-js': '^2.0.0' }),
        'server/index.ts': 'process.env.RAZORPAY_KEY_ID; process.env.SMTP_HOST;',
      },
    });
    expect(found.map((r) => r.id)).toEqual(['payments_razorpay', 'email_smtp', 'sms', 'database_hosted']);
  });

  it('the SQL database is kind:auto — the sandbox provisions it, so it is never a user task', () => {
    const found = detectAppRequirements({
      files: { 'package.json': pkg({ '@prisma/client': '^5.0.0', pg: '^8.0.0' }), 'server/db.ts': 'process.env.DATABASE_URL' },
    });
    expect(found.map((r) => r.id)).toEqual(['database_sql']);
    expect(found[0].kind).toBe('auto');
    expect(unconfiguredRequirements(found, {})).toEqual([]); // never surfaced to the user
  });

  it('ignores node_modules / dist and a malformed package.json (never crashes)', () => {
    expect(
      detectAppRequirements({ files: { 'node_modules/razorpay/package.json': pkg({ razorpay: '1' }), 'dist/bundle.js': 'process.env.STRIPE_SECRET_KEY' } }),
    ).toEqual([]);
    expect(() => detectAppRequirements({ files: { 'package.json': '{ not json' } })).not.toThrow();
  });

  it('accepts a Map of files (the shape the build actually holds)', () => {
    const files = new Map<string, string>([['package.json', pkg({ cloudinary: '^2.0.0' })]]);
    expect(detectAppRequirements({ files }).map((r) => r.id)).toEqual(['storage']);
  });
});

describe('unconfiguredRequirements — an already-saved secret is not a task', () => {
  const razorpay = detectAppRequirements({ files: { 'package.json': pkg({ razorpay: '^2.9.0' }) } });

  it('surfaces the requirement when the vault is empty', () => {
    expect(unconfiguredRequirements(razorpay, {}).map((r) => r.id)).toEqual(['payments_razorpay']);
    expect(unconfiguredRequirements(razorpay, null).map((r) => r.id)).toEqual(['payments_razorpay']);
  });

  it('drops it once ANY of its keys is really present in the vault', () => {
    expect(unconfiguredRequirements(razorpay, { RAZORPAY_KEY_ID: 'rzp_live_x' })).toEqual([]);
    expect(unconfiguredRequirements(razorpay, { RAZORPAY_KEY_SECRET: 'sek' })).toEqual([]);
  });

  it('an empty / whitespace value does NOT count as configured', () => {
    expect(unconfiguredRequirements(razorpay, { RAZORPAY_KEY_ID: '   ' }).map((r) => r.id)).toEqual(['payments_razorpay']);
    expect(unconfiguredRequirements(razorpay, { RAZORPAY_KEY_ID: '' }).map((r) => r.id)).toEqual(['payments_razorpay']);
  });

  it('an unrelated secret does not satisfy it', () => {
    expect(unconfiguredRequirements(razorpay, { OPENAI_API_KEY: 'sk-x' }).map((r) => r.id)).toEqual(['payments_razorpay']);
  });

  it('a connected database (Supabase in the vault) stops being a task', () => {
    const db = detectAppRequirements({ files: { 'package.json': pkg({ '@supabase/supabase-js': '^2.0.0' }) } });
    expect(unconfiguredRequirements(db, {}).map((r) => r.id)).toEqual(['database_hosted']);
    expect(unconfiguredRequirements(db, { VITE_SUPABASE_URL: 'https://x.supabase.co' })).toEqual([]);
  });
});

describe('appRequirementsNotice — short, localized, honest', () => {
  const razorpay = detectAppRequirements({ files: { 'package.json': pkg({ razorpay: '^2.9.0' }) } });

  it('is EMPTY when there is nothing to ask for (the common case)', () => {
    expect(appRequirementsNotice([], 'hi')).toBe('');
    expect(appRequirementsNotice([], null)).toBe('');
  });

  it('names the exact keys and the exact settings path', () => {
    const msg = appRequirementsNotice(razorpay, null);
    expect(msg).toContain('Settings → App Settings → Secrets & API Keys');
    expect(msg).toContain('`RAZORPAY_KEY_ID`');
    expect(msg).toContain('`RAZORPAY_KEY_SECRET`');
  });

  it('stays SHORT — one heading, one line per item, one closing line', () => {
    expect(appRequirementsNotice(razorpay, null).split('\n')).toHaveLength(3);
    const three = detectAppRequirements({
      files: { 'package.json': pkg({ razorpay: '^2.9.0', nodemailer: '^6.9.0', twilio: '^4.0.0' }) },
    });
    expect(appRequirementsNotice(three, null).split('\n')).toHaveLength(5);
  });

  it('is honest: the app works, only those buttons are frozen — never a fake success', () => {
    const msg = appRequirementsNotice(razorpay, null);
    // Matches what the generated UI really renders (missingCredentialGuard's "Coming soon" contract).
    expect(msg).toMatch(/Coming soon/i);
    expect(msg).toMatch(/built/i);
    expect(msg).toMatch(/rest of the app works/i);
  });

  it('speaks the user language, falling back to English for unknown scripts', () => {
    expect(appRequirementsNotice(razorpay, 'hi')).toContain('डालें');
    expect(appRequirementsNotice(razorpay, 'ta')).toContain('சேர்க்கவும்');
    expect(appRequirementsNotice(razorpay, 'zz')).toBe(appRequirementsNotice(razorpay, null));
    // every localized frame still carries the machine-exact key names + path
    for (const lang of ['hi', 'bn', 'pa', 'gu', 'or', 'ta', 'te', 'kn', 'ml', 'ar']) {
      const m = appRequirementsNotice(razorpay, lang);
      expect(m).toContain('`RAZORPAY_KEY_ID`');
      expect(m).toContain('Settings → App Settings → Secrets & API Keys');
    }
  });

  it('WHITE-LABEL: never names one of NavBharatAI\'s own AI vendors', () => {
    const all = detectAppRequirements({
      files: {
        'package.json': pkg({
          razorpay: '^2.9.0', stripe: '^14.0.0', nodemailer: '^6.9.0', resend: '^3.0.0', twilio: '^4.0.0',
          'mapbox-gl': '^3.0.0', cloudinary: '^2.0.0', '@clerk/clerk-react': '^5.0.0', mongodb: '^6.0.0',
        }),
      },
    });
    const msg = appRequirementsNotice(unconfiguredRequirements(all, {}), 'hi');
    for (const vendor of ['GLM', 'Z.ai', 'Kimi', 'Moonshot', 'Claude', 'Anthropic', 'Sonnet', 'Opus', 'Gemini', 'Vertex', 'Grok']) {
      expect(msg).not.toContain(vendor);
    }
  });

  it('kind:auto requirements are never rendered as a user task', () => {
    const db = detectAppRequirements({ files: { 'package.json': pkg({ '@prisma/client': '^5.0.0' }) } });
    expect(appRequirementsNotice(db, null)).toBe('');
  });
});
