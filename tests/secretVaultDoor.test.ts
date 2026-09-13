import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE SECRETS SCREEN AFTER THE 2026-09-13 REPORT.
 *
 * The admin sent a screenshot of Settings → Secrets & API Keys on the app and said plainly: *"yeh to
 * kaam hi nahi kar raha hai"*. Three separate things were wrong, and only one of them was the error
 * message on screen:
 *
 *   1. the unlock itself threw `auth/argument-error` (covered by src/lib/vaultReauth.test.ts),
 *   2. the lock sat HALFWAY DOWN the panel — the add-key form was open above it — when the admin had
 *      asked for the lock to be the door: *"jab bhi 'secret and api key' par click kiye jaye, phone
 *      lock … se hi open hona chahiye! aur … ke andar koi lock nahi ho"*,
 *   3. a saved key could be copied and deleted but NOT edited: *"old ko edit/copy and delete kar sake"*.
 *
 * This file pins 2 and 3 structurally, because both are arrangements of the screen that a later edit
 * could quietly undo without any test noticing — the component still compiles and still renders either
 * way, which is exactly the kind of regression that reaches a user instead of CI.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const panel = read('src/components/SecretManager.tsx');

describe('the lock is the DOOR, not a card inside the room', () => {
  it('the add-key form renders INSIDE the gate, not above it', () => {
    const gateAt = panel.indexOf('<VaultLockGate');
    expect(gateAt, 'the gate is gone entirely').toBeGreaterThan(-1);

    // "Save Secret" is the add form's button. Before this change it appeared BEFORE the gate; the whole
    // point of the fix is that it now appears after it, i.e. inside the render prop.
    const addFormAt = panel.indexOf('Save Secret');
    expect(addFormAt, 'the add form is gone').toBeGreaterThan(-1);
    expect(addFormAt, 'the add form is outside the lock again').toBeGreaterThan(gateAt);
  });

  it('the saved-key rows are still inside the gate too', () => {
    expect(panel.indexOf('<SavedKeyRows')).toBeGreaterThan(panel.indexOf('<VaultLockGate'));
  });

  it('there is exactly ONE gate on this screen — two would mean two prompts', () => {
    expect(panel.split('<VaultLockGate').length - 1).toBe(1);
  });
});

describe('a saved key can be edited, copied and deleted', () => {
  it('the value box is NOT readOnly, so a rotated key can be typed straight in', () => {
    const at = panel.indexOf('aria-label={`Value of ${row.secret_name}`}');
    expect(at, 'the value input is gone').toBeGreaterThan(-1);
    // Look only at the input this label belongs to, not the whole file.
    const inputStart = panel.lastIndexOf('<input', at);
    expect(panel.slice(inputStart, at)).not.toContain('readOnly');
  });

  it('the NAME box stays readOnly — renaming is a different key, not an edit', () => {
    const at = panel.indexOf('aria-label={`Name of ${row.secret_name}`}');
    expect(at).toBeGreaterThan(-1);
    expect(panel.slice(panel.lastIndexOf('<input', at), at)).toContain('readOnly');
  });

  it('saving an edit carries the key\'s workspace scope', () => {
    // Without this the new value lands in the SHARED scope while the app-scoped row keeps the old one —
    // the build would read the stale key while this screen showed the new one.
    expect(panel).toContain('await saveSecret(userId, secretName, next, meta?.workspace_id ?? null)');
  });

  it('an empty value is refused rather than silently blanking a live key', () => {
    expect(panel).toMatch(/if \(!next\) \{ setError\(/);
  });

  it('the delete still asks twice', () => {
    expect(panel).toContain("setConfirming(row.id)");
    expect(panel).toContain('Keep');
  });
});

describe('the gate no longer carries its own copy of the re-auth', () => {
  const gate = read('src/components/VaultLockGate.tsx');

  it('calls the ONE shared implementation instead of a web-only popup', () => {
    expect(gate).toContain("from '../lib/vaultReauth'");
    // The duplicated popup call — once to unlock, once to enrol a device — is what made the fix
    // land in one place and not the other.
    expect(gate).not.toContain('reauthenticateWithPopup');
  });

  it('does not tell the user their phone has no lock', () => {
    // It does have one; the app's browser layer cannot reach it. Blaming the phone sends people into
    // their own settings looking for something already switched on.
    expect(gate).not.toMatch(/\{'?This device has no face/);
    expect(gate).toContain('browser layer cannot ask for it');
  });
});
