/**
 * One composer, everywhere — admin 2026-09-20, with two phone screenshots side by side.
 *
 * *"yeh 2 chat ui hai … mujhe SDA ka input box bhi baki ai ke jaisa karna hai. isko badal ke, other
 * professionals ke jaise hi karo!!"*
 *
 * Mentor / Career Coach and Senior Doctor Assistant are the same product on the same phone, and
 * their message rows already look alike. The row a doctor actually types into did not:
 *
 *   • the paperclip and the dictation mic sat INSIDE the text box, so the writing area started a
 *     third of the way across and a two-word placeholder wrapped onto two lines;
 *   • the text was `text-[12px]` against every other composer's `text-sm`;
 *   • the box was pinned to a 44px minimum while the buttons beside it were 40px, so the row's
 *     baseline did not line up with itself.
 *
 * 🔑 THE CLASS, not the instance: every chat screen in this repo hand-rolls its composer, and
 * nothing has ever held them to one shape — the same reason `lib/autoGrowTextarea.ts` had to be
 * written after two composers shipped `rows={1}` with no grow logic at all. So this suite does not
 * assert a list of classes it was handed; it DERIVES the professionals' composer from their own
 * source and requires the doctor's to match it. Restyle `ProfessionalChat` and this test asks for
 * `SDAChat` in the same breath.
 *
 * ⚠️ What is deliberately NOT required to match, each for a stated reason:
 *   • the ACCENT colour (emerald here, indigo there) — the persona's identity, which the admin did
 *     not ask to remove and which the rest of this screen carries;
 *   • the DICTATION mic — speech → text, a control the professionals do not have. It moves out of
 *     the box like everything else, but its existence is not a deviation from the shape;
 *   • the `Volume2` icon on the voice button — two mic glyphs side by side would be two different
 *     features wearing one icon. The distinction predates this change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const SDA = read('src/components/sda/SDAChat.tsx');
const PRO = read('src/components/professionals/ProfessionalChat.tsx');

/** Comments quote the OLD wording as evidence; only live code may answer these questions. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const SDA_CODE = code(SDA);
const PRO_CODE = code(PRO);

/** The class list of the first `<textarea>` in a file — the composer's own box. */
function composerClasses(src: string): string[] {
  const ta = src.slice(src.indexOf('<textarea'));
  const m = /className="([^"]+)"/.exec(ta);
  expect(m, 'a composer textarea with a className').toBeTruthy();
  return m![1].split(/\s+/).filter(Boolean);
}

describe('the doctor types into the same box as everyone else', () => {
  const sdaClasses = composerClasses(SDA_CODE);
  const proClasses = composerClasses(PRO_CODE);

  it('carries every shape class the professionals composer carries', () => {
    // Derived, not transcribed: the accent-coloured focus ring is the one permitted difference.
    const shape = proClasses.filter((c) => !c.startsWith('focus:border-'));
    expect(shape.length, 'the professionals composer still has classes to compare against')
      .toBeGreaterThan(6);
    for (const cls of shape) {
      expect(sdaClasses, `SDAChat composer is missing "${cls}"`).toContain(cls);
    }
  });

  it('is the row\'s own bordered box, not a transparent slot inside one', () => {
    // The old shape: a wrapper div owned the border and the textarea was `bg-transparent`.
    expect(sdaClasses).not.toContain('bg-transparent');
    expect(SDA_CODE).not.toContain('focus-within:border-emerald-600/60');
    expect(sdaClasses).toContain('flex-1');
  });

  it('is sized in the shared vocabulary, not a private pixel minimum', () => {
    expect(sdaClasses).toContain('text-sm');
    expect(sdaClasses).not.toContain('text-[12px]');
    // `BASE_HEIGHT` was the 44px floor that made this box taller than the controls beside it.
    expect(SDA_CODE).not.toContain('BASE_HEIGHT');
    expect(SDA_CODE).not.toContain('minHeight');
  });

  it('keeps the placeholder to one line on a phone', () => {
    // "Type your answer or clinical finding..." wrapped onto two lines in the admin's screenshot.
    // The attribute is a ternary here, so every string literal inside it is a placeholder the
    // user can actually be shown — check them all, not just the first.
    const attrs = [...SDA_CODE.matchAll(/placeholder=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1]);
    const placeholders = attrs.flatMap((a) => [...a.matchAll(/['"]([^'"]{2,})['"]/g)].map((m) => m[1]));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const p of placeholders) {
      expect(p.length, `placeholder too long for one line: "${p}"`).toBeLessThanOrEqual(34);
    }
  });
});

describe('every control on the row is its own button, the same size as the others', () => {
  /** The composer row: from the attach control to the end of the send button. */
  const row = SDA_CODE.slice(SDA_CODE.indexOf('<AttachMenu'));

  it('uses the SHARED attach menu — so the camera is finally offered here', () => {
    // The paperclip opened the file browser directly, which is exactly the miss AttachMenu exists
    // for: photographing an X-ray or an ECG strip is the likeliest attachment on this screen.
    expect(SDA_CODE).toContain('<AttachMenu');
    expect(SDA_CODE).not.toContain('fileInputRef');
    expect(SDA_CODE).not.toContain('type="file"');
  });

  it('gives the attach, dictation, voice and send controls one size', () => {
    const buttons = row.slice(0, row.indexOf('</div>') + 6);
    const sized = [...buttons.matchAll(/w-9 h-9 rounded-xl/g)].length;
    // attach + dictation + voice + send (the send/stop pair counts once per branch).
    expect(sized, 'every control on the composer row is w-9 h-9 rounded-xl').toBeGreaterThanOrEqual(5);
    expect(buttons).not.toContain('w-10 h-10');
  });
});

describe('🔒 the sizing rule is shared, not copied', () => {
  it('SDAChat grows and resets through lib/autoGrowTextarea', () => {
    // It carried its own three-line `autoResize`, byte-for-byte the body of `autoGrow`. Two copies
    // of a sizing rule is how one composer ends up behaving differently from every other.
    expect(SDA_CODE).toContain("from '../../lib/autoGrowTextarea'");
    expect(SDA_CODE).toContain('autoGrow(el, MAX_HEIGHT)');
    expect(SDA_CODE).toContain('resetGrow(inputRef.current)');
    expect(SDA_CODE).not.toMatch(/el\.style\.height = `\$\{Math\.min\(el\.scrollHeight/);
  });
});
