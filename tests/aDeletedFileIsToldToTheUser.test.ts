// Queue Q-019 (autopsy 4d538ca3, 2026-10-01): a file the build removed from the user's app is named in the
// summary they read — `FILE_DELETED` used to be admin-only and the summary said nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  userVisibleDeletions,
  deletedFilesNotice,
  MAX_NAMED_DELETIONS,
} from '../src/server/AgentV3/deletedFilesNotice';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');

describe('which deleted files the user is told about', () => {
  const before = ['src/App.tsx', 'src/old/Legacy.tsx', 'src/utils.js', '.nbai-landing.tar.gz'];

  it('names a file the app had before this build', () => {
    expect(userVisibleDeletions(['src/old/Legacy.tsx'], before, true)).toEqual(['src/old/Legacy.tsx']);
  });

  it('does not name a file this build created and then removed', () => {
    expect(userVisibleDeletions(['src/tmp/Scratch.tsx'], before, true)).toEqual([]);
  });

  it('says nothing on a fresh app (the project before was our starter)', () => {
    expect(userVisibleDeletions(['src/old/Legacy.tsx'], before, false)).toEqual([]);
  });

  it('never names our own housekeeping files', () => {
    expect(userVisibleDeletions(['.nbai-landing.tar.gz'], before, true)).toEqual([]);
  });

  it('an unreadable project list names every deletion (silence is the class being fixed)', () => {
    expect(userVisibleDeletions(['src/a.ts', 'src/b.ts'], null, true)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('normalises ./ prefixes and de-duplicates, keeping first-deleted order', () => {
    expect(userVisibleDeletions(['./src/utils.js', 'src/old/Legacy.tsx', 'src/utils.js'], before, true))
      .toEqual(['src/utils.js', 'src/old/Legacy.tsx']);
  });
});

describe('the sentence', () => {
  it('is empty when there is nothing to name', () => {
    expect(deletedFilesNotice([])).toBe('');
  });

  it('names one file in the singular and points at the real history path', () => {
    const line = deletedFilesNotice(['src/old/Legacy.tsx']);
    expect(line).toContain('removed this file from your project: `src/old/Legacy.tsx`');
    expect(line).toContain('still has it is in Files → History');
    expect(line.startsWith('\n\n')).toBe(true);
  });

  it('uses the plural and counts what it does not name', () => {
    const many = Array.from({ length: MAX_NAMED_DELETIONS + 3 }, (_, i) => `src/f${i}.ts`);
    const line = deletedFilesNotice(many);
    expect(line).toContain('these files');
    expect(line).toContain('still has them');
    expect(line).toContain(`and 3 more`);
    expect(line).not.toContain(`src/f${MAX_NAMED_DELETIONS}.ts`);
  });

  it('names no AI vendor (white-label law)', () => {
    expect(deletedFilesNotice(['a.ts'])).not.toMatch(/glm|kimi|claude|gemini|grok|openai|anthropic/i);
  });
});

describe('the route tells the user', () => {
  it('the deletion sink records every confirmed deletion', () => {
    expect(route).toMatch(/setFileDeletionSink\(\(paths\) => \{\s*for \(const p of paths\) \{\s*writtenFiles\.delete\(p\);\s*deletedThisBuild\.push\(p\);/);
  });

  it('a removed shadow twin is recorded too (the sibling deletion road)', () => {
    expect(route).toMatch(/removeWorkspaceFiles\(workspaceId, twins\)[^\n]*\n\s*deletedThisBuild\.push\(\.\.\.twins\);/);
  });

  it('names only files still absent at the end, and appends before the closing line is computed', () => {
    const at = route.indexOf('userVisibleDeletions(deletedThisBuild, projectFilePaths, userAppExists)');
    const closing = route.indexOf('summaryAdditions(result.summary, narratedTexts)');
    expect(at).toBeGreaterThan(0);
    expect(closing).toBeGreaterThan(at);
    const block = route.slice(at, at + 1600);
    expect(block).toContain('!writtenFiles.has(p)');
    expect(block).toContain('if (present === false) stillGone.push(p)');
    expect(block).toContain('deletedFilesNotice(stillGone)');
  });

  it('the report code is our own process fact, never a finding against the app', () => {
    for (const [file, name] of [['src/server/AgentV3/BuildDiagnostics.ts', 'PROCESS_ONLY_CODES'], ['src/server/AgentV3/buildFindingSuggestions.ts', 'NEVER_SUGGEST']]) {
      const src = readFileSync(join(__dirname, '..', file), 'utf8');
      const start = src.indexOf(`${name} = new Set([`);
      expect(start, name).toBeGreaterThan(0);
      expect(src.slice(start, src.indexOf(']);', start)), name).toContain("'FILES_REMOVED_TOLD'");
    }
  });
});
