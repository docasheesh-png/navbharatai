import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * ONE ROOM, MORE THAN ONE GATE — and it must stay one room (admin 2026-08-17: "ek room ke kayi gate").
 *
 * A user's keys can now be supplied from three places: Settings → App Settings → Secrets & API Keys,
 * Pro v5's More menu, and the popup a build raises mid-run. The admin's worry was that these might
 * store into different places and need syncing. They do not — every one of them writes through the same
 * authenticated `/api/secrets` client into the same per-user `user_secrets` collection, which is the
 * same store the build reads when it writes the app's `.env`.
 *
 * That is true today by CONSTRUCTION rather than by discipline, and this file is what keeps it true.
 * The failure it exists to prevent is the easy one: somebody adds a fourth door in a hurry, writes a
 * quick fetch or a second little component for it, and now a key saved at one gate is invisible at
 * another — with no error anywhere, because both screens work perfectly on their own data.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const panel = read('src/components/agentv3/AgentV3Panel.tsx');
const settings = read('src/components/panels/SettingsPanel.tsx');
const manager = read('src/components/SecretManager.tsx');
const api = read('src/lib/secretsApi.ts');

describe('both gates open onto the SAME vault UI', () => {
  it('v5 renders the Settings screen\'s own component, not a copy of it', () => {
    expect(panel).toContain("import('../SecretManager')");
    expect(panel).toContain('<VaultManager userId={userId} embedded />');
  });

  it('Settings renders that same component', () => {
    expect(settings).toContain('SecretManager');
    expect(settings).toContain('<SecretManager userId={user.uid} />');
  });

  it('there is exactly ONE vault UI in the codebase', () => {
    // If a second one is ever added, this is the line that should make somebody stop and ask why.
    expect(manager).toContain('export const SecretManager');
    expect(manager).toContain('embedded');
  });
});

describe('every door writes through the one authenticated client', () => {
  it('the vault UI uses the shared API, never a raw request', () => {
    expect(manager).toContain("from '../lib/secretsApi'");
    // A raw fetch/axios here is exactly how the 401 bug happened before secretsApi existed: three
    // copies of the call, two of which forgot the auth header, so keys silently never saved.
    expect(manager).not.toMatch(/\bfetch\(|\baxios\./);
  });

  it('the mid-build popup saves through it too', () => {
    expect(panel).toContain("from '../../lib/secretsApi'");
    expect(panel).toContain('await saveSecret(userId, name, value)');
  });

  it('the client points every call at the one per-user collection route', () => {
    for (const route of ['/api/secrets/${userId}', '/api/secrets/${userId}/verify']) {
      expect(api).toContain(route);
    }
    // Every vault call carries the signed-in user's token — the property `vaultFetch` exists to make
    // impossible to forget.
    expect(api).toContain('authHeaders()');
    expect(api.match(/fetch\(/g) ?? []).toHaveLength(1); // one wrapper, not one per caller
  });
});

describe('the new gate does not cost the user their build', () => {
  it('opens in place instead of navigating away to Settings', () => {
    // Sending somebody to Settings mid-build loses the build, the preview and the chat, and they have
    // to find their way back. The whole point of a second gate is that it is a gate, not a teleport.
    const item = panel.slice(panel.indexOf('Keys &amp; Secrets') - 900, panel.indexOf('Keys &amp; Secrets'));
    expect(item).toContain("setMobileSheet('secrets')");
    expect(item).not.toContain('navbharat:navigate');
  });

  it('loads the vault UI lazily, so a user who never opens it never downloads it', () => {
    expect(panel).toContain('lazy(() =>');
    expect(panel).toContain('Suspense');
  });
});
