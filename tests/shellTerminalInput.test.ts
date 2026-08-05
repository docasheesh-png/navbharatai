import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * TYPING INTO A STARTING TERMINAL IS NEVER SWALLOWED (admin screenshot 2026-08-05: terminal on
 * "Starting your workspace…", iOS keyboard open, "type aur send hi nahi ho raha").
 *
 * Root cause was structural, not mobile: `sendInput` returned early while `shellIdRef` was null, so
 * every keystroke typed during the wake — which takes real seconds on a cold E2B resume — was silently
 * discarded. A PTY terminal has no local echo (echo comes back from the remote), so dropped input
 * shows NOTHING: to the user, an input black hole is indistinguishable from a broken keyboard.
 *
 * Three invariants, each of which was violated in the reported state:
 *  1. keys typed while connecting are QUEUED and flushed when the shell opens (like ssh);
 *  2. the open request has a DEADLINE, so a dead server cannot hold "Starting…" forever;
 *  3. a failed/unavailable terminal offers a way back (retry), not a dead end.
 */
const src = readFileSync(join(__dirname, '..', 'src/components/ide/ShellTerminal.tsx'), 'utf8');

/** Source minus comments — invariants must hold in code, not in prose about the code. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('ShellTerminal input during startup', () => {
  it('queues keystrokes typed before the shell exists instead of dropping them', () => {
    expect(code).toContain('pendingInputRef.current = (pendingInputRef.current + data)');
    // Queueing is gated on an open actually being in flight — once the open has FAILED, holding
    // keys would be a lie about a shell that is not coming.
    expect(code).toMatch(/if \(connectingRef\.current && workspaceId\)/);
  });

  it('bounds the queue so a stuck open cannot hoard memory', () => {
    expect(code).toContain('PENDING_INPUT_CAP');
    expect(code).toMatch(/\.slice\(0, PENDING_INPUT_CAP\)/);
  });

  it('tells the user their held typing is saved — otherwise it still looks like a dead keyboard', () => {
    expect(code).toContain('your typing is saved');
  });

  it('flushes the held input to the PTY the moment the shell opens', () => {
    const openSuccess = code.slice(code.indexOf('shellIdRef.current = j.shellId'));
    expect(openSuccess).toContain('const held = pendingInputRef.current');
    expect(openSuccess).toContain('if (held) void sendInput(held)');
  });

  it('the open request has a deadline — "Starting…" can no longer be an eternal state', () => {
    expect(code).toContain('AbortSignal.timeout(90_000)');
    // And the timeout produces its own honest message, not a generic network line.
    expect(code).toContain('took too long to wake');
  });

  it('a slow wake keeps talking, so slow is distinguishable from dead', () => {
    expect(code).toContain('Still waking the sandbox');
  });

  it('an unavailable terminal offers a retry, not a dead end', () => {
    expect(code).toMatch(/status\.kind === 'exited' \|\| status\.kind === 'unavailable'/);
    expect(code).toContain("'Try again'");
  });

  it('every open outcome clears the connecting flag — held keys can never leak into a later session', () => {
    // The finally is what guarantees this on success, dormant, HTTP-error and thrown paths alike.
    expect(code).toMatch(/} finally \{\s*clearTimeout\(slowNote\);\s*connectingRef\.current = false;\s*pendingInputRef\.current = '';/);
  });

  it('restart resets the queue state before reconnecting', () => {
    const restart = code.slice(code.indexOf('const restart = ()'));
    expect(restart).toContain("pendingInputRef.current = ''");
    expect(restart).toContain('queueHintShownRef.current = false');
  });
});

/**
 * TOUCH DEVICES GET A COMMAND BAR (admin 2026-08-05, second live report — typing still dead on an
 * iPhone WITH the keystroke queue deployed).
 *
 * The named root cause: xterm.js does not support mobile soft keyboards — its hidden-textarea input
 * path never produces onData on iOS, so the keyboard opens and nothing types, and no amount of
 * plumbing behind onData can fix a path that never fires. The command bar is an input channel we own
 * end-to-end: a real <input> whose submit goes straight to the PTY.
 */
describe('ShellTerminal mobile command bar', () => {
  it('exists, and only for coarse (touch) pointers — desktop xterm typing is untouched', () => {
    expect(code).toContain("matchMedia?.('(pointer: coarse)')");
    expect(code).toContain('showCommandBar');
  });

  it('submits through the SAME sendInput path, with the real TTY line ending', () => {
    expect(code).toContain("void sendInput(barText + '\\r')");
  });

  it('carries the keys a shell is unusable without: interrupt, completion, history', () => {
    expect(code).toContain("sendInput('\\x03')");     // Ctrl+C
    expect(code).toContain("sendInput('\\t')");       // Tab
    expect(code).toContain("sendInput('\\x1b[A')");   // history up
    expect(code).toContain("sendInput('\\x1b[B')");   // history down
  });

  it('disables the mobile-hostile keyboard behaviours a command input cannot survive', () => {
    // autoCapitalize/autoCorrect would turn `npm` into `Npm` and "correct" flags into words —
    // a command bar with autocorrect on is a bug generator, not a terminal.
    expect(code).toContain('autoCapitalize="none"');
    expect(code).toContain('autoCorrect="off"');
    expect(code).toContain('spellCheck={false}');
    expect(code).toContain('enterKeyHint="send"');
  });

  it('is never a dead control: input disabled with an honest placeholder when the shell is gone', () => {
    expect(code).toMatch(/disabled=\{status\.kind === 'exited' \|\| status\.kind === 'unavailable'\}/);
    expect(code).toContain('Terminal closed');
    expect(code).toContain('Terminal not available');
  });

  it('helper keys keep the input focused so the phone keyboard stays open between taps', () => {
    expect(code).toContain('onPointerDown={keepFocus}');
    expect(code).toMatch(/keepFocus = \(e: React\.PointerEvent\) => e\.preventDefault\(\)/);
  });

  it('on a touch device, tab-activation focuses the BAR, never xterm — whose keyboard cannot type', () => {
    expect(code).toMatch(/if \(showCommandBar\) barInputRef\.current\?\.focus\(\);\s*else termRef\.current\?\.focus\(\);/);
  });
});
