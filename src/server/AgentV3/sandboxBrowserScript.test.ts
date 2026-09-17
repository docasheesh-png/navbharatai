// The run line every in-sandbox browser script of ours goes through.
//
// These exist because the two hand-written copies this replaced differed in the one way that mattered:
// the journey runner had no PLAYWRIGHT_BROWSERS_PATH, so it never launched a browser, and the same
// line's `grep … || true` made that impossible to notice. Both halves are asserted here.

import { describe, it, expect } from 'vitest';
import {
  browserScriptRunLine, parseScriptDiagnostic, browserScriptFailureNote, SCRIPT_DIAG_MARKER,
} from './sandboxBrowserScript';

const RUN = { toolsDir: '/home/user/.e-tools', scriptPath: '/tmp/nbai-x.mjs', marker: 'NBAI_X:' };

describe('browserScriptRunLine', () => {
  it('points Playwright at the browsers the sandbox actually installed', () => {
    // THE BUG. Chromium exists only under TOOLS_DIR/.browsers — the image build and _kickoffPlaywright
    // both install it with this variable set, and it is never a persistent ENV. Without it,
    // chromium.launch() throws before the first step of the first journey.
    expect(browserScriptRunLine(RUN)).toContain('PLAYWRIGHT_BROWSERS_PATH=/home/user/.e-tools/.browsers');
  });

  it('keeps the result lines on stdout, so existing parsers are untouched', () => {
    expect(browserScriptRunLine(RUN)).toContain("grep '^NBAI_X:' /tmp/nbai-x.mjs.log");
  });

  it('asks for the diagnostic ONLY when there is no result or the script failed', () => {
    const line = browserScriptRunLine(RUN);
    expect(line).toContain('if [ "$nbai_rc" != "0" ] || ! grep -q');
    expect(line).toContain(SCRIPT_DIAG_MARKER);
  });

  it('bounds the diagnostic in both directions — a crash loop must not become a report', () => {
    const line = browserScriptRunLine(RUN);
    expect(line).toMatch(/tail -n \d+/);
    expect(line).toMatch(/cut -c1-\d+/);
  });

  it('still exits 0 — a probe that found nothing is not a failed command', () => {
    expect(browserScriptRunLine(RUN).trimEnd().endsWith('; true')).toBe(true);
  });

  it('uses grep -q rather than an option after the operands (POSIX)', () => {
    // `grep '^M' file -q` works on GNU grep and is undefined elsewhere; the quiet form is spelled out.
    expect(browserScriptRunLine(RUN)).not.toMatch(/\.log -q/);
  });

  it('is a single line, because it is handed to the sandbox as one command', () => {
    expect(browserScriptRunLine(RUN)).not.toContain('\n');
  });
});

describe('parseScriptDiagnostic', () => {
  it('reads what the script really said', () => {
    const out = [
      'NBAI_X:the script exited with status 1',
      "NBAI_X:Error: browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome",
    ].join('\n').replace(/NBAI_X:/g, SCRIPT_DIAG_MARKER);
    expect(parseScriptDiagnostic(out)).toContain('status 1');
    expect(parseScriptDiagnostic(out)).toContain("Executable doesn't exist");
  });

  it('is silent on a healthy run, so a good build carries no empty reason', () => {
    expect(parseScriptDiagnostic('NBAI_X:{"route":"/"}')).toBeNull();
    expect(parseScriptDiagnostic('')).toBeNull();
    expect(parseScriptDiagnostic(null)).toBeNull();
    expect(parseScriptDiagnostic(undefined)).toBeNull();
  });

  it('caps what it will carry into a report', () => {
    const huge = Array.from({ length: 50 }, (_, i) => `${SCRIPT_DIAG_MARKER}line ${i} ${'x'.repeat(80)}`).join('\n');
    expect(parseScriptDiagnostic(huge)!.length).toBeLessThanOrEqual(400);
  });
});

describe('browserScriptFailureNote', () => {
  it('names the most likely cause in plain words AND keeps the raw evidence', () => {
    const note = browserScriptFailureNote("Error: browserType.launch: Executable doesn't exist at /root/.cache/…");
    expect(note).toContain('sandbox browser could not be launched');
    expect(note).toContain("Executable doesn't exist");
  });

  it('does not guess when the cause is something else', () => {
    const note = browserScriptFailureNote('SyntaxError: Unexpected token }');
    expect(note).toContain('did not complete');
    expect(note).toContain('SyntaxError');
  });

  it('adds nothing at all when there is nothing to add', () => {
    expect(browserScriptFailureNote(null)).toBe('');
    expect(browserScriptFailureNote('')).toBe('');
  });
});
