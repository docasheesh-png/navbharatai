import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readSendOnEnter, sendToggleLabel, sendToggleTitle, enterShouldSend, toolbarActionsVisible,
  clearConfirmText, filterMessages, searchResultLabel, SEND_ON_ENTER_KEY,
} from '../src/lib/chatToolbar';

/**
 * ADMIN 2026-08-10: "NavBharatAI Free me ON SEND, SEARCH, CLEAR option hai (input box ke just upar).
 * Yeh sabhi jagah hona chahiye" — and, on Export: "han kato!"
 *
 * The row already existed, in exactly ONE place, hand-written inside a 1,700-line component with its
 * preference read straight from localStorage at the call site. Copying it into three more screens is
 * how the four input boxes drifted apart to begin with, so the decisions live here and the React
 * component is a shell over them. These tests are that contract.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the Enter preference — one key, every AI', () => {
  it('is stored under a single shared key', () => {
    expect(SEND_ON_ENTER_KEY).toBe('chat_sendOnEnter');
  });

  it('defaults to Enter-sends, and only an explicit "false" turns it off', () => {
    // Anything else — unset, empty, junk — keeps the behaviour the free chat has always had. Silently
    // flipping a typing habit on every user would be worse than any inconsistency.
    expect(readSendOnEnter(() => null)).toBe(true);
    expect(readSendOnEnter(() => undefined)).toBe(true);
    expect(readSendOnEnter(() => '')).toBe(true);
    expect(readSendOnEnter(() => 'nonsense')).toBe(true);
    expect(readSendOnEnter(() => 'false')).toBe(false);
  });

  it('a storage that throws does not break the chat', () => {
    expect(readSendOnEnter(() => { throw new Error('private mode'); })).toBe(true);
  });

  it('the label says what the key does; the tooltip explains both halves', () => {
    expect(sendToggleLabel(true)).toBe('↵ Send');
    expect(sendToggleLabel(false)).toBe('⇧↵ Send');
    expect(sendToggleTitle(true)).toMatch(/Enter sends/i);
    expect(sendToggleTitle(true)).toMatch(/new line/i);
    expect(sendToggleTitle(false)).toMatch(/Shift\+Enter sends/i);
    expect(sendToggleTitle(true, 'hi')).toMatch(/[ऀ-ॿ]/);
  });
});

describe('enterShouldSend — the rule all four keydown handlers now share', () => {
  const base = { key: 'Enter', shiftKey: false, sendOnEnter: true, hasContent: true, isBusy: false };

  it('sends on a plain Enter when the toggle is on', () => {
    expect(enterShouldSend(base)).toBe(true);
    expect(enterShouldSend({ ...base, shiftKey: true })).toBe(false);
  });

  it('INVERTS with the toggle off — otherwise there is no keyboard send at all', () => {
    // With the toggle off, the user has explicitly asked for Shift+Enter to be the send key. Treating
    // Shift+Enter as "always a newline" would leave them unable to send without reaching for the mouse.
    expect(enterShouldSend({ ...base, sendOnEnter: false })).toBe(false);
    expect(enterShouldSend({ ...base, sendOnEnter: false, shiftKey: true })).toBe(true);
  });

  it('never sends mid-IME-composition — that Enter is committing a word, not sending', () => {
    /**
     * The real defect this closes: three of the four composers checked only `e.key === 'Enter'`, so a
     * Hindi or CJK typist choosing a candidate sent a half-finished word. In an India-first app that is
     * not an edge case.
     */
    expect(enterShouldSend({ ...base, isComposing: true })).toBe(false);
  });

  it('never sends an empty composer, and never while one send is already in flight', () => {
    expect(enterShouldSend({ ...base, hasContent: false })).toBe(false);
    expect(enterShouldSend({ ...base, isBusy: true })).toBe(false);
  });

  it('ignores every other key', () => {
    for (const key of ['a', 'Escape', 'Tab', 'ArrowUp', 'NumpadEnter']) {
      expect(enterShouldSend({ ...base, key })).toBe(false);
    }
  });
});

describe('what the row shows, and what Clear asks first', () => {
  it('Search and Clear appear only once there is a conversation to act on', () => {
    // A control that does nothing when tapped teaches the user not to trust the row.
    expect(toolbarActionsVisible(0)).toBe(false);
    expect(toolbarActionsVisible(1)).toBe(true);
  });

  it('Clear names the cost and says it cannot be undone', () => {
    const t = clearConfirmText(12);
    expect(t).toContain('12');
    expect(t).toMatch(/cannot be brought back/i);
    expect(clearConfirmText(1)).toContain('1 message');   // not "1 messages"
    expect(clearConfirmText(2)).toContain('2 messages');
    expect(clearConfirmText(3, 'hi')).toMatch(/[ऀ-ॿ]/);
  });
});

describe('search — a "where did I say that?" tool', () => {
  const msgs = [
    { text: 'build me a TODO app' },
    { text: 'here is your todo app' },
    { content: 'add useState(0) to the counter' },
    { text: undefined },
  ];

  it('matches case-insensitively, across both field names the four AIs use', () => {
    expect(filterMessages(msgs, 'todo')).toHaveLength(2);
    expect(filterMessages(msgs, 'TODO')).toHaveLength(2);
    expect(filterMessages(msgs, 'usestate')).toHaveLength(1);
  });

  it('matches inside a token — regex or word boundaries would miss the real searches', () => {
    // People search a build chat for `useState` and expect `useState(0)` to match.
    expect(filterMessages(msgs, 'useState(0)')).toHaveLength(1);
    expect(filterMessages(msgs, 'State')).toHaveLength(1);
  });

  it('an empty query returns everything — opening the box must not blank the screen', () => {
    expect(filterMessages(msgs, '')).toHaveLength(4);
    expect(filterMessages(msgs, '   ')).toHaveLength(4);
  });

  it('junk never throws, and a miss is empty rather than everything', () => {
    expect(filterMessages(msgs, 'zzzz')).toEqual([]);
    expect(filterMessages(undefined as any, 'x')).toEqual([]);
  });

  it('says "no matches" instead of leaving a blank screen looking broken', () => {
    expect(searchResultLabel(0, 40)).toMatch(/no matches/i);
    expect(searchResultLabel(3, 41)).toBe('3 of 41');
    expect(searchResultLabel(0, 40, 'hi')).toMatch(/[ऀ-ॿ]/);
  });
});

describe('WIRING — the row is genuinely on all four AIs, and Export is gone', () => {
  const screens: Array<[string, string]> = [
    ['free + IDE chat', 'src/components/ide/AIChat.tsx'],
    ['NavBharatAI Pro v5.0', 'src/components/agentv3/AgentV3Panel.tsx'],
    ['Doctor AI', 'src/components/sda/SDAChat.tsx'],
    ['the professionals', 'src/components/professionals/ProfessionalChat.tsx'],
  ];

  for (const [name, file] of screens) {
    it(`${name} renders the shared toolbar and shares the Enter rule`, () => {
      const src = read(file);
      expect(src).toContain('<ChatToolbar');
      expect(src).toContain('enterShouldSend({');
      // Search must actually filter what is rendered — a search box that highlights nothing is a lie.
      expect(src).toContain('filterMessages(');
      // …and Clear must be wired to something real, not left undefined.
      expect(src).toMatch(/onClear=\{/);
    });
  }

  it('EXPORT is gone from the row — the admin cut it ("han kato!")', () => {
    const src = read('src/components/ide/AIChat.tsx');
    expect(src).not.toContain("a.download = `chat-");
    expect(src).not.toMatch(/Export chat as Markdown/);
  });

  it('no screen hand-rolls the toggle any more — that duplication IS the drift', () => {
    for (const [, file] of screens) {
      const src = read(file);
      // The old inline version wrote the preference straight to localStorage at the call site.
      expect(src).not.toContain("localStorage.setItem('chat_sendOnEnter'");
    }
  });

  it('v5.0 no longer decides Enter from the DEVICE — the user chooses', () => {
    /**
     * The device guess was wrong in both directions: a phone with a Bluetooth keyboard could not send
     * from it, and a laptop user writing a long spec could not get a newline.
     */
    const src = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(src).not.toMatch(/e\.key === 'Enter' && !e\.shiftKey && !isTouchDevice/);
  });
});
