/**
 * EMOJI THAT CANNOT MOCK THE USER.
 *
 * ADMIN REQUEST 2026-08-15 — use emoji in every v5 build reply, but with the danger named in the same
 * sentence:
 *
 *     "app bani nahi aur emoji 😂😍😁 is type ke aa gaye to user ka majak banane jaisa lagega"
 *
 * A prompt cannot promise that. Under pressure a model absolutely will end a failed build with
 * "🎉 All done!", and one such message is enough to make every emoji in the product read as a machine
 * that did not notice the user's app is broken.
 *
 * So the test that matters is not "does it use emoji" — it is: 🔒 CAN A CELEBRATION REACH A USER WHOSE
 * APP DID NOT BUILD? The answer has to be no, by construction, at the one stream every surface reads.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeResponseEmoji,
  isCelebrationEmoji,
  celebrationAllowed,
  outcomeFromOk,
  honestResultEvent,
  EMOJI_RULE,
} from '../src/server/lib/responseEmoji';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

describe('🔒 the admin’s exact case', () => {
  it('a FAILED build cannot carry 😂😍😁', () => {
    const out = sanitizeResponseEmoji('Could not build your app 😂😍😁', 'failure');
    expect(out).toBe('Could not build your app');
  });

  it('nor a hyped one', () => {
    expect(sanitizeResponseEmoji('🚀 Ready to launch! 🎉', 'failure')).toBe('Ready to launch!');
    expect(sanitizeResponseEmoji('🔥 Nailed it 💯', 'failure')).toBe('Nailed it');
  });

  it('🔒 and neither can a build that is still RUNNING — nothing has succeeded yet', () => {
    expect(sanitizeResponseEmoji('🎉 Building your app…', 'working')).toBe('Building your app…');
  });

  it('🔒 nor a PARTIAL result — a missing feature has not earned a party', () => {
    expect(sanitizeResponseEmoji('🥳 Done — the login page is missing', 'partial'))
      .toBe('Done — the login page is missing');
  });

  it('🔒 but a genuinely working app KEEPS its celebration — this is not emoji removal', () => {
    expect(sanitizeResponseEmoji('🎉 Your app is live!', 'success')).toBe('🎉 Your app is live!');
  });
});

describe('🔒 informational emoji are never touched, whatever went wrong', () => {
  it('a failure keeps the emoji that HELP the user read it', () => {
    const msg = '❌ The build failed\n⚠️ The database was unreachable\n📄 3 files were saved';
    expect(sanitizeResponseEmoji(msg, 'failure')).toBe(msg);
  });

  it('a tick is a status mark, not a cheer', () => {
    expect(sanitizeResponseEmoji('✅ Saved your files', 'failure')).toBe('✅ Saved your files');
    expect(isCelebrationEmoji('✅')).toBe(false);
  });

  it('the subject vocabulary the prompt teaches all survives', () => {
    for (const e of ['🔐', '🗄️', '💳', '📱', '🎨', '📄', '🔍', '📊', '🔔', '🛒', '👤', '⚙️', '🌐', '🧩']) {
      expect(isCelebrationEmoji(e), e).toBe(false);
      expect(sanitizeResponseEmoji(`${e} a line`, 'failure'), e).toBe(`${e} a line`);
    }
  });
});

describe('🔒 a pile-up reads as fake even on a SUCCESS', () => {
  it('a run collapses to the first — one emoji is a signal, four is noise', () => {
    expect(sanitizeResponseEmoji('Done!! 🎉🎊🥳🚀', 'success')).toBe('Done!! 🎉');
    expect(sanitizeResponseEmoji('Done 🎉 🎊 🥳', 'success')).toBe('Done 🎉');
  });

  it('one emoji per line is left exactly as written', () => {
    const msg = '🔐 Added login\n🗄️ Created the database\n✅ Everything runs';
    expect(sanitizeResponseEmoji(msg, 'success')).toBe(msg);
  });
});

describe('multi-codepoint emoji are handled whole, never chopped', () => {
  it('a skin-tone variant is judged as the same gesture', () => {
    expect(isCelebrationEmoji('👍🏽')).toBe(true);
    expect(sanitizeResponseEmoji('👍🏽 nice', 'failure')).toBe('nice');
  });

  it('🔒 a kept sequence is not left with orphaned joiners', () => {
    // A ZWJ family is not celebratory — it must survive intact, not as visible garbage.
    const out = sanitizeResponseEmoji('👨‍👩‍👧 family page', 'failure');
    expect(out).toBe('👨‍👩‍👧 family page');
    expect(out).not.toContain('‍‍');
  });

  it('a variation-selector heart is still recognised', () => {
    expect(isCelebrationEmoji('❤️')).toBe(true);
    expect(sanitizeResponseEmoji('❤️ thanks', 'failure')).toBe('thanks');
  });
});

describe('the outcome comes from STATE, never from the words', () => {
  it('maps the ok flag', () => {
    expect(outcomeFromOk(true)).toBe('success');
    expect(outcomeFromOk(false)).toBe('failure');
    expect(outcomeFromOk(undefined)).toBe('working');
    expect(outcomeFromOk(true, { partial: true })).toBe('partial');
  });

  it('🔒 a message that CLAIMS success is still judged by the flag', () => {
    // The exact trap: the model writes "Successfully built!" on a build that failed.
    expect(sanitizeResponseEmoji('🎉 Successfully built your app!', 'failure'))
      .toBe('Successfully built your app!');
  });

  it('only success permits celebration', () => {
    expect(celebrationAllowed('success')).toBe(true);
    for (const o of ['failure', 'partial', 'working'] as const) expect(celebrationAllowed(o)).toBe(false);
  });
});

describe('🔒 the guarantee lives at the stream, so no call site can forget it', () => {
  const collect = (): { stream: AgentEventStream; seen: unknown[] } => {
    const stream = new AgentEventStream();
    const seen: unknown[] = [];
    stream.subscribe((e) => seen.push(e), false);
    return { stream, seen };
  };

  it('a failed done event is cleaned on the way out', () => {
    const { stream, seen } = collect();
    stream.emit({ type: 'done', ok: false, summary: '🎉 All set!', ts: 1 });
    expect((seen[0] as { summary: string }).summary).toBe('All set!');
  });

  it('a successful one is not', () => {
    const { stream, seen } = collect();
    stream.emit({ type: 'done', ok: true, summary: '🎉 All set!', ts: 1 });
    expect((seen[0] as { summary: string }).summary).toBe('🎉 All set!');
  });

  it('mid-build narration cannot celebrate', () => {
    const { stream, seen } = collect();
    stream.emit({ type: 'narration', agent: 'architect', text: '🚀 Almost there!', ts: 1 } as never);
    expect((seen[0] as { text: string }).text).toBe('Almost there!');
  });

  it('an error message cannot celebrate', () => {
    const { stream, seen } = collect();
    stream.emit({ type: 'error', message: '😍 Something went wrong', ts: 1 });
    expect((seen[0] as { message: string }).message).toBe('Something went wrong');
  });

  it('🔒 a surface that mounts LATE replays the same honest text', () => {
    const stream = new AgentEventStream();
    stream.emit({ type: 'done', ok: false, summary: '🥳 Done!', ts: 1 });
    const late: unknown[] = [];
    stream.subscribe((e) => late.push(e), true);
    expect((late[0] as { summary: string }).summary).toBe('Done!');
  });

  it('an unrelated event passes through untouched', () => {
    const { stream, seen } = collect();
    const ev = { type: 'preview', url: 'https://x.e2b.app', ts: 1 } as const;
    stream.emit(ev);
    expect(seen[0]).toEqual(ev);
  });
});

describe('the final result event, which travels on the raw stream', () => {
  it('is cleaned when the build failed', () => {
    expect(honestResultEvent({ type: 'result', ok: false, summary: '🎉 done', steps: 3 }))
      .toEqual({ type: 'result', ok: false, summary: 'done', steps: 3 });
  });

  it('is left alone when it succeeded', () => {
    const ev = { type: 'result', ok: true, summary: '🎉 done' };
    expect(honestResultEvent(ev)).toEqual(ev);
  });

  it('🔒 anything that is not a result event is returned untouched', () => {
    for (const junk of [null, undefined, 'text', 42, { type: 'other', summary: '🎉' }, { type: 'result' }]) {
      expect(honestResultEvent(junk)).toBe(junk);
    }
  });
});

describe('robustness — this sits on the path of every build reply', () => {
  it('survives junk without throwing', () => {
    for (const junk of [null, undefined, '', 0, {}]) {
      expect(() => sanitizeResponseEmoji(junk as never, 'failure')).not.toThrow();
    }
    expect(sanitizeResponseEmoji(null, 'failure')).toBe('');
  });

  it('leaves text with no emoji byte-identical', () => {
    const msg = 'Your app is built and the preview is running.';
    for (const o of ['success', 'failure', 'partial', 'working'] as const) {
      expect(sanitizeResponseEmoji(msg, o), o).toBe(msg);
    }
  });

  it('🔒 does not disturb non-Latin text — most users write Hindi', () => {
    expect(sanitizeResponseEmoji('आपका ऐप तैयार नहीं हो सका 😂', 'failure')).toBe('आपका ऐप तैयार नहीं हो सका');
    expect(sanitizeResponseEmoji('🔐 लॉगिन पेज जोड़ा', 'success')).toBe('🔐 लॉगिन पेज जोड़ा');
  });

  it('does not reflow the model’s own line breaks', () => {
    expect(sanitizeResponseEmoji('line one\n\nline two', 'failure')).toBe('line one\n\nline two');
  });
});

describe('the prompt half', () => {
  it('teaches placement and the forbidden case, not just "use emoji"', () => {
    expect(EMOJI_RULE).toContain('START of each step');
    expect(EMOJI_RULE).toContain('NEVER put two emoji next to each other');
    expect(EMOJI_RULE).toContain('FORBIDDEN');
    expect(EMOJI_RULE).toContain('🔐');
  });

  it('🔒 tells the model no emoji beats a wrong emoji', () => {
    expect(EMOJI_RULE).toContain('use none');
  });
});
