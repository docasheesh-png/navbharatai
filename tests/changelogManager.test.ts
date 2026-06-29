import { describe, it, expect } from 'vitest';
import {
  diffFiles, renderChangelogEntry, prependChangelogEntry, generateChangelog, isEmptyDiff,
} from '../src/server/AppMakerLab/generator/ChangelogManager';

/**
 * P-PME.7 — changelog manager.
 */
describe('ChangelogManager — diffFiles', () => {
  it('classifies added / changed / removed (sorted)', () => {
    const prev = { 'a.ts': '1', 'b.ts': '2', 'old.ts': 'x' };
    const curr = { 'a.ts': '1', 'b.ts': 'CHANGED', 'new.ts': 'y' };
    expect(diffFiles(prev, curr)).toEqual({ added: ['new.ts'], changed: ['b.ts'], removed: ['old.ts'] });
  });
  it('handles empty inputs', () => {
    expect(diffFiles({}, {})).toEqual({ added: [], changed: [], removed: [] });
    expect(diffFiles(undefined as any, { 'x.ts': '1' })).toEqual({ added: ['x.ts'], changed: [], removed: [] });
  });
});

describe('ChangelogManager — renderChangelogEntry', () => {
  it('renders only non-empty sections in Keep-a-Changelog order', () => {
    const entry = renderChangelogEntry('1.2.0', '2026-06-29', { added: ['a.ts'], changed: [], removed: ['z.ts'], fixed: ['bug'] });
    expect(entry).toContain('## [1.2.0] - 2026-06-29');
    expect(entry).toContain('### Added');
    expect(entry).toContain('- a.ts');
    expect(entry).toContain('### Fixed');
    expect(entry).toContain('### Removed');
    expect(entry).not.toContain('### Changed'); // empty section omitted
    // order: Added before Fixed before Removed
    expect(entry.indexOf('### Added')).toBeLessThan(entry.indexOf('### Fixed'));
    expect(entry.indexOf('### Fixed')).toBeLessThan(entry.indexOf('### Removed'));
  });
  it('defaults version to Unreleased', () => {
    expect(renderChangelogEntry('', '2026-06-29', { added: ['x'], changed: [], removed: [] })).toContain('## [Unreleased]');
  });
});

describe('ChangelogManager — prependChangelogEntry', () => {
  it('creates a new changelog with a header when none exists', () => {
    const out = prependChangelogEntry(undefined, '## [1.0.0] - 2026-06-29\n### Added\n- x');
    expect(out).toContain('# Changelog');
    expect(out).toContain('## [1.0.0]');
  });
  it('inserts a new entry above the most recent prior entry', () => {
    const existing = '# Changelog\n\nintro\n\n## [1.0.0] - 2026-01-01\n### Added\n- first\n';
    const out = prependChangelogEntry(existing, '## [1.1.0] - 2026-06-29\n### Added\n- second');
    expect(out.indexOf('## [1.1.0]')).toBeLessThan(out.indexOf('## [1.0.0]')); // newest first
    expect(out).toContain('# Changelog');
    expect(out).toContain('- first'); // old entry preserved
  });
});

describe('ChangelogManager — generateChangelog', () => {
  it('produces an entry + updated changelog for real changes', () => {
    const r = generateChangelog({ 'a.ts': '1' }, { 'a.ts': '2', 'b.ts': 'new' }, { version: '1.1.0', date: '2026-06-29' });
    expect(r.empty).toBe(false);
    expect(r.diff).toEqual({ added: ['b.ts'], changed: ['a.ts'], removed: [] });
    expect(r.changelog).toContain('## [1.1.0] - 2026-06-29');
    expect(r.changelog).toContain('- b.ts');
  });
  it('returns empty + unchanged changelog when nothing changed', () => {
    const existing = '# Changelog\n\n## [1.0.0] - 2026-01-01\n### Added\n- x\n';
    const r = generateChangelog({ 'a.ts': '1' }, { 'a.ts': '1' }, { existingChangelog: existing });
    expect(r.empty).toBe(true);
    expect(r.changelog).toBe(existing); // untouched
    expect(isEmptyDiff({ ...r.diff })).toBe(true);
  });
});
