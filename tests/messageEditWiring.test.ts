import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { searchActive } from '../src/lib/chatToolbar';

/**
 * ADMIN 2026-08-10: "NavBharatAI Pro me send kiye hue text ko delete kar sakte hai — yah sabhi jagah
 * hona chahiye, saath me edit bhi kar sake (WhatsApp ke tarah)."
 *
 * v5.0 already had a real delete (unsend) and edit on the last user message. This slice brings both
 * to the other three AIs. The RULES are proven in tests/chatComposerCore.test.ts; what is checked
 * here is that each screen genuinely applies them — and the specific things that would make the
 * button a lie on each surface.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('search hides the per-message actions — the index would point at the wrong message', () => {
  it('searchActive is true only for a real query', () => {
    /**
     * The controls are addressed by POSITION in the real transcript. A filtered list renumbers
     * everything, so a delete tapped on the third visible bubble would remove the third message of
     * the WHOLE conversation — a different message entirely.
     */
    expect(searchActive('')).toBe(false);
    expect(searchActive('   ')).toBe(false);
    expect(searchActive('todo')).toBe(true);
  });

  for (const file of [
    'src/components/ide/AIChat.tsx',
    'src/components/sda/SDAChat.tsx',
    'src/components/professionals/ProfessionalChat.tsx',
  ]) {
    it(`${file} guards its actions with it`, () => {
      const src = read(file);
      expect(src).toContain('<MessageEditActions');
      expect(src).toContain('!searchActive(chatSearchQuery)');
    });
  }
});

describe('every screen applies the SHARED rules, not its own', () => {
  for (const file of [
    'src/components/ide/AIChat.tsx',
    'src/components/sda/SDAChat.tsx',
    'src/components/professionals/ProfessionalChat.tsx',
  ]) {
    it(`${file} calls deleteMessage / editMessage`, () => {
      const src = read(file);
      expect(src).toContain('deleteMessage(');
      expect(src).toContain('editMessage(');
      // A rewind under a running answer is not a state we can honestly draw.
      expect(src).toMatch(/disabled=\{(loading|isLoading)\}/);
    });
  }
});

describe('the free chat: a Clear button that did NOTHING is gone', () => {
  const chat = read('src/components/ide/AIChat.tsx');
  const panel = read('src/components/panels/NBIChatPanel.tsx');

  it('no longer fires a sentinel through a prop nobody passes', () => {
    /**
     * REAL DEFECT, found while wiring this: Clear called `onSendSuggestion?.('__CLEAR_CHAT__')`, and
     * NOTHING in the codebase passed `onSendSuggestion` or handled that sentinel. The optional-call
     * swallowed it — so the button rendered, looked alive, and did nothing for every real user.
     */
    expect(chat).not.toContain('__CLEAR_CHAT__');
    expect(read('src/components/panels/NBIChatPanel.tsx') + chat).not.toContain('__CLEAR_CHAT__');
  });

  it('Clear is offered only when the host can honour it, and the host does', () => {
    expect(chat).toContain('onClear={onMessagesChange ?');
    expect(panel).toContain('onMessagesChange={(next) => setMessages(next)}');
  });

  it('the old fake "edit" that duplicated the question is gone', () => {
    // It copied the text into the composer and left the original message AND its answers in place,
    // so re-sending produced the same question twice with two different answers under it.
    expect(chat).not.toContain('title="Edit and resend this message"');
  });
});

describe('Doctor AI: the rewind is TRUE on the server, not just on screen', () => {
  const sda = read('src/components/sda/SDAChat.tsx');

  it('rotates the case id so accumulated clinical state cannot survive a retraction', () => {
    /**
     * THE REASON THIS SURFACE NEEDED SPECIAL CARE. `/api/sda-chat` keeps a per-case clinical store:
     * `patientData` and `redFlags` are ACCUMULATED from each reply into one blob and never re-derived
     * from the transcript. Removing a bubble client-side would leave the finding it produced live in
     * the AI's reasoning — the doctor believing they had retracted something while the assistant
     * carried on treating it as fact. Rotating the id abandons that accumulation, so the server
     * re-seeds from the SURVIVING transcript.
     */
    /**
     * ⚠️ UPDATED 2026-09-19, and the RULE above is unchanged — only the name of the thing that rotates.
     *
     * This used to assert `caseIdRef.current = freshId` and a write to the shared `'sda_messages'` key,
     * because ONE ref served two jobs: the server's clinical-store key AND the case's identity. That
     * was harmless while every case shared one Firestore document. It stopped being harmless when each
     * case got its own document (`sdaCaseStore.ts`): rotating the CASE here would move the patient to a
     * new document — and a new History row — every time the doctor corrected a typo, orphaning the row
     * their case was already in.
     *
     * So the refs were split, and this case now pins BOTH halves: the clinical session still rotates
     * (the rule this test was written for), and the case must NOT. Asserting only the rename would have
     * dropped the guard that the original rule depended on.
     */
    const at = sda.indexOf('const rewindCase');
    expect(at).toBeGreaterThan(-1);
    const fn = sda.slice(at, sda.indexOf('const handleSend'));
    expect(fn).toContain('newSdaCaseId()');
    expect(fn).toContain('clinicalSessionRef.current = newSdaCaseId()');
    // The patient, their document and their History row all stay put across a retraction.
    expect(fn).not.toContain('caseIdRef.current =');
    expect(fn).not.toContain('caseDocRef.current =');
    // Red flags are derived from turns that may no longer exist.
    expect(fn).toContain('setActiveRedFlags([])');
    // The rewind must be persisted, or a reload resurrects the retracted turns — now under THIS case's
    // own key, so persisting a retraction can never touch another patient's transcript.
    expect(fn).toContain('localStorage.setItem(sdaMessagesKey(caseIdRef.current)');
  });

  it('a re-ask after a rewind sends the SURVIVING history, not the stale closure', () => {
    /**
     * `setMessages` does not update the `messages` a closure already captured, so a re-ask fired
     * straight after a rewind would send the server the very turns the doctor had just taken back.
     */
    expect(sda).toContain('baseTranscript?: SDAMessage[]');
    expect(sda).toContain('const base = baseTranscript ?? messages;');
    expect(sda).toContain('const history = base.map(');
    expect(sda).toContain('void handleSend(r.resend, rewound)');
  });
});

describe('the professionals: an edit must not duplicate the question', () => {
  const prof = read('src/components/professionals/ProfessionalChat.tsx');

  it('re-sends onto the REWOUND transcript instead of appending to stale state', () => {
    expect(prof).toContain('resendOf?: Msg[]');
    expect(prof).toContain('const next: Msg[] = resendOf ?? [...messages,');
    expect(prof).toContain('void send(r.resend, rewound)');
  });

  it('keeps the "edited" marker — the history never pretends the original was never sent', () => {
    expect(prof).toContain('editedLabel()');
    expect(prof).toContain('...(m.edited ? { edited: true } : {})');
  });

  it('uses POSITION as the id, because adding one would invalidate every saved conversation', () => {
    // The transcript is a plain {role, content}[] persisted to localStorage on every user's device.
    expect(prof).toContain('const msgId = (index: number) => String(index);');
  });
});
