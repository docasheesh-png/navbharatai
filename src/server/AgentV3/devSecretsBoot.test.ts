import { describe, it, expect } from 'vitest';
import { ensureBootEnv, bootEnvNote, ENV_SCAN_COMMAND, type BootEnvIo } from './devSecretsBoot';

/**
 * ADMIN, 2026-08-22: "live (e2b) preview ek baar chal jata hai, fir browser band kar wapas chalao, to
 * preview nahi chalta chahe kuch kar lo."
 *
 * ROOT CAUSE. A live `.env` is deliberately never imported and never persisted durably — the user's
 * secrets stay theirs — so it exists ONLY inside the sandbox that wrote it. The BUILD path wrote one.
 * The WAKE path (`/api/agentv3/preview-diagnose`, what the "Wake up" button and the auto-restore both
 * call) wrote NO `.env` at all: not the vault keys, not the self-issued ones. A resumed or recycled
 * sandbox therefore ran `npm run dev` into an app with no SESSION_SECRET — express-session throws, or
 * every request 500s — and pressing Wake again repeated it identically. Forever.
 */
const io = (files: Record<string, string>, envReads: string) => {
  const written: Record<string, string> = {};
  const commands: string[] = [];
  const impl: BootEnvIo = {
    readFile: async (_w, p) => { if (files[p] === undefined) throw new Error('ENOENT'); return files[p]; },
    writeFile: async (_w, p, c) => { written[p] = c; files[p] = c; },
    runCommand: async (_w, c) => { commands.push(c); return { stdout: envReads }; },
  };
  return { impl, written, commands };
};

const APP_READS = 'process.env.SESSION_SECRET\nprocess.env.DATABASE_URL\nprocess.env.STRIPE_SECRET_KEY\n';

describe('ensureBootEnv', () => {
  it('THE CASE THAT STARTED THIS: a recycled sandbox with NO .env gets the key its app needs', async () => {
    const { impl, written } = io({}, APP_READS);
    const r = await ensureBootEnv(impl, 'ws');
    expect(r.conjured).toEqual(['SESSION_SECRET']);
    expect(written['.env']).toMatch(/SESSION_SECRET=.{32,}/);
    expect(r.wrote).toBe(true);
  });

  it('🔒 the user\'s saved key ALWAYS beats a generated one', async () => {
    const { impl, written } = io({}, APP_READS);
    const r = await ensureBootEnv(impl, 'ws', { SESSION_SECRET: 'theirs' });
    expect(r.conjured).toEqual([]);                 // nothing to generate — they have one
    expect(written['.env']).toContain('SESSION_SECRET=theirs');
  });

  it('🔒 NEVER invents a third-party credential, even though the app reads one', async () => {
    // A fake Stripe key makes the app fire real requests with garbage and fail confusingly. Absent
    // leaves that one feature cleanly inactive — an honest partial preview.
    const { impl, written } = io({}, APP_READS);
    await ensureBootEnv(impl, 'ws');
    expect(written['.env']).not.toContain('STRIPE_SECRET_KEY');
    expect(written['.env']).not.toContain('DATABASE_URL=');
  });

  it('keeps everything the existing .env already had', async () => {
    const { impl, written } = io({ '.env': 'DATABASE_URL=postgres://real\n' }, APP_READS);
    await ensureBootEnv(impl, 'ws');
    expect(written['.env']).toContain('DATABASE_URL=postgres://real');
    expect(written['.env']).toMatch(/SESSION_SECRET=/);
  });

  it('🔒 nothing to add ⇒ NO write at all', async () => {
    // Rewriting a file for no reason risks clobbering formatting in somebody's real .env.
    const { impl, written } = io({ '.env': 'SESSION_SECRET=x\n' }, 'process.env.SESSION_SECRET\n');
    const r = await ensureBootEnv(impl, 'ws');
    expect(r.wrote).toBe(false);
    expect(written['.env']).toBeUndefined();
  });

  it('hardens .gitignore only when it actually wrote real values', async () => {
    const { impl, written } = io({}, APP_READS);
    await ensureBootEnv(impl, 'ws');
    expect(written['.gitignore']).toContain('.env');
  });

  it('🔒 a failed scan never blocks the boot — the app starts exactly as it would have', async () => {
    const impl: BootEnvIo = {
      readFile: async () => { throw new Error('ENOENT'); },
      writeFile: async () => { throw new Error('read-only'); },
      runCommand: async () => { throw new Error('sandbox gone'); },
    };
    const r = await ensureBootEnv(impl, 'ws');
    expect(r).toEqual({ vault: [], conjured: [], wrote: false });
  });

  it('the scan skips node_modules and build output — it reads the app, not its dependencies', () => {
    expect(ENV_SCAN_COMMAND).toContain('--exclude-dir=node_modules');
    expect(ENV_SCAN_COMMAND).toContain('--exclude-dir=dist');
  });
});

describe('bootEnvNote — says out loud that a development key was minted', () => {
  it('names the generated key rather than hiding it', () => {
    // A user who later wonders why their sessions did not survive a restart deserves to know a
    // development key was minted for the sandbox, not to discover it.
    const n = bootEnvNote({ vault: [], conjured: ['SESSION_SECRET'], wrote: true });
    expect(n).toContain('SESSION_SECRET');
    expect(n).toContain('development key');
  });

  it('reports restored vault keys by COUNT, never by name or value', () => {
    const n = bootEnvNote({ vault: ['STRIPE_SECRET_KEY', 'SMTP_PASS'], conjured: [], wrote: true });
    expect(n).toContain('2 of your saved keys');
    expect(n).not.toContain('STRIPE');
  });

  it('nothing happened ⇒ nothing said', () => {
    expect(bootEnvNote({ vault: [], conjured: [], wrote: false })).toBe('');
  });
});
