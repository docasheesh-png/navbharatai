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

  it('the open request has a SHORT deadline — the wake happens in the background, not in this request', () => {
    // Holding /shell/open through a cold sandbox create is what expired a 90s deadline on wakes that
    // were actually succeeding (admin 2026-08-06). The open only starts/checks the wake now.
    expect(code).toContain('AbortSignal.timeout(25_000)');
    expect(code).not.toContain('AbortSignal.timeout(90_000)');
  });

  it('a slow wake keeps talking, so slow is distinguishable from dead', () => {
    expect(code).toContain('Still waking the sandbox');
  });

  it('an unavailable terminal offers a retry, not a dead end', () => {
    expect(code).toMatch(/status\.kind === 'exited' \|\| status\.kind === 'unavailable'/);
    expect(code).toContain("'Try again'");
  });

  it('every open outcome clears the connecting flag — EXCEPT the hand-off to the wake poll', () => {
    // The finally guarantees cleanup on success, dormant, HTTP-error and thrown paths alike; the
    // waking hand-off is the one deliberate exception, because the held keys must survive into the
    // poll (that queue is the whole point of typing during a wake).
    expect(code).toMatch(/} finally \{\s*clearTimeout\(slowNote\);\s*if \(!enteredWakePoll\) \{/);
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

/**
 * DIRECT TYPING INSIDE THE TERMINAL BOX (admin 2026-08-05, third report: the bar works — "par mujhe
 * terminal box me hi type karna hai").
 *
 * The bar working proved iOS delivers input events to a real <input>; only xterm's keydown-driven
 * hidden textarea starves. So the box carries an invisible bridge input of ours: tap the box, type,
 * and every keystroke goes to the PTY that instant — echo paints back into xterm, so typing happens
 * visibly "in the terminal", like ssh.
 */
describe('ShellTerminal in-box typing bridge', () => {
  it('tapping the terminal box focuses OUR bridge, and only on touch devices', () => {
    expect(code).toContain('onClick={focusBridge}');
    const fb = code.slice(code.indexOf('const focusBridge'));
    expect(fb).toContain('if (!showCommandBar) return;');
  });

  it('keeps a sentinel so Backspace is observable — an empty input fires no event for it on iOS', () => {
    expect(code).toContain("BRIDGE_SENTINEL = '\\u200B'");
    // the sentinel's deletion IS the backspace, forwarded as the DEL byte a TTY expects
    expect(code).toContain("void sendInput('\\x7f')");
  });

  it('never forwards mid-composition — IME keyboards (Hindi) send composed text on compositionend', () => {
    expect(code).toContain('onCompositionStart');
    expect(code).toContain('onCompositionEnd');
    const sync = code.slice(code.indexOf('const bridgeSync'));
    expect(sync).toContain('composingRef.current) return');
  });

  it('control keys ride keydown: Enter, Tab, arrows, Escape, and hardware Ctrl chords', () => {
    const kd = code.slice(code.indexOf('const bridgeKeyDown'));
    expect(kd).toContain("'\\r'");
    expect(kd).toContain("'\\x1b[A'");
    expect(kd).toContain("'\\x1b[D'");
    expect(kd).toContain('charCodeAt(0) - 64');            // Ctrl+letter → real control byte
    // Backspace must NOT be double-handled (once via keydown + once via the sentinel = two deletes).
    expect(kd).not.toContain("'Backspace'");
  });

  it('the bridge never swallows the tap itself and never disturbs layout', () => {
    const el = code.slice(code.indexOf('ref={bridgeRef}'), code.indexOf('ref={bridgeRef}') + 900);
    expect(el).toContain('pointer-events-none');
    expect(el).toContain('opacity-0');
    expect(el).toContain('autoCapitalize="none"');
    expect(el).toContain('autoCorrect="off"');
  });

  it('a dead shell disarms the bridge — no keyboard against a terminal that cannot answer', () => {
    const fb = code.slice(code.indexOf('const focusBridge'));
    expect(fb).toMatch(/status\.kind === 'exited' \|\| status\.kind === 'unavailable'\) return/);
  });
});

/**
 * THE ORDERED INPUT PIPELINE (admin 2026-08-05: "terminal bahut slow hai — rocksolid banao").
 *
 * One POST per keystroke had a correctness hole, not just a speed one: two requests in flight can
 * arrive out of order, so fast-typed "ls" could reach the PTY as "sl". A single-flight coalescing
 * buffer fixes ordering BY CONSTRUCTION and collapses a typing burst into one or two requests.
 */
describe('ShellTerminal input pipeline', () => {
  it('exactly one batch in flight at a time — the ordering guarantee', () => {
    const pump = code.slice(code.indexOf('async function pumpInput'));
    expect(pump).toContain('if (pumpingRef.current) return;');
    expect(pump.slice(0, 700)).toContain('pumpingRef.current = true;');
    expect(pump).toContain('finally { pumpingRef.current = false; }');
  });

  it('keys arriving mid-flight coalesce into the NEXT batch instead of racing it', () => {
    const send = code.slice(code.indexOf('function sendInput'));
    expect(send).toContain('outBufRef.current = (outBufRef.current + data)');
    expect(send).toContain('void pumpInput()');
  });

  it('the buffer is capped at the PTY input limit', () => {
    expect(code).toContain('OUT_BUF_CAP = 8192');
    expect(code).toMatch(/\.slice\(0, OUT_BUF_CAP\)/);
  });

  it('a failed batch retries once, then tells the user — a keystroke must never vanish silently', () => {
    const pump = code.slice(code.indexOf('async function pumpInput'));
    expect(pump).toContain('await postInputBatch(batch)) && !(await postInputBatch(batch))');
    expect(pump).toContain('input did not reach the terminal');
  });

  it('resize is debounced and deduplicated — a drag or rotation is one settled POST, not dozens', () => {
    const rs = code.slice(code.indexOf('function sendResize'));
    expect(rs).toContain('clearTimeout(resizeTimerRef.current)');
    expect(rs).toContain('if (key === lastSizeRef.current) return;');
    expect(rs).toContain('200');
  });

  it('restart clears the pipeline so a stale batch cannot leak into the new shell', () => {
    const restart = code.slice(code.indexOf('const restart = ()'));
    expect(restart).toContain("outBufRef.current = ''");
    expect(restart).toContain("lastSizeRef.current = ''");
  });
});

/**
 * THE WAKE POLL (admin 2026-08-06). The client no longer holds one request open through a cold
 * sandbox start — it watches the background wake's progress and only calls DEAD what has actually
 * stopped moving. The same judgement the preview watchdog uses.
 */
describe('ShellTerminal wake poll', () => {
  it('a waking workspace hands off to the progress poll and KEEPS the typed-key queue alive', () => {
    expect(code).toMatch(/j\.reason === 'waking'/);
    expect(code).toContain('enteredWakePoll = true');
    const fin = code.slice(code.indexOf('if (!enteredWakePoll)'));
    expect(fin.slice(0, 200)).toContain("pendingInputRef.current = ''");
  });

  it('judges progress, not the clock: stall guard + far-out ceiling, never a flat deadline', () => {
    const poll = code.slice(code.indexOf('async function pollWake'));
    expect(poll).toContain('NO_PROGRESS_MS');
    expect(poll).toContain('HARD_CEILING_MS');
    expect(poll).toContain('lastProgressAt');
  });

  it('paints ONE in-place line: percent + live timer, not a scroll of prose', () => {
    // admin 2026-08-06: "loading files hata do — % banao, timer laga do". \r + erase updates the
    // same line; the timer advances every tick so alive-but-slow never looks frozen.
    const poll = code.slice(code.indexOf('async function pollWake'));
    expect(poll).toContain('\\r\\x1b[K');
    expect(poll).toContain('Loading workspace…');
    expect(poll).toMatch(/\$\{secs\}s/);
    expect(poll).not.toContain('Loading your saved files');
    expect(poll).not.toContain('Preparing git and tools');
  });

  it('100% is HONEST: it exists only for ready, and the shell follows in the same breath', () => {
    // "aur 100% loading bad, chalna chahiye, farzi na lage" — the percent function can only return
    // 100 for phase ready, and the only 100% write is immediately followed by the reopen.
    const pctFn = code.slice(code.indexOf('export function wakePercent'), code.indexOf('export function wakePercent') + 700);
    expect(pctFn).toMatch(/phase === 'ready'\) return 100/);
    expect(pctFn).toContain('Math.min(94');                    // seeding can NEVER show complete
    const poll = code.slice(code.indexOf('async function pollWake'));
    const at100 = poll.indexOf('100%');
    expect(at100).toBeGreaterThan(-1);
    expect(poll.slice(at100, at100 + 260)).toContain('start(term, fit, alive, attempt + 1)');
  });

  it('a failed wake surfaces its real (sanitized) reason and always offers Try again', () => {
    const poll = code.slice(code.indexOf('async function pollWake'));
    expect(poll).toContain('w.error');
    expect(poll).toContain('Try again');
  });

  it('ready → reopen is bounded — a ready/host race can never loop forever', () => {
    const poll = code.slice(code.indexOf('async function pollWake'));
    expect(poll).toContain('attempt >= 4');
    expect(poll).toContain('start(term, fit, alive, attempt + 1)');
  });

  it('one missed poll is not a verdict — a fetch error keeps polling and the no-progress guard judges', () => {
    const poll = code.slice(code.indexOf('async function pollWake'));
    // The poll fetch failure path swallows into null (loop continues)…
    expect(poll).toContain('j = await res.json().catch(() => null)');
    // …and each poll request is itself bounded so a hung request cannot stall the loop's clock.
    expect(poll).toContain('AbortSignal.timeout(10_000)');
  });
});
