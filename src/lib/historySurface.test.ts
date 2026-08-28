// The rule that decides whether History opens OVER the chat or replaces it.
//
// The admin asked for the Free chat's History to behave like Pro v5.0's — a panel over the
// conversation you are already in, not a separate screen you have to navigate back from. The risk
// worth pinning is not that the popup fails to open; it is that it opens somewhere it should not and
// silently changes a screen nobody asked about.

import { describe, it, expect } from 'vitest';
import { historySurfaceFor, historyFilterFor, HISTORY_POPUP_SURFACES } from './historySurface';

describe('historySurfaceFor — where the History button takes you', () => {
  it('opens the popup on the Free chat, which is what was asked for', () => {
    expect(historySurfaceFor('nbi_chat')).toBe('popup');
  });

  it('leaves the Professionals hub on its own history view', () => {
    // The hub renders ProfessionalHistoryView — a different component with different rows. Giving it
    // the popup would quietly replace one screen's content with another's.
    expect(historySurfaceFor('professionals')).toBe('tab');
  });

  it('does NOT take over Pro v5.0, which already has its own in-panel history', () => {
    // v5 is the thing being copied. Routing it through here too would give that one surface two
    // different history popups.
    expect(historySurfaceFor('nbi_pro_chat')).toBe('tab');
  });

  it('leaves every other surface exactly as it was', () => {
    for (const view of ['home', 'settings', 'sda_chat', 'teacher_ai', 'appstore', 'deploy', 'report', 'history']) {
      expect(historySurfaceFor(view), view).toBe('tab');
    }
  });

  it('falls back to the tab when there is no active view', () => {
    // Unknown state must never mean "show an overlay the user cannot explain".
    expect(historySurfaceFor('')).toBe('tab');
    expect(historySurfaceFor(undefined as unknown as string)).toBe('tab');
  });

  it('the popup list is deliberately short — adding to it changes another screen', () => {
    expect([...HISTORY_POPUP_SURFACES]).toEqual(['nbi_chat']);
  });
});

describe('historyFilterFor — which rows the list shows', () => {
  it('scopes the Professionals hub to professional history', () => {
    expect(historyFilterFor('professionals')).toBe('professional');
  });

  it('gives every other surface the merged Free list', () => {
    // Free + Doctor AI + every professional, each row tagged with its mode (shipped 2026-08-25).
    for (const view of ['nbi_chat', 'home', 'sda_chat', 'settings']) {
      expect(historyFilterFor(view), view).toBe('free');
    }
  });
});
