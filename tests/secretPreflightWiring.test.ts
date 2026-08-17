import { narrationText } from '../src/server/AgentV3/narrationCatalogue';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { braceBlock } from './helpers/sourceSlice';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';

/**
 * THE VERIFICATION HAS TO RUN WHERE THE KEYS ARE ACTUALLY USED (admin finding 3, 2026-08-06).
 *
 * `secretPreflight` is unit-tested on its own. What can silently regress is the WIRING: a preflight that
 * exists but is never called, or is called somewhere that runs after the build has already leaned on the
 * credential, is exactly as useless as not having it — and would still leave the old "🔐 Loaded 3 of
 * your saved keys" line as the only thing the user ever sees.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');

describe('The preflight runs at the moment the keys reach the app', () => {
  const fn = braceBlock(dispatcher, 'async ensureUserSecretsEnvFile(');

  it('is called from the one place that writes the vault into the app\'s .env', () => {
    expect(fn).toContain('verifyInjectedSecrets(this.userSecretsEnv)');
    // It moved inside a Promise.all when the credential probe was added (2026-08-17), so the `await`
    // now sits on the batch. Pin that it is still awaited SOMEWHERE — a fire-and-forget preflight
    // would report on a build that had already finished leaning on the credential.
    expect(fn).toContain('await Promise.all([');
  });

  it('the probe runs ALONGSIDE the preflight, never queued behind it', () => {
    // Both have their own deadline. In sequence they would add up on every build that saves a
    // credential, and neither needs the other's answer — so the concurrency is a real property to
    // protect, not an incidental shape.
    const batch = fn.slice(fn.indexOf('await Promise.all(['), fn.indexOf(']);', fn.indexOf('await Promise.all([')));
    expect(batch).toContain('verifyInjectedSecrets');
    expect(batch).toContain('probeCredentials');
  });

  it('the keys are WRITTEN first — verification never gates the user\'s own choice', () => {
    // Withholding a key the user deliberately saved would be a second, quieter version of the same bug.
    // The build gets the key either way; the preflight only decides what the user is TOLD.
    expect(fn.indexOf("writeFile(this.workspaceId, '.env', merged)")).toBeLessThan(fn.indexOf('verifyInjectedSecrets'));
  });

  it('a preflight that throws degrades to the old honest line instead of losing the narration', () => {
    // Two layers, and both matter: the per-promise `.catch` keeps ONE failing check from destroying the
    // other's result, and the outer catch is the backstop if the batch itself throws. Either way
    // `verdicts` ends up empty and the old honest line is what the user sees.
    expect(fn).toContain('.catch(() => [] as SecretVerdict[])');
    expect(fn).toContain('catch { verdicts = []; probed = []; }');
    expect(fn).toContain('if (verdicts.length === 0) {');
    // The sentence moved into the narration catalogue (ROADMAP item 6) so it can be spoken in the
    // user's own language. The degradation still narrates the SAME fact, with the same count.
    expect(fn).toContain("this.narrate('secrets.loaded', { count: names.length })");
    expect(narrationText('secrets.loaded', { count: 3 })).toContain('Loaded 3 of your saved key');
  });

  it('every problem it finds is actually emitted, not just computed', () => {
    expect(fn).toContain('const { loaded, problems } = preflightNarration(verdicts)');
    expect(fn).toContain('for (const p of problems)');
  });

  it('the whole thing still cannot break a build', () => {
    // The enclosing try/catch is what makes an injected-key failure a degradation rather than a stop.
    expect(fn).toContain('/* best-effort — never block the build; the app just runs without injected keys */');
  });
});

describe('KB — a user can ask about this and get the truth', () => {
  const entry = APP_KNOWLEDGE_BASE.find((f) => f.id === 'settings_secrets')!;

  it('says the saved database details are TESTED, not merely copied', () => {
    expect(entry.description).toContain('TESTED, NOT JUST COPIED');
  });

  it('does not over-promise — an untestable key is described as untested', () => {
    expect(entry.description).toContain('loaded-but-untested');
    expect(entry.description).toContain('never claims a key works when it has not checked');
  });

  it('carries the words a user would actually type when a key is not working', () => {
    for (const k of ['key not working', 'credentials galat', 'wrong credentials']) {
      expect(entry.keywords).toContain(k);
    }
  });
});
