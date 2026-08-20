/**
 * SETTINGS, REGROUPED — and the two controls that were only pretending to be settings.
 *
 * ADMIN REQUEST 2026-08-14: give "General" its own group, with View Mode inside it. Two things were
 * wrong with where they sat, and they are worth naming because the fix is not cosmetic:
 *
 *   • VIEW MODE floated as a loose card belonging to no group — which is exactly why it was hard to
 *     find. It is a preference about how NavBharatAI looks, so it belongs beside Theme and Text Size.
 *   • GENERAL was a tile inside "App Settings", putting two unrelated things in one box: App Settings
 *     is about the app the USER BUILT (its domain, database, hosting), while theme, view mode, text
 *     size and chat language are about how NAVBHARATAI ITSELF behaves.
 *
 * Two controls were REMOVED rather than moved, after checking that nothing read them:
 *   • "Developer Mode" — a toggle with no onClick, no state, and a hardcoded ON appearance. It
 *     advertised "advanced debug tools" and did nothing whatsoever.
 *   • the app "Description" box — uncontrolled (`defaultValue`, no onChange, no save), read by
 *     nothing. A user could type into it and every word was discarded on navigation.
 * Both are the shape rule 2 forbids: a control that looks configured and is not.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const panel = readFileSync(join(__dirname, '..', 'src/components/panels/SettingsPanel.tsx'), 'utf8');
const kb = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');

/** Comments describe what was removed on purpose; only real code counts. */
const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the new General Settings group', () => {
  it('exists as its own group, with the General screen inside it', () => {
    expect(code).toContain("title: 'General Settings'");
    const at = code.indexOf("title: 'General Settings'");
    expect(code.slice(at, at + 600)).toContain("{ id: 'general'");
  });

  it('🔒 sits ABOVE App Settings — it is reached far more often', () => {
    expect(code.indexOf("title: 'General Settings'")).toBeLessThan(code.indexOf("title: 'App Settings'"));
  });

  it('🔒 App Settings no longer carries a General tile — one doorway, not two', () => {
    const at = code.indexOf("title: 'App Settings'");
    const appSettings = code.slice(at, code.indexOf("title: 'Legal & Trust'", at));
    expect(appSettings).not.toContain("{ id: 'general'");
    // …and everything that genuinely IS an app setting stayed.
    // 'cloudeploy' left this list on 2026-08-20 — the tile was removed (duplicate publish surface).
    for (const id of ['domain', 'database', 'auth', 'storage', 'secrets', 'logs']) {
      expect(appSettings, id).toContain(`id: '${id}'`);
    }
  });

  it('🔒 the screen id is STILL "general" — it is a destination, not just a tile', () => {
    // Other surfaces and the knowledge base navigate here by name. Renaming the id would open a
    // blank page from every one of them; the doorway moved, the room did not.
    expect(code).toContain("settingsScreen === 'general'");
  });
});

describe('View Mode moved inside', () => {
  it('🔒 is no longer a loose card on the Settings home', () => {
    // It used to render BEFORE the group list, belonging to nothing.
    const viewModeAt = code.indexOf('View Mode');
    const groupsAt = code.indexOf("title: 'Account'");
    expect(viewModeAt).toBeGreaterThan(groupsAt);
  });

  it('renders inside the General screen, with all four modes still working', () => {
    const at = code.indexOf("settingsScreen === 'general'");
    const screen = code.slice(at, at + 6000);
    expect(screen).toContain('View Mode');
    for (const mode of ['auto', 'mobile', 'tablet', 'desktop']) {
      expect(screen, mode).toContain(`id: '${mode}'`);
    }
    // The control must still DO something — this is the setter it always used.
    expect(screen).toContain('setDeviceMode');
  });
});

describe('🔒 the two controls that did nothing are GONE', () => {
  it('the fake Developer Mode toggle is removed', () => {
    // It had no onClick and was drawn permanently ON. A control that cannot be switched is not a
    // setting, and one that looks switched-on is worse than absent.
    expect(code).not.toContain('Developer Mode');
    expect(code).not.toContain('Advanced debug tools');
  });

  it('the dead Description box is removed', () => {
    expect(code).not.toContain('settings-app-desc');
    expect(code).not.toContain('The ultimate specialized AI developer workspace for Bharat.');
  });

  it('🔒 the REAL controls beside them survived — this was a deletion, not a clear-out', () => {
    const at = code.indexOf("settingsScreen === 'general'");
    const screen = code.slice(at, at + 8000);
    expect(screen).toContain('AppSignatureToggle');   // real: a wired component
    expect(screen).toContain('MotionModeControl');
    expect(screen).toContain('FontScaleControl');
    expect(screen).toContain('setPreferredLanguage'); // chat language
    expect(screen).toContain('setTheme');
  });
});

describe('🔒 the knowledge base was updated with the move', () => {
  it('no path still sends a user to App Settings → General', () => {
    expect(kb).not.toContain('App Settings → General');
  });

  it('the new path is stated', () => {
    expect(kb).toContain('Settings → General Settings → General');
  });

  it('🔒 the KB no longer advertises either removed control', () => {
    // An AI that still offers "developer mode toggle" would be describing a control the user cannot
    // find — the same wrong-answer failure the Other-AI regroup guard exists to prevent.
    expect(kb).not.toContain('developer mode toggle');
  });

  it('🔒 it no longer says View Mode lives on the Settings home screen', () => {
    expect(kb).not.toContain('View Mode — Auto/Mobile/Tablet/Desktop — lives on the Settings home screen');
    expect(kb).not.toContain('use View Mode on the Settings home screen');
  });
});
