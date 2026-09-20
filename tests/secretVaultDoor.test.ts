import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE SECRETS SCREEN AFTER THE 2026-09-13 REDESIGN.
 *
 * The admin asked for three things in one message, and all three are ARRANGEMENTS of the screen — the
 * kind a later edit can quietly undo while the component still compiles and still renders, which is
 * exactly the regression that reaches a user instead of CI:
 *
 *   1. *"bas PIN banao, mobile number/email otp se PIN banao, PIN (4 digit pin se hi open ho) … waaki
 *      sab hata do … phone unlock etc sab hata do"* — one door, a PIN, and nothing else.
 *   2. *"cloud run ke jaise ui … 2-2 colom … sath me ek 🗑️ … sabse last me ek button ho, "+ add new
 *      credentials" aur sabse last me — "save and sync" button."* — including the ORDER of those two.
 *   3. The app picker's POSITION. First asked for at the top (*"sabse upar kis app ke credentials
 *      hai"*), then moved the same day to the bottom (*"sabse niche dropdown selector box me user apni
 *      app select kare, jo app select ho, usi app ke credential upar dikhe"*) — list first, filter under
 *      it. Pinned as an order either way.
 *
 * The lock's own rules are proven in `vaultPin.test.ts` and `vaultPinRoutes.test.ts`. This file pins the
 * screen.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

/**
 * Strip comments before asserting that something is ABSENT.
 *
 * 🔴 Learned the hard way, twice in this repo: a "this must no longer appear" assertion is defeated by
 * the very comment that explains WHY it was removed. The gate's own doc block names WebAuthn in order to
 * record why the device lock is gone, and an assertion over the raw file then fails on the explanation
 * rather than on a regression. So absence is checked against CODE, and prose is left free to explain.
 */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
  .join('\n');

const panel = read('src/components/SecretManager.tsx');
const gate = read('src/components/AppLockGate.tsx');
const gateCode = codeOnly(gate);
const panelCode = codeOnly(panel);

describe('the lock is the DOOR, not a card inside the room', () => {
  it('every control renders INSIDE the gate, not above it', () => {
    const gateAt = panel.indexOf('<AppLockGate');
    expect(gateAt, 'the gate is gone entirely').toBeGreaterThan(-1);
    // The two bottom buttons and the credential table are the whole of the room. If any of them appears
    // before the gate, the screen is half-locked again — which is what the admin photographed.
    for (const inside of ['<CredentialTable', 'Add new credentials', 'Save and sync']) {
      expect(panel.indexOf(inside), `${inside} is outside the lock`).toBeGreaterThan(gateAt);
    }
  });

  it('there is exactly ONE gate on this screen — two would mean two prompts', () => {
    expect(panel.split('<AppLockGate').length - 1).toBe(1);
  });
});

describe('the Cloud Run layout: two columns, a bin, then the two buttons', () => {
  it('column one is the name and column two is the value, both as real inputs', () => {
    // Real inputs rather than styled text, because that is where long-press-to-copy and ⌘C already work.
    expect(panel).toContain('aria-label={`Name of ${row.secret_name}`}');
    expect(panel).toContain('aria-label={`Value of ${row.secret_name}`}');
    expect(panel).toContain('Secret / API key');
  });

  it('the value box is NOT readOnly, so a rotated key can be typed straight in', () => {
    const at = panel.indexOf('aria-label={`Value of ${row.secret_name}`}');
    const inputStart = panel.lastIndexOf('<input', at);
    expect(panel.slice(inputStart, at)).not.toContain('readOnly');
  });

  it('the NAME box of a SAVED row stays readOnly — renaming is a different key, not an edit', () => {
    const at = panel.indexOf('aria-label={`Name of ${row.secret_name}`}');
    expect(panel.slice(panel.lastIndexOf('<input', at), at)).toContain('readOnly');
  });

  it('a NEW row can be named, because that is the one moment naming a key is meaningful', () => {
    const at = panel.indexOf('aria-label="New credential name"');
    expect(at).toBeGreaterThan(-1);
    expect(panel.slice(panel.lastIndexOf('<input', at), at)).not.toContain('readOnly');
  });

  it('the bin removes the WHOLE row, and a saved one asks twice', () => {
    expect(panel).toContain('aria-label={`Delete ${row.secret_name}`}');
    expect(panel).toContain('setConfirming(row.id)');
    expect(panel).toContain('Keep');
    // An unsaved row has nothing in the vault to destroy, so its bin acts at once.
    expect(panel).toContain('aria-label="Remove this new row"');
  });

  /**
   * ⬇️ MOVED 2026-09-13, same admin, same day, and the reversal is deliberate rather than a regression.
   *
   * The original ask was *"sabse upar kis app ke credentials hai, woh select karne ka option bhi ho!"*
   * and this test pinned the picker ABOVE the rows. The admin then looked at the built screen and said
   * *"sabse niche dropdown selector box me user apni app select kare, jo app select ho, usi app ke
   * credential upar dikhe!!"* — list first, filter under it.
   *
   * Kept as an ORDER assertion rather than deleted: the position is the instruction either way, and a
   * test that only checked the picker still exists would not have caught the first arrangement breaking.
   */
  it('⬇️ the app picker is BELOW the credential rows it filters', () => {
    const pickerAt = panel.indexOf("id=\"secret-scope\"");
    const tableAt = panel.indexOf('<CredentialTable');
    expect(pickerAt, 'the app picker is gone').toBeGreaterThan(-1);
    expect(tableAt, 'the credential table is gone').toBeGreaterThan(-1);
    expect(pickerAt, 'the picker climbed back above the rows').toBeGreaterThan(tableAt);
  });

  it('"+ Add new credentials" comes LAST but one, and "Save and sync" comes LAST', () => {
    // Anchored on each button's own handler rather than on its label: the label text also appears in a
    // row's "press Save and sync" hint higher up the file, which would make a correct order read as wrong.
    const addAt = panelCode.indexOf('setNewRows((list) => [...list,');
    const saveAt = panelCode.indexOf('void saveAndSync()');
    expect(addAt, 'the add button is gone').toBeGreaterThan(-1);
    expect(saveAt, 'the save button is gone').toBeGreaterThan(-1);
    expect(saveAt, 'Save and sync is no longer the last button').toBeGreaterThan(addAt);
    expect(panel).toContain('Add new credentials');
    expect(panel).toContain('Save and sync');
  });
});

describe('"Save and sync" does something real', () => {
  it('writes through the authenticated vault save, scope and all', () => {
    // 🔒 An edit must carry the key's own workspace scope. Without it the new value lands in the SHARED
    // scope while the app-scoped row keeps the old one — the build reads the stale key while this screen
    // shows the new one.
    expect(panel).toContain('await saveSecret(userId, row.secret_name, next, meta?.workspace_id ?? null)');
    // A NEW key uses the scope the parent derived from the picker.
    expect(panel).toContain('await saveSecret(userId, name, value, saveScopeId)');
  });

  it('RE-READS the vault afterwards, so "synced" is confirmed rather than assumed', () => {
    const saveFn = panel.slice(panel.indexOf('const saveAndSync'), panel.indexOf('const remove ='));
    expect(saveFn).toContain('await load(true)');
  });

  it('never writes an empty value, and says so instead of silently blanking a live key', () => {
    expect(panel).toContain('empty value — use the bin to remove it');
  });

  it('reports what it saved and what it skipped — a button that claims more than it did is the bug', () => {
    expect(panel).toContain('Saved and synced ');
    expect(panel).toContain('Not saved: ');
    expect(panel).toContain('Nothing to save');
  });
});

describe('🔴 the door is a PIN, and NOTHING else survives in it', () => {
  it('collects a 4-digit PIN and sends it to the server to be checked', () => {
    expect(gate).toContain("from '../lib/appLock'");
    expect(gate).toContain('unlockWithPin(userId, pin)');
    expect(gate).toContain('maxLength={4}');
  });

  it("the keys screen uses the ONE area the user cannot switch off", () => {
    // "api keys and secret (non removal ✅)" — enforced server-side too, see appLockAreas.ts.
    expect(panel).toContain('area="api_keys"');
  });

  it('never compares the PIN itself — the only client-side check is the shape of the field', () => {
    // A browser that knows whether a digit was right has already given an attacker the whole PIN.
    expect(gateCode).not.toMatch(/pin\s*===\s*['"]/);
    expect(gateCode).not.toContain('storedPin');
    expect(gate).toContain('looksLikePin');
  });

  it('the phone lock, the device lock and the account-password door are all GONE', () => {
    for (const removed of [
      'WebAuthn', 'navigator.credentials', 'deviceLockAvailable', 'registerDeviceLock', 'unlockWithDevice',
      'reauthenticateWithPopup', 'reauthenticateNow', 'vaultReauth', 'Fingerprint', 'Face ID',
      'account password', 'device-lock',
    ]) {
      expect(gateCode, `${removed} is still in the gate`).not.toContain(removed);
    }
  });

  it('offers "Forgot PIN" and resets it through an emailed code', () => {
    expect(gate).toContain('Forgot PIN?');
    expect(gate).toContain("sendPinCode(userId, status?.hasPin ? 'reset' : 'create')");
    expect(gate).toContain('setPin(userId, newPin, code.trim())');
  });

  it('asks for the new PIN twice, because a typo here locks the owner out of their own keys', () => {
    expect(gate).toContain('Confirm your PIN');
    expect(gate).toContain('newPin !== confirmPin');
  });

  it('states the lock-out plainly and still offers the way out', () => {
    expect(gate).toContain('Too many wrong PINs');
    expect(gate).toContain('Reset my PIN');
  });

  it('an account with no email is told the door that works for it, not left at a dead end', () => {
    expect(gate).toContain("status?.channel === 'fresh-sign-in'");
    expect(gate).toMatch(/Sign in again/);
  });
});

describe('the client half leaks nothing and decides nothing', () => {
  const client = read('src/lib/appLock.ts');
  const secretsClient = read('src/lib/vaultLock.ts');

  it('the PIN only ever travels in a request body — it is never stored in the browser', () => {
    for (const stored of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB']) {
      expect(client, stored).not.toContain(stored);
      expect(secretsClient, stored).not.toContain(stored);
    }
  });

  it('every privileged call carries the ticket header', () => {
    // Reveal and delete go through ONE helper now, so the header is attached in one place rather than
    // copied per call — which is what stops a third such call being added without it.
    expect(secretsClient).toContain('[UNLOCK_TICKET_HEADER]: ticket');
    expect(secretsClient).toContain('revealSecrets');
    expect(secretsClient).toContain('deleteSecretLocked');
  });

  it('changing WHAT is locked carries the ticket too', () => {
    // A lock that can be switched off without the PIN is a preference. The server enforces this as well
    // (tests/appLockRoutes.test.ts); this pins that the client does not even try without one.
    //
    // ⚠️ This used to read `currentUnlock();`. The rule did not move — it got STRICTER on 2026-09-20:
    // the ticket must belong to the account being saved for, not merely be live (see THE ACCOUNT
    // BOUNDARY in appLock.ts, and tests/oneAccountsUnlockIsNotAnothers.test.ts). Repointed rather than
    // deleted, because the requirement it guards is the same one.
    expect(client).toContain('const unlock = currentUnlock(userId);');
    expect(client).toContain("jsonBody('PUT', { areas }, unlock.ticket)");
  });
});
