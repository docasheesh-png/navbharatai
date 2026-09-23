/**
 * THE BOX EMPTIES WHEN YOU PRESS SEND, AND YOUR WORDS COME BACK ONLY IF THE SEND FAILED
 * (admin 2026-09-22, screenshot: the whole brief still in the input box through a 52-second retry
 * countdown, after its bubble had already appeared in the thread).
 *
 * Both image composers cleared their box only on SUCCESS. Every other box in this app clears at
 * send. The reason for the old behaviour was real and is kept — a failed send must hand the words
 * back — so the fix is clear-at-send plus restore-on-failure, through ONE pure rule both composers
 * share (`draftAfterFailedSend`), never two copies.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftAfterFailedSend } from '../src/lib/draftAfterSend';

describe('draftAfterFailedSend', () => {
  it('hands the sent words back into an empty box', () => {
    expect(draftAfterFailedSend('', 'a clinic logo')).toBe('a clinic logo');
    expect(draftAfterFailedSend('   ', 'a clinic logo')).toBe('a clinic logo');
  });

  it('🔒 never overwrites a NEW brief the user started typing while the old one was in flight', () => {
    expect(draftAfterFailedSend('a cafe banner', 'a clinic logo')).toBe('a cafe banner');
  });

  it('is total — nothing it is handed can throw', () => {
    expect(draftAfterFailedSend(undefined as unknown as string, 'x')).toBe('x');
    expect(draftAfterFailedSend('', undefined as unknown as string)).toBe('');
  });
});

describe('both composers follow the rule — at the source, since a hook cannot be rendered here', () => {
  const free = readFileSync(join(process.cwd(), 'src/components/ide/AIImageGenerator.tsx'), 'utf8');
  const pro = readFileSync(join(process.cwd(), 'src/components/ide/ImageStudioPro.tsx'), 'utf8');

  for (const [name, src, handler] of [['free composer', free, 'const handleGenerate = async () => {'], ['pro studio', pro, 'const generate = async () => {']] as const) {
    it(`${name}: the box is emptied BEFORE the request goes out, and restored on failure`, () => {
      const start = src.indexOf(handler);
      expect(start).toBeGreaterThan(0);
      const body = src.slice(start, src.indexOf('\n  };', start));
      const clearAt = body.indexOf("setPrompt('');");
      const fetchAt = body.indexOf('await fetch(');
      expect(clearAt).toBeGreaterThan(0);
      // The clear precedes the network call — that is the whole complaint.
      expect(clearAt).toBeLessThan(fetchAt);
      // Exactly one unconditional clear: a second one after success would be the old behaviour
      // creeping back beside the new one.
      expect(body.match(/setPrompt\(''\);/g)?.length).toBe(1);
      // The failure path restores through the shared rule, never by a private copy of it.
      expect(body).toContain('setPrompt((cur) => draftAfterFailedSend(cur, typed))');
      // The words captured at send are what the history row records — not the now-empty state.
      expect(body).toContain('prompt: typed,');
    });
  }

  it('the free composer also restores when the wallet refuses — they will send it again after topping up', () => {
    const start = free.indexOf('const handleGenerate = async () => {');
    const body = free.slice(start, free.indexOf('\n  };', start));
    const creditAt = body.indexOf('if (noCredit) {');
    const restoreAt = body.indexOf('draftAfterFailedSend(cur, typed)', creditAt);
    const returnAt = body.indexOf('return;', creditAt);
    expect(creditAt).toBeGreaterThan(0);
    expect(restoreAt).toBeGreaterThan(creditAt);
    expect(restoreAt).toBeLessThan(returnAt);
  });
});
