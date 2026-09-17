import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_LOCK_AREAS, type AppLockArea } from '../src/lib/appLockAreas';
import { v3SurfaceDisplayClass } from '../src/components/agentv3/v3SurfaceMount';

/**
 * IS THE LOCK ACTUALLY IN FRONT OF THE SIX SCREENS? (admin 2026-09-13.)
 *
 * `appLockAreas.test.ts` proves the rules and `appLockRoutes.test.ts` proves the server enforces them.
 * Neither can see whether a SCREEN is plumbed in — and this feature has a specific way of rotting
 * silently: somebody refactors a panel, the gate goes with it, and every rule test still passes because
 * the server is untouched while the UI simply stops asking. A toggle the user ticked would then do
 * nothing, which is worse than not offering it.
 *
 * So every area the settings list offers is checked against the file that must honour it.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

/** Strip comments before asserting ABSENCE — a comment explaining a removal has defeated these before. */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
  .join('\n');

const app = read('src/App.tsx');
const settings = read('src/components/panels/SettingsPanel.tsx');
const billing = read('src/components/panels/BillingPanel.tsx');
const viewPanels = read('src/components/panels/ViewPanels.tsx');
const secrets = read('src/components/SecretManager.tsx');
const lockSection = read('src/components/settings/AppLockSettings.tsx');

/** Where each area is actually enforced, so a new area cannot be added without a home. */
const WIRED_IN: Record<AppLockArea, { file: string; src: string }> = {
  api_keys: { file: 'src/components/SecretManager.tsx', src: secrets },
  billing: { file: 'src/App.tsx', src: app },
  subscription: { file: 'src/components/panels/BillingPanel.tsx', src: billing },
  wallet_recharge: { file: 'src/components/panels/BillingPanel.tsx', src: billing },
  pro_builder: { file: 'src/App.tsx', src: app },
  code_studio: { file: 'src/components/panels/ViewPanels.tsx', src: viewPanels },
  settings: { file: 'src/components/panels/SettingsPanel.tsx', src: settings },
};

describe('🔴 every area the user can tick is actually enforced somewhere', () => {
  it('each one names its area in the file that guards it', () => {
    // The test that makes the toggle list honest: offering a switch with nothing behind it is the
    // "built but not really working" state the second absolute rule forbids.
    for (const spec of APP_LOCK_AREAS) {
      const wired = WIRED_IN[spec.id];
      expect(wired, `${spec.id} has no wiring site recorded`).toBeTruthy();
      expect(wired.src, `${spec.id} is offered in Settings but not enforced in ${wired.file}`)
        .toContain(`area="${spec.id}"`);
    }
  });

  it('the settings list and the enforcement map cover exactly the same areas', () => {
    // If a future area is added to the list, this fails until it is given a real home — rather than
    // shipping a tick that does nothing.
    expect(Object.keys(WIRED_IN).sort()).toEqual(APP_LOCK_AREAS.map((a) => a.id).sort());
  });
});

describe('the Pro builder is locked WITHOUT being unmounted', () => {
  it('🔒 hides the surface with the keep-alive class instead of dropping it from the tree', () => {
    // The surface is deliberately kept mounted across tab switches so a mid-stream build survives
    // (v3SurfaceMount records two rounds of root-causing). A gate that unmounted it would turn a lock
    // into data loss — the user's build, gone, because they locked a screen.
    expect(app).toContain('v3SurfaceDisplayClass(activeView, proLocked)');
    expect(app).toContain('<AppLockScreen userId={user.uid} area="pro_builder" />');
    // And the decision is read, not computed inline, so one hook answers for the whole app.
    expect(app).toContain("useAreaLocked(user?.uid ?? '', 'pro_builder')");
  });

  it('a locked surface takes the same `hidden` branch a backgrounded one takes', () => {
    expect(v3SurfaceDisplayClass('nbi_pro_chat')).toBe('contents');
    expect(v3SurfaceDisplayClass('nbi_pro_chat', true)).toBe('hidden');
    expect(v3SurfaceDisplayClass('settings')).toBe('hidden');
    // Not a third state: `hidden` is the branch already trusted to preserve a running build.
    expect(v3SurfaceDisplayClass('settings', true)).toBe('hidden');
  });

  it('does NOT wrap the surface in a gate, which would unmount it', () => {
    const proRegion = codeOnly(app).slice(app.indexOf('shouldRenderV3Surface('), app.indexOf('<AppLockScreen'));
    expect(proRegion).not.toContain('<AppLockGate');
  });
});

describe('Settings stays escapable while locked', () => {
  it('🔒 the gate wraps the CONTENT, so the ✕ Close button is still above it', () => {
    // Gating the whole panel would hide its sticky header, leaving a user who locked Settings looking at
    // a PIN card with no way out. A lock must never be a trap.
    const gateAt = settings.indexOf('area="settings"');
    const closeAt = settings.indexOf('aria-label="Close Settings"');
    expect(gateAt).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(-1);
    expect(closeAt, 'the close button moved inside the lock').toBeLessThan(gateAt);
  });

  it('General shows an App Lock BUTTON, and the list itself lives on its own screen', () => {
    // Admin 2026-09-17: "'app lock' button banao. jab user setting ja kar app lock option press kare to
    // yeh option dikhe." The tick boxes must not be drawn on General any more — an open list of what is
    // locked is information for whoever is holding the phone.
    const code = codeOnly(settings);
    expect(code).toContain("<AppLockRow userId={user?.uid} onOpen={() => setSettingsScreen('app_lock')} />");
    const rowAt = code.indexOf('<AppLockRow');
    const generalAt = code.indexOf("settingsScreen === 'general'");
    expect(generalAt).toBeGreaterThan(-1);
    expect(rowAt).toBeGreaterThan(generalAt);
    // The list renders ONLY on the app_lock screen.
    const screenAt = code.indexOf("settingsScreen === 'app_lock'");
    expect(screenAt).toBeGreaterThan(-1);
    expect(code.indexOf('<AppLockSettings')).toBeGreaterThan(screenAt);
    expect(code.split('<AppLockSettings').length - 1).toBe(1);
  });

  it('🔴 the App Lock screen is ALWAYS behind the PIN — "is app lock ko open karne ke liye bhi lock chahiye"', () => {
    const code = codeOnly(settings);
    const screen = code.slice(code.indexOf("settingsScreen === 'app_lock'"), code.indexOf("settingsScreen === 'secrets'"));
    // `always` gates whether or not "Settings" was ticked; `banner` shows the countdown and Lock now.
    expect(screen).toMatch(/<AppLockGate[\s\S]*?\balways\b[\s\S]*?render=\{\(\) => <AppLockSettings/);
    expect(screen).toContain('banner');
    // And the gate honours it: `always` short-circuits the per-area question.
    const gate = codeOnly(read('src/components/AppLockGate.tsx'));
    expect(gate).toContain('if (!always && !shouldGate(area, status))');
  });
});

describe('the money screens are gated where it is safe to gate them', () => {
  it('the whole Wallet & Billing view, the plans card and the recharge tab each have their own gate', () => {
    expect(app).toContain('area="billing"');
    expect(billing).toContain('area="subscription"');
    expect(billing).toContain('area="wallet_recharge"');
  });

  it('🔴 the recharge gate sits on the TAB BODY, not around the panel', () => {
    // The four balance cards above are this screen's tab bar. Gating them too would leave the user unable
    // to read their own balance or switch tabs.
    const rechargeAt = billing.indexOf('area="wallet_recharge"');
    const tabTestAt = billing.indexOf("activeBillingDetailTab === 'purchase'");
    expect(tabTestAt).toBeGreaterThan(-1);
    expect(rechargeAt).toBeGreaterThan(tabTestAt);
  });

  it('🔒 does NOT gate the checkout modal — a lock must not interrupt a payment already made', () => {
    // The modal completes a purchase and can be re-opened by a payment return. A PIN prompt there would
    // meet a user who has ALREADY PAID, instead of their confirmation. Reaching the pay button needs the
    // PIN; crediting money that was genuinely paid never does.
    const modals = codeOnly(read('src/components/panels/AppModals.tsx'));
    expect(modals).not.toContain('AppLockGate');
    expect(modals).not.toContain('AppLockScreen');
  });
});

describe('Code Studio', () => {
  it('is gated with the SIGNED-IN account, not the user\'s own Firebase connection', () => {
    // This file has both `user` and `firebaseUser`, and they are different things. Keyed to the wrong one
    // the gate would ask the server about a uid that is not the caller's, be refused, and render OPEN —
    // a gate that fails silently.
    expect(viewPanels).toContain('<AppLockGate userId={user?.uid ?? \'\'} area="code_studio"');
    expect(viewPanels).not.toContain('userId={firebaseUser?.uid');
  });
});

describe('the settings screen that turns it all on', () => {
  it('draws every area, with API keys ticked and disabled', () => {
    expect(lockSection).toContain('APP_LOCK_AREAS.map');
    expect(lockSection).toContain('disabled={spec.mandatory === true}');
    expect(lockSection).toContain('Always on');
  });

  it('🔒 has NO PIN field of its own — the gate in front of it is the PIN', () => {
    // Until 2026-09-17 this screen carried its own "Enter your PIN to save" box, because it sat open on
    // General. Now it renders only behind `AppLockGate always`, so a second PIN box would be a second
    // prompt for the same proof. The server still demands the ticket on every save.
    const code = codeOnly(lockSection);
    expect(code).not.toContain('unlockWithPin(');
    expect(code).not.toContain('Enter your PIN to save');
    // A lapsed ticket closes the screen (the gate asks again) instead of leaving a Save that keeps failing.
    expect(code).toContain('if (e?.needsUnlock) clearUnlock();');
  });

  it('offers Change PIN, with the CURRENT PIN typed again', () => {
    // "sath me change lock ka bhi option dikhe" (admin 2026-09-17). The current PIN is required because a
    // ticket alone proves only that it was entered in the last five minutes.
    expect(lockSection).toContain('changePin(userId, currentPin, newPin)');
    expect(lockSection).toContain('Change PIN');
    expect(lockSection).toContain('The two new PINs do not match.');
    const client = read('src/lib/appLock.ts');
    expect(client).toContain("jsonBody('POST', { currentPin, newPin }, unlock.ticket)");
  });

  it('does NOT save on tap — the rest of this screen does, and here that would be wrong', () => {
    // A stray tap on a phone would lock somebody out of a screen they use, and each save costs a PIN
    // entry. So the ticks are a draft with an explicit Save and an Undo.
    expect(lockSection).toContain('Undo');
    expect(lockSection).toContain('const dirty =');
  });

  it('tells the user which locks are server-enforced and which are screen locks', () => {
    // The honest line. Overstating this is the one thing that would make the feature dishonest rather
    // than merely limited — so it names BOTH server-enforced halves (the key values and the money
    // actions) and still says plainly that the rest is a screen lock.
    expect(lockSection).toContain('Two things are protected on our server');
    expect(lockSection).toContain('encrypted until the PIN is accepted');
    expect(lockSection).toContain('is refused without it');
    expect(lockSection).toContain('keeps the screen closed on this device');
    // And the one thing the PIN is never asked for.
    expect(lockSection).toContain('already paid is always credited');
  });

  it('a user with no PIN creates one HERE — no detour through Secrets & API Keys', () => {
    // The gate's setup form is the create-PIN form, and `always` shows it whenever there is no PIN.
    expect(codeOnly(lockSection)).not.toContain('Secrets &amp; API Keys');
    const gate = read('src/components/AppLockGate.tsx');
    expect(gate).toContain("setMode(s.hasPin ? 'unlock' : 'setup')");
  });

  it('the row on General says the state in one line and never draws a tick box', () => {
    const rowSrc = lockSection.slice(lockSection.indexOf('export const AppLockRow'), lockSection.indexOf('const PIN_BOX'));
    expect(rowSrc).toContain('appLockRowSubtitle(status, loadFailed)');
    expect(rowSrc).not.toContain('type="checkbox"');
    expect(rowSrc).toContain('onOpen()');
  });
});
