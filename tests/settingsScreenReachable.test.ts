/**
 * EVERY SettingsScreen MUST HAVE BOTH A DOORWAY AND A ROOM.
 *
 * This bug class has been found and hand-fixed FOUR separate times in SettingsPanel.tsx:
 *   • 'modules'    (2026-08-14) — rendered, nothing ever navigated to it. It was the ONLY home of
 *                  the Git & Deployment button, so the whole DevOps surface was unreachable while
 *                  the knowledge base confidently told users where to find it.
 *   • 'hosting' / 'cloudeploy' (2026-07-29 / 2026-08-20) — duplicate surfaces of the same kind.
 *   • 'sharing' / 'deploy' / 'access' (2026-08-21) — rendered, no doorway, and full of hardcoded
 *                  state and handler-less buttons that would have shipped the day anyone added one.
 *   • 'admin'      (2026-08-21) — the reverse failure: a live, always-visible "Admin Login" button
 *                  navigating to a screen NO branch renders, so it opened an empty Settings page.
 *                  An `as any` cast is what let it past the compiler.
 *
 * Each of those was fixed as an instance, with a comment asking the next person not to repeat it.
 * Comments do not enforce invariants, so this is the enforcement: a member with no navigator is
 * dead UI, and a navigator with no member is a blank page. Both now fail CI.
 *
 * This reads the SOURCE rather than rendering, deliberately: the failures above are about which
 * strings exist in which file, and a render test would need every screen's props mocked to prove
 * a fact that is purely static.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');

/**
 * Scan CODE, never comments.
 *
 * This is not a nicety — the first run of this test failed on its own documentation, because the
 * comment explaining the 'admin' bug contains the literal `setSettingsScreen('admin')`. A scanner
 * that cannot tell a bug from a description of a bug reports the fix as the failure. Every file
 * here is comment-stripped before any pattern is matched.
 *
 * Block comments (including JSX `{/* ... *\/}`) go entirely. Line comments are stripped only when
 * `//` opens the line, so a `https://` inside real code is never mistaken for one — truncating
 * that line could hide a genuine call and turn this test quietly green.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n');
}

const read = (rel: string) => stripComments(readFileSync(join(root, rel), 'utf8'));
const typesSrc = read('src/types/index.ts');
const panelSrc = read('src/components/panels/SettingsPanel.tsx');

/** The declared union members, read straight out of `export type SettingsScreen = ...`. */
function declaredScreens(): string[] {
  const m = typesSrc.match(/export type SettingsScreen =([\s\S]*?);/);
  if (!m) throw new Error('SettingsScreen union not found in src/types/index.ts');
  return [...m[1].matchAll(/'([a-z0-9_]+)'/gi)].map((x) => x[1]);
}

/**
 * Screens that can be opened. Three real mechanisms, all of which exist in the app today:
 *  1. a literal `setSettingsScreen('x')` anywhere in src/
 *  2. a `settingsScreen: 'x'` nav target (the knowledge base + offline assistant use these)
 *  3. the data-driven tile registry in SettingsPanel — `{ id: 'x', label: ... }` without
 *     `tab: true` (routed to toggleTab) or `nav: true` (routed to setActiveView)
 */
function navigableScreens(): Set<string> {
  const out = new Set<string>();
  for (const m of panelSrc.matchAll(/setSettingsScreen\(\s*'([a-z0-9_]+)'/gi)) out.add(m[1]);
  for (const src of [
    read('src/lib/offlineAssistant.ts'),
    read('src/server/AppContext/AppKnowledgeBase.ts'),
    read('src/components/agentv3/AgentV3Panel.tsx'),
    read('src/App.tsx'),
    panelSrc,
  ]) {
    for (const m of src.matchAll(/settingsScreen:\s*'([a-z0-9_]+)'/gi)) out.add(m[1]);
  }
  // Tile registry entries that fall through to setSettingsScreen(item.id).
  for (const m of panelSrc.matchAll(/\{\s*id:\s*'([a-z0-9_]+)'[^}]*\}/gi)) {
    if (!/tab:\s*true|nav:\s*true/.test(m[0])) out.add(m[1]);
  }
  // The Legal & Trust tiles are generated from LEGAL_META, so their ids never appear literally.
  for (const s of declaredScreens()) if (s.startsWith('legal_')) out.add(s);
  return out;
}

/** Screens with a rendered body. `legal_*` share one `startsWith('legal_')` branch. */
function renderedScreens(): Set<string> {
  const out = new Set<string>();
  for (const m of panelSrc.matchAll(/settingsScreen === '([a-z0-9_]+)'/gi)) out.add(m[1]);
  if (/settingsScreen\.startsWith\('legal_'\)/.test(panelSrc)) {
    for (const s of declaredScreens()) if (s.startsWith('legal_')) out.add(s);
  }
  // 'root' is rendered by the tile grid, which is guarded by the same equality check.
  return out;
}

describe('SettingsScreen reachability', () => {
  it('declares a non-trivial union (the parser itself still works)', () => {
    const screens = declaredScreens();
    expect(screens.length).toBeGreaterThan(5);
    expect(screens).toContain('root');
    expect(screens).toContain('general');
  });

  it('every declared screen has a doorway — something can navigate to it', () => {
    const nav = navigableScreens();
    const orphans = declaredScreens().filter((s) => !nav.has(s));
    expect(orphans, `Dead UI: these SettingsScreen members are rendered but nothing opens them. Add a doorway or delete the member. ${JSON.stringify(orphans)}`).toEqual([]);
  });

  it('every declared screen has a room — something renders it', () => {
    const rendered = renderedScreens();
    const empty = declaredScreens().filter((s) => !rendered.has(s));
    expect(empty, `Blank page: these SettingsScreen members can be navigated to but render nothing. ${JSON.stringify(empty)}`).toEqual([]);
  });

  it('no setSettingsScreen call targets a value outside the union', () => {
    const declared = new Set(declaredScreens());
    const targets = [...panelSrc.matchAll(/setSettingsScreen\(\s*'([a-z0-9_]+)'/gi)].map((m) => m[1]);
    const unknown = [...new Set(targets)].filter((t) => !declared.has(t));
    expect(unknown, `These navigate to a screen that is not a SettingsScreen — an \`as any\` cast will hide this from tsc and open a blank page. ${JSON.stringify(unknown)}`).toEqual([]);
  });

  it('the screens removed for being unreachable have not come back', () => {
    // Regression lock on the exact members deleted on 2026-08-14 and 2026-08-21.
    const declared = new Set(declaredScreens());
    for (const gone of ['modules', 'cloudeploy', 'hosting', 'sharing', 'deploy', 'access', 'profile', 'report']) {
      expect(declared.has(gone), `'${gone}' was removed as unreachable; re-adding it needs a real doorway AND a real screen.`).toBe(false);
    }
  });

  it('Admin Login opens the admin VIEW, not a settings screen that does not exist', () => {
    // The exact 2026-08-21 bug: setSettingsScreen('admin' as any) -> empty Settings page.
    expect(panelSrc).not.toMatch(/setSettingsScreen\(\s*'admin'/);
    expect(panelSrc).toMatch(/setActiveView\('admin'\)/);
  });
});
