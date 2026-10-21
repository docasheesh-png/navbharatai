// Autopsy 6452c0a9 (2026-10-21): a "BOUNCER BOOKING PRO" spec that asks for WhatsApp click-to-chat links was
// recorded as "LARGE — clone of WhatsApp" (ETA 13–23 min, big-app planner). Six earlier autopsies had each
// added one more "tool mention" shape; the seventh mentions slipped through again. CLASS: a famous product's
// NAME was treated as a clone request unless the mention was provably a tool. This pins the inversion: a
// clone is requested by a likeness word or by the name being the app's subject — nothing else.
import { describe, it, expect } from 'vitest';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';

// The three mentions of the real report that escaped every earlier list (verbatim sentences).
const BOUNCER = [
  'Build a Premium Online Bouncer Booking App',
  '',
  'Create a modern, professional, mobile-friendly online bouncer booking application named BOUNCER BOOKING PRO.',
  '',
  '2. Customer Panel',
  'Use the official WhatsApp click-to-chat feature. The customer should review and send the message themselves.',
  'If WhatsApp is unavailable, provide a normal SMS option and a copy-message button.',
  '',
  '7. WhatsApp and Contact System',
  'Every bouncer profile must have a Message button.',
].join('\n');

describe('a famous name is a clone request only with intent', () => {
  it('the real report: WhatsApp click-to-chat, "if WhatsApp is unavailable" and a WhatsApp heading are NOT a WhatsApp clone', () => {
    const s = analyzeAppScope(BOUNCER);
    expect(s.famousApp).toBeNull();
    expect(s.signals.join(' ')).not.toMatch(/clone/);
  });
  for (const [prompt, name] of [
    ['make a WhatsApp clone', 'WhatsApp'],
    ['WhatsApp jaisa app banao', 'WhatsApp'],
    ['build an app like WhatsApp with groups', 'WhatsApp'],
    ['Build me a WhatsApp', 'WhatsApp'],
    ['I want an app like Instagram', 'Instagram'],
  ] as const) {
    it(`still escalates when the user asks for the product: "${prompt}"`, () => {
      const s = analyzeAppScope(prompt);
      expect(s.famousApp ?? '').toContain(name);
      expect(s.decision).toBe('analyze');
    });
  }
  it('a bare name deep in a long spec, with no likeness word, is only a mention', () => {
    for (const line of ['Share the result on Instagram afterwards.', 'Optional: Netflix style row layout is NOT wanted.', 'Contact page: WhatsApp and Email']) {
      expect(analyzeAppScope(`Build a school fee reminder app\n\n${line}`).famousApp, line).toBeNull();
    }
  });
});
