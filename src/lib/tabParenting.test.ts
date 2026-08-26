import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isChildSurface, shouldRecordOpener, childSurfaceIds, PARENT_SURFACES } from './tabParenting';

describe('THE REPORTED BUG — a professional opened from NavBharatAI Free', () => {
  it('is recorded as Free’s child, so ✕-ing Free closes it too', () => {
    // Admin 2026-08-25: pick Teacher from Mode inside Free, close the NavBharatAI tab, and the
    // professional chat stayed open — orphaned, in a product where it is part of Free.
    expect(shouldRecordOpener('teacher_ai', 'nbi_chat')).toBe(true);
    expect(shouldRecordOpener('sda_chat', 'nbi_chat')).toBe(true);
  });

  it('covers EVERY professional, not the two in the report', () => {
    for (const id of childSurfaceIds()) {
      if (id === 'nbi_pro_chat') continue;
      expect(shouldRecordOpener(id, 'nbi_chat')).toBe(true);
    }
  });

  it('reads the professionals from where they are DEFINED, so a new one is parented for free', () => {
    // A hand-kept copy would silently miss the next professional somebody adds — the exact class of
    // bug this fixes.
    const src = readFileSync(resolve(__dirname, 'tabParenting.ts'), 'utf8');
    expect(src).toContain('PROFESSIONAL_CHATS');
    expect(childSurfaceIds().length).toBeGreaterThan(5);
  });
});

describe('the fix that looks obvious and is wrong', () => {
  it('does NOT make Settings a child of Free', () => {
    // Simply adding nbi_chat to the parent list would have: open Settings from inside Free, close
    // Free, and the user's Settings tab disappears with it. A new bug traded for the old one.
    expect(shouldRecordOpener('settings', 'nbi_chat')).toBe(false);
    expect(shouldRecordOpener('home', 'nbi_chat')).toBe(false);
  });

  it('never adopts the v5.0 builder, whoever opened it', () => {
    // It is a full workspace with its own preview tab, its own files and possibly a running build.
    // Closing another tab must never take it down.
    expect(isChildSurface('nbi_pro_chat')).toBe(false);
    expect(shouldRecordOpener('nbi_pro_chat', 'nbi_chat')).toBe(false);
    expect(shouldRecordOpener('nbi_pro_chat', 'home')).toBe(false);
  });
});

describe('the original rule still holds', () => {
  it('an option launched from a parent surface is still its child', () => {
    for (const parent of PARENT_SURFACES) {
      expect(shouldRecordOpener('billing', parent)).toBe(true);
    }
  });

  it('a plain tab opened from a plain tab has no parent', () => {
    expect(shouldRecordOpener('billing', 'home')).toBe(false);
  });

  it('a tab is never its own parent, and junk is never recorded', () => {
    expect(shouldRecordOpener('teacher_ai', 'teacher_ai')).toBe(false);
    expect(shouldRecordOpener('', 'nbi_chat')).toBe(false);
    expect(shouldRecordOpener('teacher_ai', '')).toBe(false);
  });
});

describe('the rule is wired (locked)', () => {
  const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');

  it('App.tsx asks the shared rule instead of an inline allowlist', () => {
    expect(app).toContain('shouldRecordOpener(view as string, activeView as string)');
    expect(app).not.toContain("if ((activeView === 'settings' || activeView === 'professionals' || activeView === 'other_ai') && view !== activeView)");
  });
});

describe('the list cannot go stale (locked)', () => {
  // The Professionals screen is where a professional becomes visible to a user. Its card list is not
  // exported (the cards carry React icons), so it is read as TEXT here — enough to prove that every
  // professional a user can see is parented, and to FAIL when the next one is added and forgotten.
  const view = readFileSync(
    resolve(__dirname, '../components/professionals/ProfessionalsView.tsx'), 'utf8');
  //
  // ACTIVE cards only. An `active: false` card is a "coming soon" placeholder that cannot be opened
  // at all, so it can never be orphaned — and demanding it be parented would force a fake entry for a
  // surface that does not exist. (The first run of this test caught `architect_ai` for exactly that
  // reason, which is a good sign the parse is looking at the real list.)
  const cardIds = [...view.matchAll(/\{\s*id:\s*'([a-z0-9_]+)'[^}]*?active:\s*true[^}]*?\}/g)].map((m) => m[1]);

  it('finds the real card list', () => {
    expect(cardIds.length).toBeGreaterThan(8);
    expect(cardIds).toContain('teacher_ai');
    expect(cardIds).toContain('sda_chat');
    expect(cardIds).not.toContain('architect_ai'); // active: false — not reachable
  });

  it('every professional a user can see is either a child surface or deliberately excluded', () => {
    const deliberatelyNotAChild = ['nbi_pro_chat']; // a full workspace — see isChildSurface
    const orphans = cardIds.filter((id) => !isChildSurface(id) && !deliberatelyNotAChild.includes(id));
    // If this fails, a professional was added to the screen without being parented — close its parent
    // and it would be left orphaned on screen, which is the exact bug this module fixes.
    expect(orphans).toEqual([]);
  });
});
