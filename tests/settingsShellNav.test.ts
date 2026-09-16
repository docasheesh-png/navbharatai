import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { APP_KNOWLEDGE_BASE } from '../src/server/AppContext/AppKnowledgeBase';
import type { SettingsScreen } from '../src/types';

/**
 * App Settings developer surfaces — Terminal (REMOVED), Logs and Git.
 *
 * Settings → Terminal was removed on 2026-08-11 (admin: "ide ke andar already hai"). It mounted the
 * very same TerminalPanel on the very same workspace as Code Studio, so it was a second doorway to
 * one room. What these tests now guard is the thing that actually matters after a removal: the AI can
 * still take a user to a REAL terminal. The dangerous outcome was not the deleted screen — it was
 * `settings_terminal` staying in the knowledge base as a path to a screen that no longer exists, or
 * the navigation target disappearing so "terminal kahan hai" led nowhere at all.
 *
 * Logs and Git are untouched and still locked below: the 2026-07-29 "hatana mat" instruction still
 * holds for Logs, which has no IDE twin.
 */

const kb = (id: string) => APP_KNOWLEDGE_BASE.find((f) => f.id === id);

/**
 * The KB entry's own `nav` field IS the navigation target. It used to be read through the Offline
 * AI's `navFor` helper, which went with that feature on 2026-09-14; the curated fallback map it also
 * consulted was moved INTO the knowledge base, which is where that file's own comment said such
 * targets belong ("A feature's OWN `nav` field always WINS"). So these guarantees are unchanged and
 * now read from the single source of truth.
 */
const navFor = (f: { nav?: { view?: string; settingsScreen?: string } }) => f.nav ?? null;

describe('Settings Terminal — KB entry + in-app navigation', () => {
  it('🔒 the removed Settings terminal is gone from the knowledge base too', () => {
    // A KB entry outliving its screen is worse than the screen itself: every AI in the app would keep
    // sending users to "Settings → App Settings → Terminal", which no longer exists.
    expect(kb('settings_terminal')).toBeUndefined();
    const kbSource = APP_KNOWLEDGE_BASE.map((f) => JSON.stringify(f)).join('\n');
    expect(kbSource).not.toContain('settings_terminal');            // no dangling relatedFeatures ref
    expect(kbSource).not.toContain('Settings → App Settings → Terminal');
  });

  it('🔒 the IDE terminal still exists, and is still describable as a real shell', () => {
    const entry = kb('ide_terminal');
    expect(entry).toBeTruthy();
    expect(entry!.description).toMatch(/REAL, persistent shell/i);
    expect(entry!.description).toMatch(/cd into a folder and the next command runs there/i);
    expect(entry!.description).toMatch(/Ctrl\+C/i);
    // Its path must no longer advertise the removed Settings route.
    expect(entry!.path).not.toMatch(/Settings/);
    expect(entry!.path).toMatch(/IDE/);
  });

  it('🔒 asking for the terminal still navigates somewhere real', () => {
    // The removal's real risk: deleting the only navigation target so the question leads nowhere.
    const nav = navFor(kb('ide_terminal')!);
    expect(nav).toEqual({ view: 'studio' });
  });

  it('settings_logs KB entry exists and describes the REAL logs surface', () => {
    const entry = kb('settings_logs');
    expect(entry).toBeTruthy();
    // The entry must describe reality: real build events + captured runtime errors, honest empties.
    expect(entry!.description).toMatch(/REAL live logs/i);
    expect(entry!.description).toMatch(/BUILD LOG/);
    expect(entry!.description).toMatch(/RUNTIME ERRORS/);
    expect(entry!.description).toMatch(/nothing is simulated/i);
    expect(entry!.path).toContain('Settings → App Settings → Logs');
  });

  it('settings_logs navigates to the logs settings screen (a working button)', () => {
    const entry = kb('settings_logs');
    const nav = navFor(entry!);
    expect(nav).toEqual({ view: 'settings', settingsScreen: 'logs' });
    const screen: SettingsScreen = 'logs';
    expect(nav!.settingsScreen).toBe(screen);
  });

  it('🔒 Git is in App Settings AND the tile really exists (it did not, for two weeks)', () => {
    // The 2026-08-01 move took Git OFF the sidebar and into a Settings screen -- but that screen
    // (`modules`) was never made reachable: nothing in the app ever set settingsScreen to it. So the
    // whole DevOps surface had no doorway at all while this KB entry confidently gave directions to
    // it. Asserting the PATH alone is what let that survive, so the tile is asserted too.
    const entry = kb('settings_git');
    expect(entry).toBeTruthy();
    expect(entry!.path).not.toContain('Sidebar → Git');
    expect(entry!.path).toContain('App Settings');
    expect(entry!.path).toMatch(/Git & Deployment/i);

    const panel = readFileSync(join(__dirname, '../src/components/panels/SettingsPanel.tsx'), 'utf8');
    const appSettings = panel.slice(panel.indexOf("title: 'App Settings'"), panel.indexOf("title: 'Legal & Trust'"));
    expect(appSettings, 'the Git tile is missing from App Settings').toContain("id: 'git'");
    // And the dead screen that hid it is gone, not merely bypassed.
    expect(panel).not.toContain("settingsScreen === 'modules'");
  });
});
