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

  it('the App Lock toggles live in General Settings', () => {
    expect(settings).toContain('<AppLockSettings userId={user?.uid} />');
    const sectionAt = settings.indexOf('<AppLockSettings');
    const generalAt = settings.indexOf("settingsScreen === 'general'");
    expect(generalAt).toBeGreaterThan(-1);
    expect(sectionAt).toBeGreaterThan(generalAt);
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

  it('🔒 demands the PIN before it will save, and says so', () => {
    expect(lockSection).toContain('Enter your PIN to save this change.');
    expect(lockSection).toContain('disabled={!dirty || !hasTicket || !!busy || lockedOut}');
  });

  it('does NOT save on tap — the rest of this screen does, and here that would be wrong', () => {
    // A stray tap on a phone would lock somebody out of a screen they use, and each save costs a PIN
    // entry. So the ticks are a draft with an explicit Save and an Undo.
    expect(lockSection).toContain('Undo');
    expect(lockSection).toContain('const dirty =');
  });

  it('tells the user which lock is server-enforced and which is a screen lock', () => {
    // The honest line. Overstating this is the one thing that would make the feature dishonest rather
    // than merely limited.
    expect(lockSection).toContain('values stay encrypted until the PIN is');
    expect(lockSection).toContain('keeps the screen closed on this device');
  });

  it('points a user with no PIN at the one screen that can create one', () => {
    expect(lockSection).toContain('Secrets &amp; API Keys');
  });
});
