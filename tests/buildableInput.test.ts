import { describe, it, expect } from 'vitest';
import {
  assessBuildInput, instructionWords, linksIn, knownUnreadableLink, MIN_INSTRUCTION_WORDS,
} from '../src/server/AgentV3/buildableInput';

/**
 * THE 5 MINUTE 57 SECOND QUESTION.
 *
 * Build report 2026-09-13 (541979d2). The whole prompt was one private Google Drive link to a 169 MB
 * video. The engine planned a file list for an app it invented (150s), ran the Simple Builder (90s),
 * abandoned the One-Shot (150s), opened the dead link twice, asked the user what to build — twice —
 * and closed by telling them to add credits for a "stronger engine".
 *
 * Step one of that list was always wrong. These tests are about reaching the question in under a
 * millisecond — and, just as importantly, about never asking it of somebody who really did say what
 * they wanted.
 */

describe('🔴 the reported prompt', () => {
  const REPORTED = 'https://drive.google.com/file/d/1Qm_z0FNmJd6HHJAVOQXT2ehmGl3NJgXk/view?pli=1';

  it('is recognised as nothing to build from', () => {
    const v = assessBuildInput(REPORTED);
    expect(v.buildable).toBe(false);
    expect((v as { reason: string }).reason).toBe('link-only');
  });

  it('names WHY it could not use the link, before asking anything', () => {
    // A bare "what should I build?" reads as though the link were never seen — which is how a user
    // concludes the product ignored them.
    const v = assessBuildInput(REPORTED) as { message: string };
    expect(v.message).toMatch(/Google Drive/i);
    expect(v.message.indexOf('Drive')).toBeLessThan(v.message.indexOf('Could you'));
  });

  it('🔒 says nothing about a vendor or a model', () => {
    const v = assessBuildInput(REPORTED) as { message: string };
    expect(v.message).not.toMatch(/claude|gemini|gpt|kimi|glm|grok|openai|anthropic/i);
  });
});

describe('⚠️ what must STILL build — the expensive mistake would be refusing a real prompt', () => {
  const real = [
    'a todo app with due dates',
    'build me a shop billing app with GST',
    'ek restaurant menu app banao',
    'a todo app, design here: https://figma.com/file/abc',
    'clone this landing page https://stripe.com and add a pricing table',
    'fix the login button',
    'portfolio site',
    'dashboard with charts',
  ];
  for (const prompt of real) {
    it(`builds: ${prompt.slice(0, 44)}`, () => {
      expect(assessBuildInput(prompt).buildable).toBe(true);
    });
  }

  it('a link WITH instructions is always buildable — the link is a bonus, not the problem', () => {
    expect(assessBuildInput('https://example.com build a clone of this for my bakery').buildable).toBe(true);
  });
});

describe('the shapes people actually send', () => {
  it('a link with only filler around it is still nothing', () => {
    for (const p of [
      'check this out https://drive.google.com/file/d/x/view',
      'https://drive.google.com/file/d/x/view please',
      'yeh dekho https://drive.google.com/file/d/x/view',
      'this file https://dropbox.com/s/abc/spec.pdf',
    ]) {
      expect(assessBuildInput(p).buildable, p).toBe(false);
    }
  });

  it('empty and whitespace ask plainly, with an example', () => {
    const v = assessBuildInput('   ') as { reason: string; message: string };
    expect(v.reason).toBe('empty');
    expect(v.message).toMatch(/for example/i);
  });

  it('one bare word is too short', () => {
    expect(assessBuildInput('app').buildable).toBe(false);
    expect(MIN_INSTRUCTION_WORDS).toBe(2);
  });

  it('two real words are enough — the bar is "any instruction", not "a good brief"', () => {
    expect(assessBuildInput('billing app').buildable).toBe(true);
  });
});

describe('the helpers', () => {
  it('strips links before counting words', () => {
    expect(instructionWords('https://drive.google.com/file/d/1Qm/view?pli=1')).toEqual([]);
    expect(instructionWords('build a bakery site www.example.com')).toContain('bakery');
  });

  it('keeps Devanagari — a Hindi prompt is a real prompt', () => {
    expect(instructionWords('दुकान का बिलिंग ऐप बनाओ').length).toBeGreaterThanOrEqual(2);
    expect(assessBuildInput('दुकान का बिलिंग ऐप बनाओ').buildable).toBe(true);
  });

  it('collects links, de-duplicated and capped', () => {
    expect(linksIn('https://a.com https://a.com https://b.com')).toEqual(['https://a.com', 'https://b.com']);
    expect(linksIn('https://a.com https://b.com https://c.com https://d.com')).toHaveLength(3);
  });

  it('🔒 only claims a link is unreadable when the URL itself says so', () => {
    expect(knownUnreadableLink('https://drive.google.com/file/d/x/view')).toMatch(/Drive/);
    expect(knownUnreadableLink('https://example.com/video.mp4')).toMatch(/video/);
    // An ordinary page might be perfectly readable — guessing otherwise would put a confident wrong
    // sentence in front of a user whose link was fine.
    expect(knownUnreadableLink('https://example.com/spec')).toBe('');
  });

  it('survives anything', () => {
    expect(() => assessBuildInput(null as never)).not.toThrow();
    expect(() => assessBuildInput(undefined as never)).not.toThrow();
    expect(assessBuildInput('😀😀').buildable).toBe(false);
  });
});

import { freeTierUpsellMessage } from '../src/server/AgentV3/FreeTierBuildRouting';
import { readFileSync } from 'fs';
import { join } from 'path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('🔴 the closing message stopped blaming the engine for a missing instruction', () => {
  it('an engine failure still invites credits — that message was right for its own case', () => {
    expect(freeTierUpsellMessage('engine')).toMatch(/strongest engine/i);
    expect(freeTierUpsellMessage()).toMatch(/strongest engine/i); // default unchanged
  });

  it('🔒 a prompt with nothing to build from asks for WORDS, never for money', () => {
    // The report's user pasted a Drive link, was asked twice what to build, and was then told to buy
    // credits. Credits would not have helped. An upsell attached to our own gap is how a product
    // loses trust it cannot buy back.
    const m = freeTierUpsellMessage('no-instruction');
    expect(m).not.toMatch(/credit|add credits|upgrade|pay|buy/i);
    expect(m).toMatch(/what the app should do/i);
  });

  it('neither message names a vendor or a model', () => {
    for (const c of ['engine', 'no-instruction'] as const) {
      expect(freeTierUpsellMessage(c)).not.toMatch(/claude|gemini|gpt|kimi|glm|grok|openai|anthropic|sonnet|opus/i);
    }
  });
});

describe('the wiring — the check runs BEFORE anything is spent', () => {
  const route = read('src/server/routes/agentv3.ts');

  it('the diversion sits in the intent block, before the build path', () => {
    expect(route).toContain('const inputCheck = assessBuildInput(prompt)');
    expect(route).toContain("intent = 'chat';");
    // Before the builders, not after: the whole saving is not reaching them.
    expect(route.indexOf('const inputCheck = assessBuildInput(prompt)'))
      .toBeLessThan(route.indexOf('const isPlainChatTurn'));
  });

  it('⚠️ only empty and link-only divert — never too-short', () => {
    // `too-short` would catch "continue" and re-open the continuation amnesia already fixed once.
    expect(route).toContain("inputCheck.reason === 'link-only' || inputCheck.reason === 'empty'");
    expect(route).not.toMatch(/inputCheck\.reason === 'too-short'/);
  });

  it('an attachment, an import or an edit is never diverted', () => {
    const block = route.slice(route.indexOf('const inputCheck = assessBuildInput(prompt)'));
    const guard = block.slice(0, 900);
    expect(guard).toContain("intent !== 'edit_existing'");
    expect(guard).toContain('rawAttachments.length === 0');
    expect(guard).toContain('zipImports.length === 0');
    expect(guard).toContain('importUrl');
  });

  it('the honest closing cause is computed from the same one check', () => {
    expect(route).toContain("assessBuildInput(prompt).buildable ? 'engine' : 'no-instruction'");
  });
});
