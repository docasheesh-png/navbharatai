import { describe, it, expect } from 'vitest';
import {
  publishableApps, publishBlockedReason, whenLabel, UNTITLED_LABEL,
  shortenSuggestedName, MAX_SUGGESTED_NAME,
} from './publishablePicker';

const NOW = 1_760_000_000_000;
const min = (n: number) => NOW - n * 60_000;

/**
 * THE APP MART PUBLISH PICKER (admin 2026-08-26). The tab used to contain only directions to another
 * screen; these tests pin the list that makes it a place you can actually publish from — and pin the
 * two things that keep it honest: never offering a row that could only be refused, and never showing
 * an enabled button with no name behind it.
 */
describe('publishableApps — what may be offered', () => {
  it('lists apps newest first, with a human "when" in the label', () => {
    const out = publishableApps([
      { id: 'a', title: 'Piano', workspaceId: 'ws-a', updatedAt: min(120) },
      { id: 'b', title: 'Shop', workspaceId: 'ws-b', updatedAt: min(5) },
    ], NOW);
    expect(out.map((a) => a.workspaceId)).toEqual(['ws-b', 'ws-a']);
    expect(out[0].label).toBe('Shop · 5 min ago');
    expect(out[1].label).toBe('Piano · 2 hours ago');
  });

  it('a chat that never became an app is NOT offered — it could only ever be refused', () => {
    const out = publishableApps([
      { id: 'chat', title: 'just talking' },
      { id: 'app', title: 'Real app', workspaceId: 'ws-1', updatedAt: NOW },
    ], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].workspaceId).toBe('ws-1');
  });

  it('one workspace is ONE app, however many history rows point at it — newest wins', () => {
    const out = publishableApps([
      { id: 'old', title: 'Old title', workspaceId: 'ws-1', updatedAt: min(600) },
      { id: 'new', title: 'New title', workspaceId: 'ws-1', updatedAt: min(2) },
    ], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].suggestedName).toBe('New title');
  });

  it('an untitled app still gets a name a human can pick out of a list', () => {
    const out = publishableApps([{ id: 'x', workspaceId: 'ws-1', updatedAt: NOW }], NOW);
    expect(out[0].suggestedName).toBe(UNTITLED_LABEL);
    expect(out[0].label).toContain(UNTITLED_LABEL);
  });

  it('carries the live flag through, and survives junk input without throwing', () => {
    expect(publishableApps([{ id: 'l', title: 'L', workspaceId: 'ws', updatedAt: NOW, live: true }], NOW)[0].live).toBe(true);
    expect(publishableApps(null, NOW)).toEqual([]);
    expect(publishableApps([], NOW)).toEqual([]);
    expect(publishableApps([{ id: 'z', workspaceId: '   ' } as any], NOW)).toEqual([]);
  });

  it('falls back to createdAt when a row has never been updated', () => {
    const out = publishableApps([{ id: 'c', title: 'C', workspaceId: 'ws', createdAt: min(30) }], NOW);
    expect(out[0].label).toBe('C · 30 min ago');
  });
});

describe('whenLabel — readable at every distance', () => {
  it('scales from minutes to months', () => {
    expect(whenLabel(min(0), NOW)).toBe('just now');
    expect(whenLabel(min(45), NOW)).toBe('45 min ago');
    expect(whenLabel(min(60), NOW)).toBe('1 hour ago');
    expect(whenLabel(min(60 * 25), NOW)).toBe('1 day ago');
    expect(whenLabel(min(60 * 24 * 70), NOW)).toBe('2 months ago');
  });

  it('an unknown time says nothing rather than lying about it', () => {
    expect(whenLabel(0, NOW)).toBe('');
    expect(whenLabel(NaN, NOW)).toBe('');
  });
});

describe('publishBlockedReason — no dead buttons', () => {
  const base = { signedIn: true, loading: false, appCount: 2, workspaceId: 'ws-1', name: 'Piano', busy: false };

  it("returns '' only when the publish can genuinely run", () => {
    expect(publishBlockedReason(base)).toBe('');
  });

  it('every blocked state carries words the user can act on', () => {
    for (const patch of [
      { signedIn: false }, { loading: true }, { appCount: 0 },
      { workspaceId: '' }, { name: '   ' }, { busy: true },
    ]) {
      const reason = publishBlockedReason({ ...base, ...patch });
      expect(reason, JSON.stringify(patch)).not.toBe('');
      expect(reason.length).toBeGreaterThan(8);
    }
  });

  it('the no-apps case tells the user where to build one', () => {
    expect(publishBlockedReason({ ...base, appCount: 0 })).toMatch(/build one/i);
  });
});

/**
 * THE REAL LISTINGS THIS CAP EXISTS FOR (admin 2026-09-17, from a phone screenshot of App Mart).
 * A workspace's title is the user's own BUILD PROMPT, the picker pre-filled the name with it
 * verbatim, and people accept a pre-filled field — so App Mart filled up with listings nobody
 * browsing could identify.
 */
describe('shortenSuggestedName — a prompt is not an app name', () => {
  const REAL = [
    'To build a massive, rapidly scaling carpooling platform for Indian cities',
    'I already have the complete frontend UI for my billing app and I need',
  ];

  it('cuts the real App Mart titles down to something a tile can show', () => {
    for (const raw of REAL) {
      const out = shortenSuggestedName(raw);
      expect(out.length).toBeLessThanOrEqual(MAX_SUGGESTED_NAME + 1); // +1 for the ellipsis
      expect(out.endsWith('…')).toBe(true);
      expect(raw.startsWith(out.slice(0, -1))).toBe(true); // never invents words
    }
  });

  it('leaves a name that already fits completely alone', () => {
    for (const good of ['medicine dose calculator', 'car racing game', 'Untitled app']) {
      expect(shortenSuggestedName(good)).toBe(good);
    }
  });

  it('never ends mid-word, and never ends on trailing punctuation', () => {
    const out = shortenSuggestedName('To build a massive, rapidly scaling carpooling platform');
    expect(out).not.toMatch(/[\s,.;:—-]…$/);
    // the character before the ellipsis belongs to a whole word from the source
    const body = out.slice(0, -1);
    expect(body.split(' ').every((w) => w.length > 0)).toBe(true);
  });

  it('collapses the newlines a pasted multi-line prompt arrives with', () => {
    expect(shortenSuggestedName('  my   notes\n\napp  ')).toBe('my notes app');
  });

  it('cuts a single over-long word hard rather than handing back one letter', () => {
    const out = shortenSuggestedName(`A${'b'.repeat(80)}`);
    expect(out.length).toBeLessThanOrEqual(MAX_SUGGESTED_NAME + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  it('degrades to an empty string rather than throwing, so UNTITLED_LABEL still takes over', () => {
    for (const bad of ['', '   ', null as never, undefined as never]) {
      expect(() => shortenSuggestedName(bad)).not.toThrow();
      expect(shortenSuggestedName(bad) || UNTITLED_LABEL).toBe(UNTITLED_LABEL);
    }
  });

  it('the picker applies it, so the pre-filled field is already name-shaped', () => {
    const [app] = publishableApps([{ id: 'p1', workspaceId: 'w1', title: REAL[0], updatedAt: min(1) }], NOW);
    expect(app.suggestedName.length).toBeLessThanOrEqual(MAX_SUGGESTED_NAME + 1);
    expect(app.suggestedName.endsWith('…')).toBe(true);
  });
});
