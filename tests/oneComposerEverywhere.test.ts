/**
 * One composer, everywhere — and since 2026-09-23 it is the FREE CHAT's composer.
 *
 * History, because this file has held two standards and the second one supersedes the first:
 *
 *   • 2026-09-20 — *"SDA ka input box bhi baki ai ke jaisa karna hai … other professionals ke jaise hi
 *     karo!!"*. Doctor AI was aligned to the professionals: every control its own `w-9 h-9 rounded-xl`
 *     box beside a square input. The complaint then was a paperclip and mic INSIDE the box on the LEFT,
 *     which pushed the writing area a third of the way across.
 *   • 2026-09-23 — *"navbharatai free ke andar, sabhi ai aur professionals ke inputbox ko navbharatai
 *     free ke jaisa karo. sabhi professionals, navbharatai free jaise hi lagne chahiye."* The target
 *     is now the free chat's box: rounded, controls INSIDE on the RIGHT, text starting at the left
 *     edge. That keeps what the 09-20 fix was actually for (the writing area is not pushed across)
 *     and gives every AI the one look the admin pointed at.
 *
 * 🔑 THE CLASS, not the instance: every chat screen used to hand-roll its composer, so a restyle of
 * one never reached the others. The FREE-mode surfaces now render ONE shell
 * (`components/chat/ComposerShell.tsx`), and the shell's classes are read back against the free
 * chat's own source (`AIChat.tsx`) — so neither side can drift from the other.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPOSER_BOX_CLASS, COMPOSER_TEXTAREA_CLASS, COMPOSER_SEND_CLASS, COMPOSER_STOP_CLASS,
} from '../src/components/chat/ComposerShell';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
/** Comments quote the OLD wording as evidence; only live code may answer these questions. */
const code = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const FREE_CHAT = code(read('src/components/ide/AIChat.tsx'));
const SURFACES = {
  professionals: code(read('src/components/professionals/ProfessionalChat.tsx')),
  doctorAi: code(read('src/components/sda/SDAChat.tsx')),
  imageGenerator: code(read('src/components/ide/AIImageGenerator.tsx')),
};

describe('the free chat IS the shell (2026-09-23: the two-row box)', () => {
  it('the free chat renders ComposerShell with the shared text, send and stop', () => {
    expect(FREE_CHAT).toContain('<ComposerShell');
    expect(FREE_CHAT).toContain('COMPOSER_TEXTAREA_CLASS');
    expect(FREE_CHAT).toContain('className={COMPOSER_SEND_CLASS}');
    expect(FREE_CHAT).toContain('className={COMPOSER_STOP_CLASS}');
  });

  it('the box keeps the free chat\'s look: rounded, themed, indigo on focus', () => {
    expect(COMPOSER_BOX_CLASS).toContain('rounded-2xl');
    expect(COMPOSER_BOX_CLASS).toContain('focus-within:border-indigo-500');
  });

  it('the text keeps its 16px size (no iOS zoom) and needs no right-hand reserve', () => {
    for (const cls of ['bg-transparent', 'text-[16px]', 'resize-none', 'leading-relaxed']) {
      expect(COMPOSER_TEXTAREA_CLASS.split(/\s+/)).toContain(cls);
    }
    expect(COMPOSER_TEXTAREA_CLASS).not.toMatch(/\bpr-(?:[3-9]\d|\d{3})\b/);
  });

  it('Send and Stop span the box\'s height (admin: "send button ko bhi 2 line me banao")', () => {
    for (const cls of [COMPOSER_SEND_CLASS, COMPOSER_STOP_CLASS]) expect(cls).toContain('h-full');
  });
});

describe('every AI in NavBharatAI FREE renders that one shell', () => {
  for (const [name, src] of Object.entries(SURFACES)) {
    it(`${name}: the box, the textarea and the send button all come from ComposerShell`, () => {
      expect(src).toContain("from '../chat/ComposerShell'");
      expect(src).toContain('<ComposerShell');
      expect(src).toContain('className={COMPOSER_TEXTAREA_CLASS}');
      expect(src).toContain('COMPOSER_SEND_CLASS');
      // History and Mode stay OUTSIDE the box, in the shell's left column (admin 2026-09-21 / 09-23).
      expect(src).toContain('onOpenMode={onOpenModePicker}');
      expect(src).toContain('onOpenHistory={onOpenHistory}');
      // Send has its own slot, spanning both rows — never squeezed into the control row.
      expect(src).toMatch(/send=\{\(/);
    });

    it(`${name}: no private square input left behind`, () => {
      expect(src).not.toContain('flex-1 resize-none bg-card border border-line rounded-xl');
    });
  }
});

describe('what Doctor AI keeps (the 2026-09-20 guards that still hold)', () => {
  const SDA = SURFACES.doctorAi;

  it('uses the SHARED attach menu — so the camera is offered for an X-ray or an ECG strip', () => {
    expect(SDA).toContain('<AttachMenu');
    expect(SDA).not.toContain('fileInputRef');
    expect(SDA).not.toContain('type="file"');
  });

  it('keeps the dictation mic AND the voice button as two different glyphs', () => {
    expect(SDA).toMatch(/<Mic className="w-4 h-4" \/>/);
    expect(SDA).toContain('icon={<Volume2 className="w-4 h-4" />}');
  });

  it('keeps the placeholder to one line on a phone', () => {
    const attrs = [...SDA.matchAll(/placeholder=(\{[^}]*\}|"[^"]*")/g)].map((m) => m[1]);
    const placeholders = attrs.flatMap((a) => [...a.matchAll(/['"]([^'"]{2,})['"]/g)].map((m) => m[1]));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const p of placeholders) expect(p.length, `placeholder too long for one line: "${p}"`).toBeLessThanOrEqual(34);
  });

  it('grows and resets through lib/autoGrowTextarea, not a private copy', () => {
    expect(SDA).toContain("from '../../lib/autoGrowTextarea'");
    expect(SDA).toContain('autoGrow(el, MAX_HEIGHT)');
    expect(SDA).toContain('resetGrow(inputRef.current)');
    expect(SDA).not.toContain('BASE_HEIGHT');
  });
});
