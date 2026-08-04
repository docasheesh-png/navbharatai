import { describe, it, expect } from 'vitest';
import { textMarkerFilePaths, truncationRecoverySteer, truncationRecoveryNarration } from './TruncationRecovery';

// Connectly autopsy 2026-07-21: kimi hit its 8000-token ceiling mid `<<<FILE src/index.css>>>` — the file
// was emitted as TEXT, never became a write_file tool call, so the main loop never saved it. main.tsx
// imported the missing index.css and the site shipped unstyled. These helpers name the lost file so the
// next turn rewrites it.

describe('textMarkerFilePaths — files a truncated turn tried to write as <<<FILE>>> text', () => {
  it('extracts the exact Connectly case (a cut-off, unterminated index.css block)', () => {
    const text = '<<<FILE src/index.css>>>\n:root {\n  --background: #f8fafc;\n  --for'; // truncated, no ENDFILE
    expect(textMarkerFilePaths(text)).toEqual(['src/index.css']);
  });

  it('extracts multiple complete blocks', () => {
    const text = '<<<FILE a.tsx>>>\nx\n<<<ENDFILE>>>\n<<<FILE b.css>>>\ny\n<<<ENDFILE>>>';
    expect(textMarkerFilePaths(text)).toEqual(['a.tsx', 'b.css']);
  });

  it('is empty for text with no markers, and for empty/undefined input', () => {
    expect(textMarkerFilePaths('just some narration about the plan')).toEqual([]);
    expect(textMarkerFilePaths('')).toEqual([]);
    expect(textMarkerFilePaths(undefined)).toEqual([]);
  });

  it('drops unsafe paths (absolute / traversal) — same guard as parseFileBlocks', () => {
    const text = '<<<FILE /etc/passwd>>>\nx\n<<<ENDFILE>>>\n<<<FILE ../secret>>>\ny\n<<<ENDFILE>>>';
    expect(textMarkerFilePaths(text)).toEqual([]);
  });
});

describe('truncationRecoverySteer', () => {
  it('names a lost TEXT-marker file and tells the model to use write_file (the Connectly fix)', () => {
    const steer = truncationRecoverySteer({ textMarkerPaths: ['src/index.css'] });
    expect(steer).toContain('src/index.css');
    expect(steer).toMatch(/write_file/);
    expect(steer).toMatch(/NOT saved|missing/i);
    expect(steer).toMatch(/small enough/); // always steers toward smaller responses
  });

  it('names a broken JS file it wrote (the existing esbuild parse case)', () => {
    const steer = truncationRecoverySteer({ brokenJs: [{ path: 'src/App.tsx', message: 'Unexpected end of file', line: 42 }] });
    expect(steer).toContain('src/App.tsx:42');
    expect(steer).toMatch(/does NOT parse/);
  });

  it('lists BOTH sources, and a path in both is listed once (under broken)', () => {
    const steer = truncationRecoverySteer({
      brokenJs: [{ path: 'src/App.tsx', message: 'boom' }],
      textMarkerPaths: ['src/App.tsx', 'src/index.css'],
    })!;
    expect((steer.match(/src\/App\.tsx/g) || []).length).toBe(1); // de-duped
    expect(steer).toContain('src/index.css');
  });

  it('names a write_file TOOL call cut off mid-content (the salvaged-path / Unterminated-JSON case)', () => {
    const steer = truncationRecoverySteer({ truncatedToolPaths: ['src/App.tsx'] })!;
    expect(steer).toContain('src/App.tsx');
    expect(steer).toMatch(/cut off mid-content/);
  });

  it('does not repeat a truncated tool path already covered by a broken/text entry', () => {
    const steer = truncationRecoverySteer({
      brokenJs: [{ path: 'src/App.tsx', message: 'boom' }],
      truncatedToolPaths: ['src/App.tsx', 'src/Page.tsx'],
    })!;
    expect((steer.match(/src\/App\.tsx/g) || []).length).toBe(1); // de-duped across sources
    expect(steer).toContain('src/Page.tsx');
  });

  it('returns null when there is nothing to recover', () => {
    expect(truncationRecoverySteer({})).toBeNull();
    expect(truncationRecoverySteer({ brokenJs: [], textMarkerPaths: [], truncatedToolPaths: [] })).toBeNull();
  });
});

describe('truncationRecoveryNarration', () => {
  it('counts both broken and lost files', () => {
    expect(truncationRecoveryNarration(1, 2)).toContain('3 file(s)');
  });
});
