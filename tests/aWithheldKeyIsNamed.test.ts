// Q-155: least privilege gives an app only the user's shared keys and its own, and `withheldSecretNames`
// existed, tested, to name what it held back — but nothing ever called it, so a user whose key was
// (correctly) withheld had no sentence anywhere explaining why it was missing. The build report now names it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { secretsWithheldNote } from '../src/server/lib/secrets';
import { withheldSecretNames } from '../src/server/lib/secretScope';

describe('the withheld keys are named in the build report', () => {
  it('names, never values, and the way to fix it', () => {
    const note = secretsWithheldNote(['RAZORPAY_KEY_SECRET', 'SUPABASE_URL']);
    expect(note).toMatch(/^2 saved key\(s\) were NOT given to this app/);
    expect(note).toContain('RAZORPAY_KEY_SECRET, SUPABASE_URL');
    expect(note).toContain('applies to all my apps');
  });

  it('a long list is cut, and says how many more', () => {
    expect(secretsWithheldNote(Array.from({ length: 15 }, (_, i) => `K${i}`))).toContain('and 3 more');
  });

  it('the pure rule it uses: another app\'s key is withheld, a shared key is not', () => {
    const rows = [
      { name: 'SHARED', value: 'x', workspaceId: null },
      { name: 'MINE', value: 'x', workspaceId: 'ws1' },
      { name: 'OTHER', value: 'x', workspaceId: 'ws2' },
    ] as never;
    expect(withheldSecretNames(rows, 'ws1')).toEqual(['OTHER']);
  });

  it('🔒 the build records it right after the app\'s keys are set, and the vault read is the pure rule (one read)', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const set = route.indexOf('dispatcher.setUserSecrets(appEnv);');
    const rec = route.indexOf("code: 'SECRETS_WITHHELD', message: secretsWithheldNote(withheld)", set);
    expect(set).toBeGreaterThan(-1);
    expect(rec).toBeGreaterThan(set);
    expect(rec - set).toBeLessThan(800);
    const lib = readFileSync(join(__dirname, '../src/server/lib/secrets.ts'), 'utf8');
    expect(lib).toContain('return withheldSecretNames(await loadUserVaultRows(userId), workspaceId);');
  });
});
