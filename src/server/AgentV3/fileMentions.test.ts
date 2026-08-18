import { describe, it, expect } from 'vitest';
import { parseFileMentions, fileMentionsBlock, unresolvedMentionsNotice, MAX_FILE_MENTIONS } from './fileMentions';

const FILES = ['src/App.tsx', 'src/Header.tsx', 'src/styles.css', 'package.json', 'apps/web/src/main.ts', 'a/index.ts', 'b/index.ts'];

describe('parseFileMentions', () => {
  it('resolves a full path', () => {
    expect(parseFileMentions('@src/App.tsx make the header sticky', FILES).resolved).toEqual(['src/App.tsx']);
  });

  it('resolves a root file and a deep path', () => {
    expect(parseFileMentions('check @package.json and @apps/web/src/main.ts', FILES).resolved)
      .toEqual(['package.json', 'apps/web/src/main.ts']);
  });

  it('resolves a bare filename when it is unambiguous', () => {
    expect(parseFileMentions('fix @Header.tsx', FILES).resolved).toEqual(['src/Header.tsx']);
  });

  // Picking one of three index.ts files silently is worse than saying we could not tell.
  it('refuses an AMBIGUOUS basename rather than guessing which one', () => {
    const m = parseFileMentions('update @index.ts', FILES);
    expect(m.resolved).toEqual([]);
    expect(m.unresolved).toEqual(['index.ts']);
  });

  it('is case-insensitive about what the user typed', () => {
    expect(parseFileMentions('@SRC/app.TSX please', FILES).resolved).toEqual(['src/App.tsx']);
  });

  it('tolerates a ./ prefix', () => {
    expect(parseFileMentions('@./src/App.tsx', FILES).resolved).toEqual(['src/App.tsx']);
  });

  // Silently dropping a mention is indistinguishable from the AI ignoring the request.
  it('REPORTS a file it could not find instead of dropping it', () => {
    const m = parseFileMentions('@src/Nope.tsx fix it', FILES);
    expect(m.resolved).toEqual([]);
    expect(m.unresolved).toEqual(['src/Nope.tsx']);
  });

  it('handles a mix of found and not-found in one message', () => {
    const m = parseFileMentions('@src/App.tsx and @ghost.ts', FILES);
    expect(m.resolved).toEqual(['src/App.tsx']);
    expect(m.unresolved).toEqual(['ghost.ts']);
  });

  // An email in the message and a decorator in pasted code must not become file mentions.
  it('ignores an email address and a mid-word @', () => {
    expect(parseFileMentions('mail me@example.com about it', FILES).unresolved).toEqual([]);
    expect(parseFileMentions('write user@host', FILES).unresolved).toEqual([]);
  });

  it('does not swallow trailing punctuation into the path', () => {
    expect(parseFileMentions('open @src/App.tsx, then stop.', FILES).resolved).toEqual(['src/App.tsx']);
  });

  it('dedupes the same file mentioned twice', () => {
    expect(parseFileMentions('@src/App.tsx and again @src/App.tsx', FILES).resolved).toEqual(['src/App.tsx']);
  });

  it('keeps the order the user wrote them in', () => {
    expect(parseFileMentions('@package.json then @src/App.tsx', FILES).resolved).toEqual(['package.json', 'src/App.tsx']);
  });

  it(`caps at ${MAX_FILE_MENTIONS} — past that it is not scoping, it is the whole project`, () => {
    const many = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    const prompt = many.map((p) => `@${p}`).join(' ');
    expect(parseFileMentions(prompt, many).resolved).toHaveLength(MAX_FILE_MENTIONS);
  });

  it('returns nothing for a message with no mentions, and for junk input', () => {
    expect(parseFileMentions('just make it faster', FILES)).toEqual({ resolved: [], unresolved: [] });
    expect(parseFileMentions('', FILES)).toEqual({ resolved: [], unresolved: [] });
    expect(parseFileMentions(null, FILES)).toEqual({ resolved: [], unresolved: [] });
    expect(parseFileMentions('@src/App.tsx', null)).toEqual({ resolved: [], unresolved: ['src/App.tsx'] });
  });
});

describe('fileMentionsBlock', () => {
  it('is empty when nothing resolved, so the caller can prepend unconditionally', () => {
    expect(fileMentionsBlock({ resolved: [], unresolved: ['x'] })).toBe('');
    expect(fileMentionsBlock(null)).toBe('');
  });

  it('lists the files and tells the builder to start there instead of searching', () => {
    const out = fileMentionsBlock({ resolved: ['src/App.tsx', 'src/styles.css'], unresolved: [] });
    expect(out).toContain('src/App.tsx');
    expect(out).toContain('src/styles.css');
    expect(out).toMatch(/instead of searching/i);
  });

  // A sticky header may genuinely need a CSS file the user did not name. A hard restriction would ship
  // a half-done change that looks like a bug.
  it('says START HERE, never "only touch these"', () => {
    const out = fileMentionsBlock({ resolved: ['src/App.tsx'], unresolved: [] });
    expect(out).toMatch(/not a restriction/i);
    expect(out).not.toMatch(/only (these|edit)/i);
  });
});

describe('unresolvedMentionsNotice', () => {
  it('is silent when everything resolved', () => {
    expect(unresolvedMentionsNotice({ resolved: ['src/App.tsx'], unresolved: [] })).toBe('');
    expect(unresolvedMentionsNotice(null)).toBe('');
  });

  it('names the missing file, and says the rest of the message was still used', () => {
    const out = unresolvedMentionsNotice({ resolved: [], unresolved: ['src/Nope.tsx'] });
    expect(out).toContain('@src/Nope.tsx');
    expect(out).toMatch(/rest of your message/i);
  });

  it('handles several missing files in one line', () => {
    const out = unresolvedMentionsNotice({ resolved: [], unresolved: ['a.ts', 'b.ts'] });
    expect(out).toContain('@a.ts');
    expect(out).toContain('@b.ts');
  });
});
