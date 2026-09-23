import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The free chat's empty screen offers only what the free chat can do (admin 2026-09-23: "navbharatai
 * free me jab koi chat nahi hoti hai to yeh tiles dikhti hai … yeh function free me hai hi nahi").
 *
 * `AIChat` has one caller, the NavBharatAI FREE chat. Its empty state offered code-tool tiles about an
 * open file that does not exist there, and a "Start Security Scan" button that clicked an element no
 * screen renders. Comments are stripped so the note explaining the removal cannot satisfy or fail a
 * case by quoting the old strings.
 */

const ROOT = join(__dirname, '..');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

describe('the free chat empty state', () => {
  const src = code(readFileSync(join(ROOT, 'src/components/ide/AIChat.tsx'), 'utf8'));

  it('offers no code-tool tiles', () => {
    for (const tile of ['Explain this file', 'Find bugs', 'Improve performance', 'Security review', 'Write tests', 'Generate README', 'Try one of these']) {
      expect(src, tile).not.toContain(tile);
    }
  });

  it('has no Security Scan button that clicks nothing', () => {
    expect(src).not.toContain('Start Security Scan');
    expect(src).not.toContain('[title="Security Scan"]');
  });

  it('says what the screen is for', () => {
    expect(src).toContain('Ask me anything.');
    expect(src).not.toContain('Ready to architect and build.');
  });

  it('is still used only by the free chat (if that changes, this empty state must be re-decided)', () => {
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'server') walk(p); continue; }
        if (!p.endsWith('.tsx') || p.includes('.test.')) continue;
        if (/<AIChat\b/.test(code(readFileSync(p, 'utf8')))) callers.push(p.slice(ROOT.length + 1));
      }
    };
    walk(join(ROOT, 'src'));
    expect(callers).toEqual(['src/components/panels/NBIChatPanel.tsx']);
  });
});

describe('no button "clicks" another element found by its title', () => {
  it('a querySelector on a title is a button that silently does nothing when the title changes', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'server') walk(p); continue; }
        if (!/\.tsx?$/.test(p) || p.includes('.test.')) continue;
        if (/querySelector[^(]*\(\s*['"`]\[title=/.test(code(readFileSync(p, 'utf8')))) offenders.push(p.slice(ROOT.length + 1));
      }
    };
    walk(join(ROOT, 'src'));
    expect(offenders).toEqual([]);
  });
});
