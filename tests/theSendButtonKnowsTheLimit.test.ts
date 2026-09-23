/**
 * A send that can only fail is not offered (admin 2026-09-23: "2000+ wala text se send button
 * inactive kar do"). The limit is the SERVER's, so both halves are asserted against the route.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { IMAGE_PROMPT_MAX, imagePromptLimit, imagePromptLimitNote } from '../src/lib/imagePromptLimit';
import { MAX_PROMPT_CHARS } from '../src/server/lib/imageGen';

const read = (p: string) => readFileSync(p, 'utf8');

describe('the image send button knows the limit', () => {
  it('🔒 the client limit IS the server limit — the route schemas and the generator agree', () => {
    expect(IMAGE_PROMPT_MAX).toBe(MAX_PROMPT_CHARS);
    const route = read('src/server/routes/imageGen.ts');
    // Both image routes: the free `schema` and the Pro `proSchema`.
    const maxes = [...route.matchAll(/^\s+prompt: vstring\(\{[^}]*max: ([\d_]+)/gm)].map((m) => Number(m[1].replace(/_/g, '')));
    expect(maxes.length).toBeGreaterThanOrEqual(2);
    for (const m of maxes) expect(m).toBe(IMAGE_PROMPT_MAX);
  });

  it('the failing case: a 2,431-character brief is over, and the note says so with both numbers', () => {
    const l = imagePromptLimit('x'.repeat(2_431));
    expect(l.over).toBe(true);
    expect(imagePromptLimitNote(l)).toBe('2,431 / 2,000 characters — too long to send. Please shorten it.');
  });

  it('exactly at the limit is sendable; the counter shows from 90%', () => {
    expect(imagePromptLimit('x'.repeat(2_000)).over).toBe(false);
    expect(imagePromptLimit('x'.repeat(1_799)).near).toBe(false);
    expect(imagePromptLimit('x'.repeat(1_800)).near).toBe(true);
  });

  it('the free generator counts what it SENDS: the words wrapped in type and tint', () => {
    const typed = 'x'.repeat(1_990);
    const sent = `Logo — ${typed} in warm tones`;
    const l = imagePromptLimit(typed, sent);
    expect(l.over).toBe(true); // 1,990 typed, but 2,013 sent
    expect(l.limit).toBe(2_000 - (sent.length - typed.length));
    expect(l.count).toBe(1_990);
  });

  it('🔒 both composers wire it: the button is off, and the send function refuses too (Enter key)', () => {
    const pro = read('src/components/ide/ImageStudioPro.tsx');
    expect(pro).toMatch(/disabled=\{!mode \|\| busy \|\| promptLimit\.over\}/);
    expect(pro).toMatch(/if \(!mode \|\| busy \|\| promptLimit\.over\) return;/);
    const free = read('src/components/ide/AIImageGenerator.tsx');
    expect(free).toMatch(/disabled=\{isLoading \|\| promptLimit\.over\}/);
    expect(free).toMatch(/\|\| isLoading \|\| promptLimit\.over\) return;/);
    expect(free).toMatch(/imagePromptLimit\(prompt\.trim\(\), buildEffectivePrompt\(\)\)/);
  });
});
