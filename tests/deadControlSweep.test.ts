/**
 * NO HANDLER-LESS BUTTONS IN LIVE UI.
 *
 * The second absolute rule says a button must do what it says. On 2026-08-21 a sweep of every
 * `<button>` in `src/` found several that did nothing at all, in shipped, reachable screens:
 *
 *   • SettingsPanel  — "Update Preferences" (fixed in the settings change)
 *   • AIDebugger     — "Apply to File", sitting beside a working "Copy", promising to write the
 *                      AI's fix into the user's code. It could not: the component receives `files`
 *                      READ-ONLY, and this tab analyses a PASTED error with no workspace and no
 *                      identified target, so "apply" had no destination. Removed.
 *   • SecurityScan   — "JSON" and "PDF" exports. Both dead, and neither format was honest: the
 *                      scan returns a markdown STRING, so there is no findings object to serialise
 *                      and no PDF renderer in the app. Replaced with one real markdown download.
 *
 * This test guards the files that were actually cleaned. It is deliberately NOT a repo-wide scan:
 * several components legitimately render a `<button>` whose click is handled by a parent, and a
 * blanket rule would either fail on those or be loosened until it caught nothing. A narrow test
 * that genuinely bites beats a broad one that has to be exempted into uselessness.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');

/** Strip comments so a `<button>` inside a code sample or an explanation is never scanned. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n');
}

/** Opening `<button ...>` tags, brace-aware so `className={cn(...)}` does not end the tag early. */
function buttonTags(src: string): string[] {
  const out: string[] = [];
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + 7;
    let depth = 0;
    let end = -1;
    while (i < src.length) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { end = i; break; }
      i++;
    }
    if (end < 0) continue;
    out.push(src.slice(m.index, end + 1));
  }
  return out;
}

function handlerless(rel: string): string[] {
  const src = stripComments(readFileSync(join(root, rel), 'utf8'));
  return buttonTags(src).filter((t) => !/onClick|onPointerDown|onMouseDown|onTouchStart|type=["'{]?submit/.test(t));
}

describe('dead control sweep', () => {
  for (const rel of [
    'src/components/ide/AIDebugger.tsx',
    'src/components/ide/SecurityScan.tsx',
    'src/components/panels/SettingsPanel.tsx',
  ]) {
    it(`${rel} has no button that does nothing`, () => {
      const dead = handlerless(rel);
      expect(dead, `These <button>s have no click handler — they render, they look pressable, and they do nothing:\n${dead.join('\n\n')}`).toEqual([]);
    });
  }

  it('the security report download is real, not a format we cannot produce', () => {
    const src = readFileSync(join(root, 'src/components/ide/SecurityScan.tsx'), 'utf8');
    // Saves through the iOS-safe helper, not a bare <a download> that no-ops on iPhone.
    expect(src).toMatch(/deliverTextFile\(/);
    // Markdown, because `data.reply` IS markdown. No PDF renderer ships with the app.
    expect(src).toMatch(/text\/markdown/);
    expect(stripComments(src)).not.toMatch(/>\s*PDF\s*</);
  });

  it('AIDebugger does not offer to apply a fix it has no way to apply', () => {
    // `files` is read-only here and the pasted-error tab has no workspace or target file.
    expect(stripComments(readFileSync(join(root, 'src/components/ide/AIDebugger.tsx'), 'utf8')))
      .not.toMatch(/Apply to File/);
  });
});
