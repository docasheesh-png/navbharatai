import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  advancedPublishStartsOpen, ADVANCED_PUBLISH_LABEL, ADVANCED_PUBLISH_HINT,
} from '../src/lib/advancedPublish';

const CHOOSER = join(process.cwd(), 'src/components/agentv3/HostingChooser.tsx');

/** The file with its comments removed, so an assertion cannot be satisfied by prose about the code. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

describe('advancedPublishStartsOpen — one Publish button, without hiding a path somebody uses', () => {
  it('collapses for a brand-new user, which is the whole point', () => {
    expect(advancedPublishStartsOpen({ connectedProviders: 0, hasOwnRepo: false })).toBe(false);
  });

  it('opens for a user who has connected their own provider', () => {
    expect(advancedPublishStartsOpen({ connectedProviders: 1, hasOwnRepo: false })).toBe(true);
    expect(advancedPublishStartsOpen({ connectedProviders: 4, hasOwnRepo: false })).toBe(true);
  });

  it('opens for a user whose app already lives in their own GitHub repo', () => {
    expect(advancedPublishStartsOpen({ connectedProviders: 0, hasOwnRepo: true })).toBe(true);
  });

  // A count that is not a number must not be read as "lots" — the only honest reading of an unusable
  // value is that we do not know the user is on this path, and the own-repo signal still decides.
  it('treats an unreadable provider count as no providers', () => {
    expect(advancedPublishStartsOpen({ connectedProviders: NaN, hasOwnRepo: false })).toBe(false);
    expect(advancedPublishStartsOpen({ connectedProviders: -1, hasOwnRepo: false })).toBe(false);
    expect(advancedPublishStartsOpen({ connectedProviders: NaN, hasOwnRepo: true })).toBe(true);
  });

  it('survives a missing input rather than throwing inside a render', () => {
    expect(advancedPublishStartsOpen(undefined as never)).toBe(false);
  });
});

describe('the label a user actually reads', () => {
  // "Advanced" alone tells somebody nothing about whether the thing they want is behind it, and the
  // people who need this section least think of themselves as advanced.
  it('names what is inside instead of only signalling difficulty', () => {
    expect(ADVANCED_PUBLISH_LABEL.toLowerCase()).not.toBe('advanced');
    expect(ADVANCED_PUBLISH_LABEL).toMatch(/somewhere else/i);
    expect(ADVANCED_PUBLISH_HINT).toMatch(/Vercel|Netlify|Cloudflare|GitHub Pages/);
  });

  // White-Label Law §2 covers AI vendors, not hosting companies the user themselves chose — but the
  // copy must stay professional English with no other language mixed in (CLAUDE.md, admin 2026-09-13).
  it('is professional English with no Devanagari', () => {
    expect(/[ऀ-ॿ]/.test(ADVANCED_PUBLISH_LABEL + ADVANCED_PUBLISH_HINT)).toBe(false);
  });
});

describe('the chooser really uses the rule — a default frozen at mount would defeat it', () => {
  const code = codeOf(CHOOSER);

  it('computes the open state from the rule, not from a bare useState(false)', () => {
    expect(code).toContain('advancedPublishStartsOpen({');
    expect(code).toMatch(/connectedProviders:\s*byo\.length/);
    expect(code).toMatch(/hasOwnRepo:\s*!!ownRepo/);
  });

  // `null` means "the user has not pressed it", so the rule is re-read as providers and the repo
  // arrive after mount. A boolean initial value would collapse the section on exactly the users the
  // rule exists to protect, and nothing would fail.
  it('keeps the user press separate from the default', () => {
    expect(code).toContain('useState<boolean | null>(null)');
    expect(code).toMatch(/advancedToggled\s*\?\?\s*advancedPublishStartsOpen/);
  });

  it('gates both bring-your-own sub-choices behind the disclosure', () => {
    const open = code.indexOf('{advancedOpen && (<>');
    expect(open).toBeGreaterThan(0);
    const close = code.indexOf('</>)}', open);
    expect(close).toBeGreaterThan(open);
    const inside = code.slice(open, close);
    expect(inside).toContain('Publish to {p.name}');       // deploy to the user's own provider
    expect(inside).toContain("setView('selfhost')");        // I host it myself, through their repo
  });

  it('still offers NavBharatAI hosting outside the disclosure', () => {
    const open = code.indexOf('{advancedOpen && (<>');
    expect(code.slice(0, open)).toContain('Host on NavBharatAI');
  });
});
