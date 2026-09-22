import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * APP MART OPENED AS A WINDOW WITH NO WINDOW (admin 2026-09-21).
 *
 * Admin: *"app mart ko bhi multi window systm me add karo, slidebar menu me aur header me multi
 * tab/window (x=close) me bhi add karo"*.
 *
 * 🔴 WHAT WAS WRONG. `toggleTab('appstore')` pushed App Mart into `openTabs` exactly like every other
 * destination — and `TopNav` then did:
 *
 *     const item = menuItems.find(m => m.id === tabId);
 *     if (!item) return null;
 *
 * App Mart had no `menuItems` entry, so the tab existed in state, rendered no chip, and had no ✕.
 * Getting out of it meant navigating elsewhere and leaving it open behind you.
 *
 * ⚠️ THE SAME BUG, THE SAME FILE, THE SAME LINE OF TopNav, FOR THE THIRD TIME. `App.tsx`'s own
 * `other_ai` entry records it for Other AI (2026-07-23) and `SidebarNav`'s `SIDEBAR_HIDDEN` block
 * warns about that `return null` a third time — *"removing the entry would make opening Professionals
 * render NO header window at all, silently."* The class is: **`menuItems` is the REGISTRY for a
 * window**, and an id that opens a tab without being in it is a window nobody can see or shut.
 *
 * 🔑 ONE ENTRY SERVES BOTH SURFACES the admin asked for, which is why the fix is one line and not two:
 * TopNav renders the header chip and its ✕, and SidebarNav's `visibleItems` renders the menu row.
 */

const root = join(__dirname, '..');
const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
const topNav = readFileSync(join(root, 'src/components/panels/TopNav.tsx'), 'utf8');
const sidebar = readFileSync(join(root, 'src/components/panels/SidebarNav.tsx'), 'utf8');
const home = readFileSync(join(root, 'src/components/home/HomeView.tsx'), 'utf8');
const viewPanels = readFileSync(join(root, 'src/components/panels/ViewPanels.tsx'), 'utf8');

/** Block and line comments removed, so a rule about CODE is never satisfied or broken by prose. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The `menuItems` array as written in App.tsx, parsed into id → { label, icon }. */
function menuEntries(): Array<{ id: string; label: string; icon: string }> {
  const start = app.indexOf('const menuItems = useMemo');
  expect(start, 'menuItems must still exist in App.tsx').toBeGreaterThan(-1);
  const block = app.slice(start, app.indexOf('], []);', start));
  return [...block.matchAll(/\{\s*id:\s*'([a-z_0-9]+)',\s*label:\s*'([^']+)',\s*icon:\s*([A-Za-z0-9_]+)/g)]
    .map((m) => ({ id: m[1]!, label: m[2]!, icon: m[3]! }));
}

describe('App Mart is a window like every other window', () => {
  it('has a menuItems entry — without it TopNav renders nothing', () => {
    const entry = menuEntries().find((e) => e.id === 'appstore');
    expect(entry, 'appstore must be registered in menuItems').toBeDefined();
    expect(entry!.label).toBe('App Mart');
  });

  it('carries the SAME icon as its own Home tile, for the reason the other_ai entry gives', () => {
    // HomeView's App Mart tile uses `Icon: Store`. A different icon in the header would make one
    // product look like two — the consistency the `other_ai` entry states in as many words.
    const tile = home.slice(home.indexOf("id: 'appmart'"), home.indexOf("id: 'appmart'") + 900);
    expect(tile).toMatch(/Icon:\s*Store/);
    expect(menuEntries().find((e) => e.id === 'appstore')!.icon).toBe('Store');
    expect(app).toMatch(/import \{[^}]*\bStore\b[^}]*\} from 'lucide-react'/);
  });

  it('🔒 THE PREMISE: TopNav still drops a tab that is not in menuItems', () => {
    // If this ever stops being true, the entry above is no longer what makes the chip appear and every
    // assertion here is measuring the wrong thing. It is the reason the bug was silent.
    const strip = topNav.slice(topNav.indexOf('{openTabs.filter('));
    expect(strip).toMatch(/menuItems\.find\(m => m\.id === tabId\)/);
    expect(strip).toMatch(/if \(!item\) return null/);
  });

  it('🔒 the chip really carries a ✕ that calls closeTab — "x=close"', () => {
    const strip = topNav.slice(topNav.indexOf('{openTabs.filter('), topNav.indexOf('</AnimatePresence>'));
    expect(strip).toMatch(/onClick=\{\(e\) => closeTab\(e, tabId\)\}/);
    expect(strip).toMatch(/<X /);
  });

  it('appears in the sidebar — hidden by NEITHER of the two hide-sets', () => {
    const sidebarHidden = /const SIDEBAR_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
    const drawerHidden = /const DRAWER_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
    expect(sidebarHidden, 'SIDEBAR_HIDDEN must still exist').not.toBeNull();
    expect(drawerHidden, 'DRAWER_HIDDEN must still exist').not.toBeNull();
    // The rail half and the drawer half each filter by one of these, so a row appears in both only
    // when the id is in neither — one door per half, which is what the admin asked for.
    expect(sidebarHidden![1]).not.toContain('appstore');
    expect(drawerHidden![1]).not.toContain('appstore');
  });

  it('the view it opens is a real panel, so the chip cannot point at nothing', () => {
    expect(viewPanels).toMatch(/activeView === 'appstore'/);
    // An in-layout panel, not a full-screen overlay — otherwise the header (and its ✕) would be
    // covered by the very window the user is trying to close.
    const panel = viewPanels.slice(viewPanels.indexOf("activeView === 'appstore'"), viewPanels.indexOf("activeView === 'appstore'") + 300);
    expect(panel).toMatch(/flex-1 h-full overflow-hidden/);
  });

  it('and Home still opens it through that same id', () => {
    expect(app).toMatch(/onOpenAppMart=\{\(\) => toggleTab\('appstore'\)\}/);
  });
});

describe('every AI can tell the user how to close it', () => {
  it('🔒 AppKnowledgeBase names the new doors — the sync rule, with teeth', () => {
    // CLAUDE.md: a new navigation path or menu item gets its AppKnowledgeBase entry in the SAME
    // commit, because a feature not listed there is invisible to every AI in NavBharatAI. This is the
    // one surface that can answer "app mart band kaise karu" — and before this change the honest
    // answer was that you could not.
    const kb = readFileSync(join(root, 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    const entry = kb.slice(kb.indexOf("id: 'nav_app_store'"));
    const path = entry.slice(0, entry.indexOf('howToUse'));
    expect(path).toMatch(/Sidebar menu/);
    expect(path).toMatch(/header/);
    expect(path).toMatch(/✕/);
  });
});

describe('the registry itself', () => {
  it('no id is registered twice — a duplicate would render two chips for one window', () => {
    const ids = menuEntries().map((e) => e.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('🔒 every destination a HOME TILE opens is registered', () => {
    // A Home tile is a top-level destination by definition — it is nobody's child, so it must own a
    // closable window. This is the invariant App Mart broke, asserted for all of them at once.
    const wired = [...app.matchAll(/onOpen(?:OtherAI|AppMart)=\{\(\) => toggleTab\('([a-z_0-9]+)'\)\}/g)]
      .map((m) => m[1]!);
    expect(wired.length, 'both literal Home-tile handlers must be found').toBe(2);
    const ids = new Set(menuEntries().map((e) => e.id));
    for (const id of wired) expect(ids.has(id), `${id} opens from a Home tile and must be in menuItems`).toBe(true);
    // The other two tiles (free / pro) run multi-statement handlers rather than a bare toggleTab, so
    // they are asserted by id instead of by parsing — both are long-standing registry members.
    for (const id of ['nbi_chat', 'nbi_pro_chat']) expect(ids.has(id), id).toBe(true);
  });
});

/**
 * 🔒 THE RATCHET — a window with no chip cannot exist (the 50/50 half).
 *
 * Fixing App Mart was the first 50%. The other 50% is that this bug had happened three times to three
 * different ids, each found by a user rather than by CI, because nothing anywhere connected "an id
 * `toggleTab` is called with" to "an id `menuItems` knows about".
 *
 * A tab legitimately has no chip when it is somebody's CHILD: a professional AI chat is closed by
 * closing the surface it was opened through (`tabParenting.ts`), and the 75 professional ids are
 * therefore exempt BY DERIVATION from `professionalConfigs.ts` — never by a hand-kept copy, so a new
 * professional is covered without anybody remembering this file exists.
 *
 * ✅ AND THE DEBT LIST IS EMPTY (admin 2026-09-21, "haan" — ship all four). `about`, `apk`, `diff` and
 * `imagegen` had the identical defect and are now registered, each paired with an entry in
 * `SIDEBAR_HIDDEN` so four chips appeared without four sidebar rows appearing with them. The allowlist
 * stays as the MECHANISM — it is what lets a future reader record a genuine exception instead of
 * deleting the ratchet — but it may only ever be empty or shrinking.
 */
const KNOWN_UNREGISTERED: Readonly<Record<string, string>> = {
  // Empty on purpose. An id added here must carry the reason it cannot be registered, and the test
  // below fails the moment that reason stops being true.
};

/** The four registered on 2026-09-21 — chip yes, sidebar row no. */
const CHIP_ONLY: readonly string[] = ['about', 'apk', 'diff', 'imagegen'];

/**
 * Every `toggleTab('x')` in the WHOLE client tree.
 *
 * ⚠️ The corpus must be the tree, not a handful of files. `toggleTab` is handed down as a prop, so a
 * new tab can be opened from any component — and the first draft of this suite scanned four files and
 * missed `apk`, which SettingsPanel opens. A scoped search answers a scoped question (safeguard #6).
 */
function clientSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'server') walk(full); continue; }
      // ⚠️ COMMENTS STRIPPED. The first run of this found a target called `x` — from a `toggleTab('x')`
      // written inside a comment in App.tsx explaining this very test. A guard that reads prose reports
      // ids that do not exist, and the next reader goes looking for a window nobody ever opened.
      if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(stripComments(readFileSync(full, 'utf8')));
    }
  };
  walk(join(root, 'src'));
  return out;
}

describe('the ratchet — no new window without a chip', () => {
  const targets = [...new Set(
    clientSources().flatMap((src) => [...src.matchAll(/toggleTab\('([a-z_0-9]+)'\)/g)].map((m) => m[1]!)),
  )];

  /** The child surfaces, DERIVED from where a professional is defined — never re-typed here. */
  function professionalIds(): Set<string> {
    const cfg = readFileSync(join(root, 'src/components/professionals/professionalConfigs.ts'), 'utf8');
    const ids = [...cfg.matchAll(/^ {2}([a-z_0-9]+):\s*\{/gm)].map((m) => m[1]!);
    const elsewhere = /PROFESSIONALS_IMPLEMENTED_ELSEWHERE[^=]*=\s*\[([^\]]*)\]/.exec(cfg);
    const extra = elsewhere ? [...elsewhere[1]!.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]!) : [];
    return new Set([...ids, ...extra]);
  }

  it('finds a real corpus of tab targets, or it is proving nothing', () => {
    expect(targets.length).toBeGreaterThan(80);
    expect(targets).toContain('appstore');
  });

  it('🔴 every tab target is registered, a professional child, or listed debt', () => {
    const registered = new Set(menuEntries().map((e) => e.id));
    const children = professionalIds();
    expect(children.size).toBeGreaterThan(50);
    const orphans = targets.filter((t) => !registered.has(t) && !children.has(t) && !(t in KNOWN_UNREGISTERED));
    expect(orphans, `these open a tab that renders no chip and no ✕ — register them in menuItems (add to SIDEBAR_HIDDEN if they must stay out of the sidebar): ${orphans.join(', ')}`).toEqual([]);
  });

  it('🔒 the debt list may only SHRINK — every entry must still be a real unregistered target', () => {
    // Without this the list rots into a permanent exemption nobody re-checks: an id fixed later would
    // stay listed, and the next reader would believe four windows are broken when they are not.
    const registered = new Set(menuEntries().map((e) => e.id));
    for (const id of Object.keys(KNOWN_UNREGISTERED)) {
      expect(registered.has(id), `${id} is registered now — delete it from KNOWN_UNREGISTERED`).toBe(false);
      expect(targets, `${id} is no longer a tab target — delete it from KNOWN_UNREGISTERED`).toContain(id);
    }
  });

  it('🔒 nothing is exempted — App Mart and all four siblings are FIXED, not listed', () => {
    for (const id of ['appstore', ...CHIP_ONLY]) {
      expect(id in KNOWN_UNREGISTERED, `${id} must be registered, not exempted`).toBe(false);
    }
    expect(Object.keys(KNOWN_UNREGISTERED)).toEqual([]);
  });

  it('🔴 the four siblings are registered, so each one now has a chip and a ✕', () => {
    const registered = new Set(menuEntries().map((e) => e.id));
    for (const id of CHIP_ONLY) expect(registered.has(id), id).toBe(true);
  });

  it('🔒 …and NOT ONE of them added a sidebar row — the pairing is the whole point', () => {
    // Registering an id gives TopNav a chip AND gives SidebarNav a menu row. Only the first was
    // wanted: this sidebar has been deliberately trimmed more than once, so four new rows would be a
    // fix trading one problem for another. Without this assertion the regression is invisible — the
    // chips would work and the sidebar would quietly grow.
    const hidden = /const SIDEBAR_HIDDEN = new Set\(\[([^\]]*)\]\)/.exec(sidebar);
    expect(hidden).not.toBeNull();
    for (const id of CHIP_ONLY) expect(hidden![1], id).toContain(`'${id}'`);
    // The rail and the drawer both filter by this set, so one entry covers both halves.
    expect(sidebar).toMatch(/visibleItems = menuItems\.filter\(item => !SIDEBAR_HIDDEN\.has\(item\.id\)/);
  });

  it('🔒 each sibling chip is recognisable as the surface it opens', () => {
    const byId = new Map(menuEntries().map((e) => [e.id, e]));
    expect(byId.get('about')!.icon).toBe('Info');          // the drawer row's own icon
    expect(byId.get('diff')!.icon).toBe('FileDiff');       // AgentV3Panel's own Diff tab pill
    expect(byId.get('imagegen')!.icon).toBe('Wand2');      // its tool-grid tile
    // APK Builder's tile uses Smartphone, which Code Studio already owns in this same list — two
    // identical chips in one strip defeat the recognisability the rule serves, so it takes Package.
    expect(byId.get('apk')!.icon).toBe('Package');
    expect(byId.get('studio')!.icon).toBe('Smartphone');
    // Uniqueness is asserted over the ids that can actually RENDER a chip. TopNav does
    // `openTabs.filter(id => id !== 'home')`, so Home never draws one — which is why `home` and
    // `nbi_pro_chat` have both carried `Bot` since long before this change without ever colliding on
    // screen. Asserting over the whole list would fail on that pair and invite a "fix" to an icon
    // nobody can see, i.e. a change to a shipped surface for no reason.
    // (Since 2026-09-22 the same filter also drops the tabs App hides — a view entered through a chat
    // tab's Mode button — so the match is on the `home` clause, not the whole predicate.)
    expect(topNav).toMatch(/openTabs\.filter\(id => id !== 'home'/);
    const chipIcons = menuEntries().filter((e) => e.id !== 'home').map((e) => e.icon);
    expect(new Set(chipIcons).size, `two chips must not share one icon: ${chipIcons.join(', ')}`).toBe(chipIcons.length);
  });
});
