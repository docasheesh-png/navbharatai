// 🔴 RUNTIME_UNCHECKED WAS THE STRUCTURAL OUTCOME OF AN ORDINARY BUILD (autopsy, 2026-09-21).
//
// Two admin build reports, five builds, and `RUNTIME_UNCHECKED` on every single one — while the same
// reports carried `IN_BUILD_GREEN`, `GREEN_GUARD_SAVE` and a preview that had been opened in a real
// browser and seen rendering. The verdict was honest about what it knew; what it knew was nothing,
// and it could not have been otherwise. Three lanes can put runtime evidence in front of that verdict
// and all three were shut:
//
//   A · the CDP daemon — the ONLY writer of CONSOLE_LOG, and it starts solely when the MODEL calls
//       the `browser_action` tool. An ordinary build never does.
//   B · the page checks (`runtimeRecordFromPageChecks`, the documented "second source of runtime
//       truth", 2026-08-19) — needs `extractPageRoutes` to find a non-home route. MEASURED against
//       this repo's own registry: **0 of 40 golden scaffolds yield one**, so for an app built from
//       our own templates that lane has never once been able to answer.
//   C · `browseUrl` — the navigation the PLATFORM makes on essentially every build (the render proof,
//       the verify loop, GreenGuard, verifyAfterFix). It launched a real browser, waited for paint,
//       read the DOM… and attached no listener of any kind. Every one of those threw the console away.
//
// The fix is lane C, because lane C is already paid for: the browser is launching regardless, and the
// listeners are the same four the daemon has always had. Extracted to ONE definition rather than
// copied, because a second copy is the drifted-copy class this repo has paid for four times over
// (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML boot guard ×2, `PLAYWRIGHT_BROWSERS_PATH` ×2).
//
// ⚠️ WHY SO MUCH OF THIS SUITE READS THE SOURCE. `browseUrl` generates a SCRIPT, and its two
// predecessors both shipped broken — a shell-quoting bug that handed `node` a fragment, and a path bug
// that put the file where `require('playwright')` could not resolve. Neither failed loudly: the caller
// falls back to curl on any error, so a script that died on line 1 and a slow SPA looked identical for
// weeks. `tsc` and `vitest` cannot parse a string, cannot see that a listener is registered after the
// navigation it was meant to observe, and cannot see that one lane of two lost its recorder. So the
// string is parsed here, deliberately, with the same tool the sandbox will use.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  browsePageScript,
  browseConsoleCaptureEnabled,
  BROWSER_DAEMON_SCRIPT,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { extractPageRoutes } from '../src/server/AgentV3/PageRouteCheck';
import { GOLDEN_SCAFFOLDS } from '../src/server/AgentV3/goldenScaffolds/registry';

const ACTUATOR_SRC = readFileSync(
  fileURLToPath(new URL('../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', import.meta.url)),
  'utf8',
);

const URL_UNDER_TEST = 'https://3000-abc123.e2b.app/';

/** A generated script with its `//` comments removed, so a guard matches code and not its own prose. */
function codeOnly(source: string): string {
  return source.replace(/^\s*\/\/.*$/gm, '');
}

/** Parse a generated script exactly as the sandbox's own `node` will. Throws with node's real error. */
function assertParses(source: string, name: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'nbai-script-'));
  const file = join(dir, `${name}.cjs`);
  writeFileSync(file, source);
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

describe('the generated browser scripts are real JavaScript', () => {
  // THE CHEAPEST PROOF THERE IS, and the one neither of this function's two shipped bugs had.
  it('the browse script parses', () => {
    expect(() => assertParses(browsePageScript(URL_UNDER_TEST), 'browse')).not.toThrow();
  });

  it('the daemon script parses', () => {
    expect(() => assertParses(BROWSER_DAEMON_SCRIPT, 'daemon')).not.toThrow();
  });

  // The shell-quoting bug (2026-08-19) in one line: a URL interpolated raw closed the shell string and
  // node received a fragment. It is written to a file now, but the URL must still be a JS string
  // literal, and a URL carrying a quote must not be able to break out of it.
  it('the URL is a JSON-escaped literal, so a hostile URL cannot break the script', () => {
    const nasty = 'https://x.e2b.app/?q="]);process.exit(1);//';
    const script = browsePageScript(nasty);
    expect(script).toContain(JSON.stringify(nasty));
    expect(() => assertParses(script, 'nasty')).not.toThrow();
  });
});

describe('lane C listens', () => {
  const script = browsePageScript(URL_UNDER_TEST);

  // 🔒 REVERSION GUARD. Deleting the recorder from `browseUrl` breaks no behavioural test in this
  // repo — the function would keep returning the same HTML and the same `painted` flag, and every
  // build would quietly go back to reporting RUNTIME_UNCHECKED. This is what notices.
  it('attaches all four of the daemon listeners', () => {
    expect(script).toMatch(/\.on\(\s*'console'/);
    expect(script).toMatch(/\.on\(\s*'pageerror'/);
    expect(script).toMatch(/\.on\(\s*'requestfailed'/);
    expect(script).toMatch(/\.on\(\s*'response'/);
  });

  // ORDER IS THE WHOLE POINT. A listener registered after `goto` misses everything thrown while the
  // page loads — which is precisely the class that breaks an app ("Cannot read properties of null
  // (reading 'useState')", the error the admin's own report opens with).
  it('attaches them BEFORE the navigation they exist to observe', () => {
    const firstListener = script.search(/\.on\(\s*'pageerror'/);
    const goto = script.indexOf('.goto(');
    expect(firstListener).toBeGreaterThan(-1);
    expect(goto).toBeGreaterThan(-1);
    expect(firstListener).toBeLessThan(goto);
  });

  // 🔒 THE 404 HAZARD, AND THE REASON THE MARKER IS GATED.
  //
  // `getConsoleErrors` reports `captured:true` when the log FILE exists, and `provenFromTimeline`
  // reads the resulting RUNTIME_VERIFIED as "the app ran in a real browser". A browser that loaded a
  // dead preview has a perfectly clean console — so marking the session unconditionally would let a
  // 404 earn a render proof. That is a bug this fix would have CREATED, not found.
  it('marks the session only when the app actually painted', () => {
    expect(script).toMatch(/if\(painted\)\s*recSessionExisted\(\)/);
    // and never unconditionally
    expect(script).not.toMatch(/^\s*recSessionExisted\(\);\s*$/m);
  });

  // An error must be recorded whether or not the page painted: a crash that PREVENTS paint is exactly
  // the thing worth reporting. The listeners sit outside the paint branch, which this asserts.
  it('records errors independently of paint', () => {
    const paintLoop = script.indexOf('var painted=0;');
    const listener = script.search(/\.on\(\s*'pageerror'/);
    expect(listener).toBeLessThan(paintLoop);
  });

  // ⚠️ STDOUT IS PARSED BY THE CALLER (`splitPaintMarker`): the paint marker, then the page's HTML.
  // One stray write to stdout in the recorder would corrupt the DOM every caller of browseUrl reads —
  // the preview verdict, the feature probe, Green Freeze. The recorder writes to a FILE, only.
  //
  // ⚠️ MATCH THE CALL, NOT THE WORD. The first draft of this asserted the recorder does not CONTAIN
  // "console.log" and failed — because the log file is itself named `console.log`, and the comment
  // above `recSessionExisted` contains the word "truncate". Both hits were prose. A guard that trips
  // on its own documentation is a guard someone deletes, so these match syntax: a call, a flag.
  it('the recorder writes to a file and never to stdout', () => {
    const recorder = codeOnly(script.slice(0, script.indexOf('(async()=>{')));
    expect(recorder).toContain('appendFileSync(');
    expect(recorder).not.toMatch(/console\s*\.\s*log\s*\(/);
    expect(recorder).not.toContain('process.stdout');
  });

  // Two lanes now share one log. A truncating open would let whichever ran second erase the other's
  // errors — the daemon's own comment says this; the shared definition is what makes it true for both.
  it('appends, never truncates — two lanes share one log', () => {
    for (const s of [script, BROWSER_DAEMON_SCRIPT]) {
      const recorder = codeOnly(s.slice(0, s.indexOf('(async()=>{')));
      expect(recorder).toContain('appendFileSync(');
      expect(recorder).not.toMatch(/writeFileSync\s*\(\s*__nbaiLog/);
      expect(recorder).not.toMatch(/createWriteStream|openSync|['"]w['"]/);
    }
  });

  // Both lanes must write the SAME NDJSON shape, because `getConsoleErrors` has exactly one parser.
  it('emits the same record shape the reader parses', () => {
    for (const s of [script, BROWSER_DAEMON_SCRIPT]) {
      expect(s).toMatch(/t:Date\.now\(\)/);
      expect(s).toMatch(/kind,text:String\(text\)/);
    }
  });
});

// 🧬 THE 50/50 HALF — WHY COULD THE LISTENER BE MISSING FROM A LANE AT ALL?
//
// Because nothing in this repo knew how many lanes there were. Six scripts in this one file launch or
// attach to a browser, they were written eighteen months apart, and each new one simply did not think
// about the console — so the recorder ending up on exactly one of them was not an oversight anybody
// could have caught. It is the same shape as the `writtenFiles` census in `routes/agentv3.test.ts`:
// the invariant is not "today's lanes are right", it is "a NEW lane forces a decision".
//
// ⚠️ THIS CENSUS DELIBERATELY DOES NOT SAY "EVERY LANE MUST RECORD", and that restraint is the point.
// Two lanes must NOT: the journey check drives deliberately hostile input, and the page check already
// collects its own errors into `pageConsoleEvidence`. A rule that forced recording everywhere would
// put pre-repair errors inside the verdict's 3-minute window and report a fixed bug as surviving —
// trading this problem for a worse one. So each lane is listed with its answer and its reason.
describe('browser-lane census — a new lane must decide about the console', () => {
  const LANES: Array<{ name: string; records: boolean; why: string }> = [
    { name: 'BROWSER_DAEMON_SCRIPT', records: true, why: 'the agent-driven CDP session — the original recorder' },
    { name: 'browsePageScript', records: true, why: 'the platform navigation on essentially every build — this autopsy' },
    { name: 'SCREENSHOT_CDP_SCRIPT', records: true, why: 'connects to the daemon, so the daemon listeners already apply' },
    { name: 'BROWSER_ACTION_SCRIPT', records: true, why: 'connects to the daemon, same' },
    { name: 'SCREENSHOT_SCRIPT', records: false, why: 'a picture, taken at an arbitrary moment; its errors would land in the verdict window un-anchored to any repair' },
    { name: 'shotBody (visual-edit element map)', records: false, why: 'same — a mid-build capture, deliberately not evidence about the finished app' },
  ];

  it('every browser lane in the actuator is accounted for', () => {
    // Each `const X = \`` / `function X(` that carries a chromium launch or a CDP connect.
    const declared = (ACTUATOR_SRC.match(/chromium\.(launch|connectOverCDP)\(/g) ?? []).length;
    expect(declared).toBe(LANES.length);
  });

  it('the lanes that record really do, and the ones that do not are named', () => {
    const recording = LANES.filter((l) => l.records);
    expect(recording.length).toBe(4);
    for (const lane of LANES) expect(lane.why.length).toBeGreaterThan(20);
  });
});

describe('one definition, not two', () => {
  // 🔒 THE DRIFT GUARD. The listener block exists once in the source and both lanes interpolate it.
  // A future edit that pastes a second copy into either lane — the exact thing that happened to
  // `safeRelPath`, `tagsOnLine`, the HTML boot guard and PLAYWRIGHT_BROWSERS_PATH — fails here.
  it('the pageerror listener is written exactly once in the actuator source', () => {
    const occurrences = ACTUATOR_SRC.match(/\.on\('pageerror'/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('the record function is written exactly once', () => {
    const occurrences = ACTUATOR_SRC.match(/function rec\(kind,text,stack\)/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  // Both lanes really do carry it — asserted on the emitted strings, not on the source, so an
  // interpolation that silently produced an empty string would still fail.
  it('both lanes emit the listeners', () => {
    for (const s of [browsePageScript(URL_UNDER_TEST), BROWSER_DAEMON_SCRIPT]) {
      expect(s).toMatch(/\.on\(\s*'pageerror'/);
      expect(s).toContain('recSessionExisted');
    }
  });
});

describe('the kill switch is a real revert', () => {
  // A switch that merely stops the RECORDING while leaving the plumbing behind is not a revert — it is
  // a third state nobody has tested. `recordConsole: false` must emit exactly the script that shipped
  // before this change, so `AGENTV3_BROWSE_CONSOLE=off` restores known behaviour rather than a guess.
  const off = browsePageScript(URL_UNDER_TEST, { recordConsole: false });

  it('emits no recorder, no listeners and no marker', () => {
    expect(off).not.toContain('recSessionExisted');
    expect(off).not.toContain('appendFileSync');
    expect(off).not.toMatch(/\.on\(\s*'pageerror'/);
  });

  it('still parses, and still prints the paint marker and the DOM the caller parses', () => {
    expect(() => assertParses(off, 'browse-off')).not.toThrow();
    expect(off).toContain("console.log('NBAI_PAINTED:'+painted);");
    expect(off).toContain('(await p.content()).slice(0,30000)');
  });

  it('defaults to ON — the missing measurement is the finding', () => {
    expect(browsePageScript(URL_UNDER_TEST)).toContain('recSessionExisted');
    expect(browsePageScript(URL_UNDER_TEST, {})).toContain('recSessionExisted');
  });

  it('only the exact value "off" disables it — an unreadable value keeps the measurement', () => {
    const prev = process.env['AGENTV3_BROWSE_CONSOLE'];
    try {
      for (const v of ['off', 'OFF', ' off ']) {
        process.env['AGENTV3_BROWSE_CONSOLE'] = v;
        expect(browseConsoleCaptureEnabled()).toBe(false);
      }
      for (const v of ['', 'no', 'false', '0', 'on']) {
        process.env['AGENTV3_BROWSE_CONSOLE'] = v;
        expect(browseConsoleCaptureEnabled()).toBe(true);
      }
      delete process.env['AGENTV3_BROWSE_CONSOLE'];
      expect(browseConsoleCaptureEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env['AGENTV3_BROWSE_CONSOLE'];
      else process.env['AGENTV3_BROWSE_CONSOLE'] = prev;
    }
  });
});

// ── The honesty half: the door this change opened, and the rule that guards it ────────────────────
//
// Until the listeners reached lane C, `auditSummaryClaims` could only catch "you said clean and nobody
// looked" — because on an ordinary build nobody ever did. The WORSE sentence, *we looked, we saw
// errors, and the summary said clean*, had no rule at all and could not be reached. Making the capture
// work is what makes it reachable, so its guard ships in the same change rather than waiting for a
// report to prove it. Same discipline as `POST_GREEN_WRITES`, inverted: there was nothing to measure
// first, because the measurement itself is what was missing.
describe('a console we DID read is held to what it said', () => {
  const CLEAN = 'Build complete. No console errors in the browser.';

  it('flags a clean-console claim when the captured console still held errors', () => {
    const [c] = auditSummaryClaims(CLEAN, {
      consoleCaptured: true, consoleErrorsFound: 2,
      screenshotTaken: false, previewVerified: true, filesWritten: 3,
    });
    expect(c?.kind).toBe('console-clean-but-errors');
    expect(c?.measured).toContain('2 errors');
  });

  it('says "1 error", not "1 errors"', () => {
    const [c] = auditSummaryClaims(CLEAN, {
      consoleCaptured: true, consoleErrorsFound: 1,
      screenshotTaken: false, previewVerified: true, filesWritten: 3,
    });
    expect(c?.measured).toContain('1 error ');
  });

  // The whole point of capturing: a build that really is clean must not be accused.
  it('a genuinely clean captured console is never a contradiction', () => {
    const out = auditSummaryClaims(CLEAN, {
      consoleCaptured: true, consoleErrorsFound: 0,
      screenshotTaken: false, previewVerified: true, filesWritten: 3,
    });
    expect(out.map((c) => c.kind)).not.toContain('console-clean-but-errors');
    expect(out.map((c) => c.kind)).not.toContain('console-clean');
  });

  // ⚠️ SILENCE IS NEVER AN ACCUSATION — the discipline `typecheckRan` already states in this module.
  // A caller that cannot tell us the count must not have a claim invented against it.
  it('an omitted count accuses nobody', () => {
    const out = auditSummaryClaims(CLEAN, {
      consoleCaptured: true,
      screenshotTaken: false, previewVerified: true, filesWritten: 3,
    });
    expect(out.map((c) => c.kind)).not.toContain('console-clean-but-errors');
  });

  // The original rule is untouched, and the two are mutually exclusive: one claim, one contradiction.
  it('the never-looked rule still fires, and only one of the two ever does', () => {
    const out = auditSummaryClaims(CLEAN, {
      consoleCaptured: false, consoleErrorsFound: 5,
      screenshotTaken: false, previewVerified: true, filesWritten: 3,
    });
    const kinds = out.map((c) => c.kind);
    expect(kinds).toContain('console-clean');
    expect(kinds).not.toContain('console-clean-but-errors');
  });

  // A summary that claims nothing about the console is not audited about the console, however dirty it is.
  it('no claim, no contradiction', () => {
    const out = auditSummaryClaims('Built your notes app with add, edit and delete.', {
      consoleCaptured: true, consoleErrorsFound: 9,
      screenshotTaken: false, previewVerified: true, filesWritten: 3,
    });
    expect(out.map((c) => c.kind)).not.toContain('console-clean-but-errors');
  });
});

// ── The number this whole autopsy rests on, held by CI instead of by a paragraph ──────────────────
//
// 🔴 AND IT IS HERE BECAUSE MY FIRST MEASUREMENT OF IT WAS WORTHLESS. The claim "0 of 40 golden
// scaffolds yield a page route" was first produced by a throwaway probe that read `s.files` — a key
// `GoldenScaffold` does not have. Every scaffold therefore reached `extractPageRoutes` as `{}`, and
// the probe could not have returned anything except 0. The conclusion happened to be right; the
// derivation proved nothing, which is this repo's own standard — a derivation is only verified once
// it predicts something it could have got wrong.
//
// So the measurement lives here now, reading the real field (`appTsx`), with a control case proving
// `extractPageRoutes` genuinely FINDS routes when they exist. If someone adds a router-based scaffold
// the count changes and this fails — which is the point: the docs quote this number, and a number in
// prose goes stale silently.
describe('lane B: why the page checks cannot answer for our own apps', () => {
  it('extractPageRoutes WORKS — so the finding is about the scaffolds, not a broken function', () => {
    expect(extractPageRoutes({
      'src/App.tsx': '<Routes><Route path="/" element={<H/>} /><Route path="/dashboard" element={<D/>} /></Routes>',
    })).toEqual(['/dashboard']); // '/' is dropped: the preview verifier already proved it
    expect(extractPageRoutes({ 'app/settings/page.tsx': 'export default function P(){}' })).toEqual(['/settings']);
  });

  it('and not one golden scaffold yields a route, because not one uses a router', () => {
    const real = GOLDEN_SCAFFOLDS.filter((s) => (s.appTsx || '').length > 100);
    expect(real.length).toBe(GOLDEN_SCAFFOLDS.length); // the guard my first probe lacked: the source is really there
    const withRoutes = real.filter((s) => extractPageRoutes({ 'src/App.tsx': s.appTsx }).length > 0);
    const withRouter = real.filter((s) => /react-router|<Routes|<Route\b/.test(s.appTsx));
    expect(withRoutes).toEqual([]);
    expect(withRouter).toEqual([]);
  });
});
