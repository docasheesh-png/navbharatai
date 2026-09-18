/**
 * THE STACK NAMED THE FILE, AND WE THREW IT AWAY (admin 2026-09-18, autopsy 95598899).
 *
 * That build left the app throwing `Cannot read properties of null (reading 'useState')` and the
 * report carried the sentence and nothing else - no file, no line. The autopsy closed **unexplained**,
 * which was the honest outcome and a wasted report. The stack was one property away at capture time:
 * `page.on('pageerror', e => rec('pageerror', e && e.message || e))`.
 *
 * These cases cover the extractor, everything it must REFUSE to name, the report line that now quotes
 * the first error, and - because the capture lives in a sandbox script string that no unit test can
 * execute - source-level reversion guards on the four places the fact has to survive.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appSourceFrame, siteTag, siteTagFromStack } from '../src/server/AgentV3/runtimeErrorSite';
import {
  filterActionableErrors, formatRuntimeErrors, runtimeErrorsRemainRecord, type RuntimeError,
} from '../src/server/AgentV3/AutoFix';
import { locationTag } from '../src/server/AppMakerLab/intelligence/LogIntelligenceEngine';

/** The real shape of the crash that closed autopsy 95598899, as React 18 + Vite emits it. */
const USE_STATE_CRASH = [
  "TypeError: Cannot read properties of null (reading 'useState')",
  '    at Object.useState (http://localhost:5173/node_modules/.vite/deps/react.js?v=8f2c:1065:29)',
  '    at App (http://localhost:5173/src/App.tsx?t=1758201234567:12:31)',
  '    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=8f2c:11548:26)',
].join('\n');

describe('the extractor - which frame is the app own code', () => {
  it('THE CASE THAT BLOCKED THE AUTOPSY: it names the user file, line and column', () => {
    expect(appSourceFrame(USE_STATE_CRASH)).toEqual({ file: 'src/App.tsx', line: 12, column: 31 });
  });

  it('it walks PAST the vendor frame that comes first - which is why a wider regex was wrong', () => {
    // `parseLocation` on the whole blob would return react.js: a correct location, and useless to read.
    expect(appSourceFrame(USE_STATE_CRASH)!.file).not.toContain('node_modules');
  });

  it('a Vite HMR query does not hide the file', () => {
    // `?t=...` stops the shared FILE_LOC character class, so the frame silently did not parse at all.
    const withQuery = '    at Cart (http://localhost:5173/src/pages/Cart.tsx?t=1758:44:7)';
    expect(appSourceFrame(withQuery)).toEqual({ file: 'src/pages/Cart.tsx', line: 44, column: 7 });
  });

  it('the origin is stripped, so the report names a path someone can open', () => {
    expect(appSourceFrame('    at x (https://abc123.e2b.app/src/lib/api.ts:9:2)')!.file).toBe('src/lib/api.ts');
  });

  it('every kind of not-our-code frame is refused', () => {
    for (const frame of [
      '    at http://localhost:5173/node_modules/react-dom/client.js:10:1',
      '    at http://localhost:5173/@vite/client.js:22:3',
      '    at http://localhost:5173/@react-refresh.js:5:1',
      '    at http://localhost:5173/@fs/home/user/x/y.ts:5:1',
      '    at http://localhost:5173/@id/virtual-mod.ts:5:1',
      '    at chrome-extension://abcd/inject.js:7:1',
      '    at /root/app/node_modules/.vite/deps/chunk.js:1:1',
    ]) {
      expect(appSourceFrame(frame)).toBeNull();
    }
  });

  it('"this stack does not tell us" is null - never a guess', () => {
    expect(appSourceFrame('')).toBeNull();
    expect(appSourceFrame(null)).toBeNull();
    expect(appSourceFrame(undefined)).toBeNull();
    expect(appSourceFrame('TypeError: x is not a function')).toBeNull();
    expect(appSourceFrame('    at Object.<anonymous> (<anonymous>)')).toBeNull();
  });

  it('a frame it cannot classify is KEPT - a near-miss still points a reader somewhere', () => {
    // Deliberately conservative: silence would be worse than an imperfect path.
    expect(appSourceFrame('    at boot (/opt/thing/main.js:3:1)')).toEqual({ file: 'opt/thing/main.js', line: 3, column: 1 });
  });

  it('it never throws, whatever it is handed', () => {
    for (const junk of ['a'.repeat(50000), '::::', '{"not":"a stack"}', '\t\t\t']) {
      expect(() => appSourceFrame(junk)).not.toThrow();
    }
  });

  it('a very deep stack is bounded rather than walked for ever', () => {
    const deep = [...Array(200)].map(() => '    at v (http://x/node_modules/a.js:1:1)').join('\n')
      + '\n    at App (http://x/src/App.tsx:1:1)';
    expect(appSourceFrame(deep)).toBeNull(); // past the frame budget, so we say nothing
  });
});

describe('the display form', () => {
  it('reads exactly like `locationTag`, so nobody learns two notations', () => {
    expect(siteTag({ file: 'src/App.tsx', line: 12, column: 31 })).toBe(' [at src/App.tsx:12:31]');
    expect(locationTag('oops at src/App.tsx:12:31')).toContain('[at src/App.tsx:12:31');
  });

  it('nothing to say means an empty string, not a placeholder', () => {
    expect(siteTag(null)).toBe('');
    expect(siteTagFromStack('no frames here')).toBe('');
  });
});

describe('the stack survives the filter that builds a NEW object', () => {
  it('a captured stack is carried through', () => {
    const [kept] = filterActionableErrors([{ t: 1, kind: 'pageerror', text: 'boom', stack: USE_STATE_CRASH }]);
    expect(kept.stack).toBe(USE_STATE_CRASH);
  });

  it('absent stays ABSENT - "not captured" must not become an empty string', () => {
    const [kept] = filterActionableErrors([{ t: 1, kind: 'console', text: 'boom' }]);
    expect('stack' in kept).toBe(false);
    const [blank] = filterActionableErrors([{ t: 1, kind: 'console', text: 'boom', stack: '   ' }]);
    expect('stack' in blank).toBe(false);
  });

  it('nothing about filtering, dedupe or noise changed', () => {
    const out = filterActionableErrors([
      { t: 1, kind: 'pageerror', text: 'same', stack: 'x' },
      { t: 2, kind: 'pageerror', text: 'same', stack: 'y' },
      { t: 3, kind: 'console', text: '' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('same');
  });
});

describe('what the repair pass and the report are handed', () => {
  const crash: RuntimeError = {
    t: 1, kind: 'pageerror',
    text: "Cannot read properties of null (reading 'useState')",
    stack: USE_STATE_CRASH,
  };

  it('an error whose TEXT has no path now carries the file from its stack', () => {
    expect(formatRuntimeErrors([crash])).toContain('[at src/App.tsx:12:31]');
  });

  it('a TEXT that already had a location is untouched - the stack is a fallback, not an override', () => {
    const withText: RuntimeError = { t: 1, kind: 'console', text: 'Failed at src/other/Thing.tsx:3:4', stack: USE_STATE_CRASH };
    const line = formatRuntimeErrors([withText]);
    expect(line).toContain('src/other/Thing.tsx:3:4');
    expect(line).not.toContain('src/App.tsx');
  });

  it('neither source has one, so no tag at all - exactly as before', () => {
    expect(formatRuntimeErrors([{ t: 1, kind: 'console', text: 'plain message' }])).toBe('- [console] plain message');
  });

  it('THE REPORT LINE: it now names the first error and where it is', () => {
    const msg = runtimeErrorsRemainRecord([crash]).message;
    expect(msg).toContain('1 runtime error(s) remained');
    expect(msg).toContain("reading 'useState'");
    expect(msg).toContain('[at src/App.tsx:12:31]');
  });

  it('the record own shape is unchanged - it must stay an advisory warning', () => {
    const r = runtimeErrorsRemainRecord([crash]);
    expect(r.code).toBe('RUNTIME_ERRORS_REMAIN');
    expect(r.severity).toBe('warning');
    expect(r.autoResolved).toBe(false);
    expect(r.phase).toBe('autofix');
  });

  it('a very long error is bounded, so one crash cannot flood the report', () => {
    const long = runtimeErrorsRemainRecord([{ t: 1, kind: 'pageerror', text: 'E'.repeat(5000) }]).message;
    expect(long.length).toBeLessThan(700);
    expect(long).toContain('...'.slice(0, 1));
  });

  it('WHITE-LABEL: the new wording names no vendor', () => {
    const msg = runtimeErrorsRemainRecord([crash]).message.toLowerCase();
    for (const v of ['glm', 'kimi', 'claude', 'anthropic', 'gemini', 'grok', 'openai', 'moonshot']) {
      expect(msg).not.toContain(v);
    }
  });
});

describe('REVERSION GUARDS - the capture is a sandbox script string no test can execute', () => {
  const actuator = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
  const autofix = readFileSync('src/server/AgentV3/AutoFix.ts', 'utf8');

  it('the browser daemon passes the stack to its recorder', () => {
    expect(actuator).toContain("page.on('pageerror',e=>rec('pageerror',e&&e.message||e,e&&e.stack));");
  });

  it('the recorder writes it, bounded', () => {
    const at = actuator.indexOf('function rec(kind,text');
    const rec = actuator.slice(at, at + 300);
    expect(rec).toContain('stack');
    expect(rec).toMatch(/stack\?String\(stack\)\.slice\(0,\s*\d+\)/);
  });

  it('the NDJSON reader carries it back out - and treats it as optional', () => {
    const read = actuator.slice(actuator.indexOf('async getConsoleErrors'));
    expect(read).toContain("typeof e.stack === 'string' && e.stack ? { stack: e.stack } : {}");
  });

  it('the filter names it, because it builds a new object and drops what it does not name', () => {
    const fn = autofix.slice(autofix.indexOf('export function filterActionableErrors'));
    expect(fn.slice(0, 1400)).toContain('...(stack ? { stack } : {})');
  });
});
