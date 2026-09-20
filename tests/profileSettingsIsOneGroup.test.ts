/**
 * THREE BOXES BECAME ONE — "Profile Settings" (admin 2026-09-20, with a screenshot).
 *
 * Admin, verbatim: *"setting ke andar account, your app, general settings teeno ko mila kar ek
 * setting option bana do! 'profile settings' — aur profile settings ke andar sabhi teeno tile add
 * kar do! profile, apk download, general … profile settings sabse upar!"*
 *
 * WHAT WAS WRONG, AND IT IS NOT "TOO MANY HEADINGS". Each of the three groups carried exactly ONE
 * tile. So the Settings home spent three whole section cards — three uppercase headings, two
 * descriptions, three borders — to offer three buttons, and on a phone that filled the first
 * screen before a single App Setting came into view. The reader had to parse three labels to
 * discover that each box held one thing.
 *
 * And the three belong together by a rule the screen already follows: they are about YOU and YOUR
 * copy of NavBharatAI (your profile, your app's installable file, how the app looks), while App
 * Settings below is about THE APP YOU BUILT (its domain, its database, its hosting). That line is
 * the one the 2026-08-14 regroup drew; this change keeps it and stops subdividing the near side.
 *
 * 🔒 THE RISK THIS FILE EXISTS FOR: the three tiles ROUTE THREE DIFFERENT WAYS.
 *   • My Profile   → `nav: true`  → setActiveView('my_profile')  — a top-level VIEW
 *   • Download APK → `tab: true`  → toggleTab('apk')             — a workspace TAB
 *   • General      → (neither)    → setSettingsScreen('general') — a Settings SUB-SCREEN
 * Merging three groups into one is exactly the edit that would quietly drop a flag, and a dropped
 * flag does not fail a typecheck or a render — the tile simply stops working, or opens a blank
 * Settings page with a heading and nothing under it (the 'modules' and 'admin' bug class this repo
 * has already paid for twice). Each flag is asserted BY ITS TILE below.
 *
 * Reversion-proven: removing the merge, dropping either flag, or dropping a tile each turn one of
 * these red.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const panel = readFileSync(join(__dirname, '..', 'src/components/panels/SettingsPanel.tsx'), 'utf8');
const kb = readFileSync(join(__dirname, '..', 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');

/**
 * Block comments explain what was merged and why; only real code counts. `//` line comments are
 * deliberately KEPT, because the tile definitions sit among them and stripping line comments would
 * need a parser to tell a comment from a string containing `//`.
 */
const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

/** The Profile Settings group, bounded by the next group's title. */
function profileGroup(): string {
  const at = code.indexOf("title: 'Profile Settings'");
  expect(at, 'the Profile Settings group must exist').toBeGreaterThan(-1);
  const end = code.indexOf("title: 'App Settings'", at);
  expect(end, 'App Settings must still follow it').toBeGreaterThan(at);
  return code.slice(at, end);
}

describe('Profile Settings is ONE group', () => {
  it('exists, and the three one-tile groups it replaced are gone', () => {
    expect(code).toContain("title: 'Profile Settings'");
    expect(code).not.toContain("title: 'Account'");
    expect(code).not.toContain("title: 'Your App'");
    expect(code).not.toContain("title: 'General Settings'");
  });

  it('🔒 holds ALL THREE tiles — profile, apk download, general', () => {
    const group = profileGroup();
    expect(group, 'My Profile').toContain("id: 'my_profile'");
    expect(group, 'Download APK').toContain("id: 'apk'");
    expect(group, 'General').toContain("id: 'general'");
  });

  it('🔒 is the FIRST group on the screen — "profile settings sabse upar"', () => {
    // Every other group's title must come after it. The user identity card (avatar, name, email)
    // still renders above: it is who you are, not an option you can open.
    const first = code.indexOf("title: 'Profile Settings'");
    for (const other of ['App Settings', 'Legal & Trust']) {
      expect(code.indexOf(`title: '${other}'`), other).toBeGreaterThan(first);
    }
  });

  it('🔒 the tiles keep their labels exactly — these are what the user reads', () => {
    const group = profileGroup();
    expect(group).toContain("label: 'My Profile'");
    expect(group).toContain("label: 'Download APK'");
    expect(group).toContain("label: 'General'");
  });
});

describe('🔒 each tile still goes where it went — three routes, one group', () => {
  it('My Profile keeps `nav: true` (a top-level view, not a Settings sub-screen)', () => {
    const group = profileGroup();
    const line = group.split('\n').find((l) => l.includes("id: 'my_profile'"));
    expect(line, 'the My Profile tile').toBeDefined();
    expect(line).toContain('nav: true');
  });

  it('Download APK keeps `tab: true` (the SAME APK Builder, not a second copy)', () => {
    const group = profileGroup();
    const line = group.split('\n').find((l) => l.includes("id: 'apk'"));
    expect(line, 'the Download APK tile').toBeDefined();
    expect(line).toContain('tab: true');
  });

  it('General carries NEITHER flag — it is a Settings sub-screen', () => {
    const group = profileGroup();
    const line = group.split('\n').find((l) => l.includes("id: 'general'"));
    expect(line, 'the General tile').toBeDefined();
    expect(line).not.toContain('nav: true');
    expect(line).not.toContain('tab: true');
  });

  it('🔒 the mapper still branches per ITEM, which is what makes one group possible', () => {
    // If this ever became a per-GROUP decision, putting three differently-routed tiles in one card
    // would break two of them silently. It is the load-bearing line of the whole change.
    expect(code).toContain("if ((item as any).tab) { toggleTab(item.id as any); }");
    expect(code).toContain("else if ((item as any).nav) { setActiveView(item.id as any); }");
    expect(code).toContain('else { setSettingsScreen(item.id as any); }');
  });
});

describe('🔒 the knowledge base sends users to the group that exists', () => {
  it('no path names a group that was removed', () => {
    // An AI that answers "Settings → Your App → Download APK" is describing a box the user cannot
    // find. Same wrong-answer failure the 2026-08-14 regroup guard was written for.
    expect(kb).not.toContain('Settings → Account →');
    expect(kb).not.toContain('→ Your App →');
    expect(kb).not.toContain('Settings → General Settings →');
    expect(kb).not.toContain('Settings \\u2192 General Settings \\u2192');
  });

  it('the three real paths are stated', () => {
    expect(kb).toContain('Settings → Profile Settings → My Profile');
    expect(kb).toContain('Settings → Profile Settings → General');
    expect(kb).toContain('Profile Settings → Download APK');
  });

  it('🔒 the Settings hub entry describes its own first group correctly', () => {
    expect(kb).toContain('Profile Settings (My Profile, Download APK, General)');
  });
});

describe('🔒 nothing user-facing still names a group that is gone', () => {
  it('the App Mart adult-content notice points at a real path', () => {
    // This sentence is shown to a creator whose app is waiting for review, so a stale path here is
    // not an internal detail — it is a person hunting for a box that no longer exists.
    const navStore = readFileSync(join(__dirname, '..', 'src/server/routes/navStore.ts'), 'utf8');
    expect(navStore).not.toContain('Settings → General Settings → Adult content');
    expect(navStore).toContain('Settings → Profile Settings → General → Adult content (18+)');
  });
});
