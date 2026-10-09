// A ROOM TAB THE KNOWLEDGE BASE NAMES MUST ACTUALLY EXIST (Q-600, 2026-10-09).
//
// `AppKnowledgeBase.ts` is what EVERY AI in NavBharatAI reads to answer "where is X?". Its
// live_collaboration entry told users to open "the Code tab for the shared editor + line comments"
// — and `LiveCollaboration.tsx` had no Code tab. The whole subsystem behind it was real and
// finished: the Firestore content doc, the presence/caret writes, the comments subcollection with
// its onSnapshot, `addComment` / `resolveComment` / `jumpToLine` / `handleCodeChange`, and the
// pure, unit-tested helpers in `lib/collabAnnotations.ts`. Only the JSX was missing, so a user
// following the app's own instructions looked for a tab that was not there, and every Firestore
// read the comments listener paid for went nowhere.
//
// That is the second absolute rule's forbidden third state — built, but not really working — and
// the CLASS behind it is a feature whose state and handlers exist while nothing renders them.
// Q-600's unused-locals ratchet is what surfaced it (9 unused locals in this one file, all of them
// this feature). This test locks the class in both directions:
//   1. every tab in the `RoomTab` union has a header button AND a render branch;
//   2. every tab label the component renders is named in the knowledge-base entry, and the entry
//      names no tab that does not exist (the stale "the AI tab" phrasing is asserted gone);
//   3. every handler of the shared editor is referenced from the JSX, so deleting the tab again
//      fails here with the reason rather than only moving a count in a baseline file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const component = readFileSync(join(root, 'src/components/ide/LiveCollaboration.tsx'), 'utf8');
const knowledge = readFileSync(join(root, 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');

// The union is the declared set of tabs: type RoomTab = 'free' | 'pro' | … ;
const unionLine = component.split('\n').find((l) => l.startsWith('type RoomTab')) ?? '';
const declaredTabs = [...unionLine.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

// The header button list is the set a user can actually tap, with the label shown on it.
const renderedTabs = [...component.matchAll(/\{ key: '([a-z]+)', label: '([^']+)'/g)].map((m) => ({
  key: m[1],
  label: m[2],
}));

// The one knowledge-base entry that describes this screen.
const entryStart = knowledge.indexOf("id: 'live_collaboration'");
const entry = knowledge.slice(entryStart, knowledge.indexOf('aiSurface', entryStart));

describe('every room tab the app promises is a tab the app renders', () => {
  it('the union, the header buttons and the render branches agree', () => {
    expect(declaredTabs.length, 'the RoomTab union could not be parsed').toBeGreaterThan(1);
    for (const tab of declaredTabs) {
      expect(
        renderedTabs.some((t) => t.key === tab),
        `RoomTab declares '${tab}' but no header button lets a user tap it`,
      ).toBe(true);
      expect(
        component.includes(`roomTab === '${tab}'`),
        `RoomTab declares '${tab}' but nothing renders it`,
      ).toBe(true);
    }
    // And nothing renders a branch for a tab the union does not declare.
    for (const m of component.matchAll(/roomTab === '([a-z]+)'/g)) {
      expect(declaredTabs, `a branch renders tab '${m[1]}', which the union does not declare`).toContain(m[1]);
    }
  });

  it('the Code tab exists — the shared editor and line comments are reachable', () => {
    expect(declaredTabs).toContain('code');
    expect(renderedTabs.find((t) => t.key === 'code')?.label).toBe('Code');
  });

  it('every handler of the shared editor is wired into the JSX', () => {
    // Each of these was written, tested at the helper level, and referenced by nothing.
    for (const handler of ['handleCodeChange', 'handleCaret', 'addComment', 'resolveComment', 'jumpToLine', 'relativeTime']) {
      const uses = [...component.matchAll(new RegExp(`\\b${handler}\\b`, 'g'))].length;
      expect(uses, `${handler} is declared but never used — the Code tab's UI is gone again`).toBeGreaterThan(1);
    }
    // The editor itself, and the comment box that pins to the caret's line.
    expect(component).toMatch(/ref=\{textareaRef\}/);
    expect(component).toMatch(/value=\{sharedCode\}/);
    expect(component).toMatch(/value=\{commentInput\}/);
  });
});

describe('the knowledge base describes the tabs that exist', () => {
  it('names every tab a user can tap', () => {
    for (const { label } of renderedTabs) {
      expect(entry, `the live_collaboration entry never mentions the '${label}' tab`).toContain(label);
    }
  });

  it('no longer sends users to an "AI tab", which has never existed', () => {
    // The real name of that tab is Free. "the AI tab" was in howToUse for as long as the entry was.
    expect(entry).not.toContain('the AI tab');
  });

  it('tells the user what the Code tab actually does', () => {
    expect(entry).toContain('shared');
    expect(entry.toLowerCase()).toContain('line');
  });
});
