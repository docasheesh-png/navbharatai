import { describe, it, expect } from 'vitest';
import {
  scanAuthenticity, authenticitySummary,
  highSeverityAuthenticityIssues, authenticityRepairInstruction,
} from './AuthenticityAnalysis';

describe('highSeverityAuthenticityIssues — only the build-breaking stubs (incomplete-code heal input)', () => {
  it('returns HIGH-severity issues across the workspace, ignoring medium/low', () => {
    const files = {
      'src/game.ts': 'function loadNextLevel() {\n  throw new Error("Not implemented");\n}',
      'src/util.ts': '// TODO: tidy this later\nexport const x = 1;', // medium/low — excluded
    };
    const hits = highSeverityAuthenticityIssues(files);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((h) => h.severity === 'high')).toBe(true);
    expect(hits.some((h) => h.file === 'src/game.ts')).toBe(true);
  });

  it('a genuinely complete app yields nothing (the heal never fires on clean code)', () => {
    expect(highSeverityAuthenticityIssues({ 'src/App.tsx': 'export default function App(){return <div>Hi</div>;}' })).toEqual([]);
    expect(highSeverityAuthenticityIssues({})).toEqual([]);
  });
});

describe('authenticityRepairInstruction — completes the stub, forbids the escape hatches', () => {
  it('names the exact file:line and bans placeholder/delete/hide', () => {
    const msg = authenticityRepairInstruction([
      { file: 'src/game.ts', line: 42, kind: 'not-implemented', severity: 'high', snippet: 'throw new Error("Not implemented")' },
    ]);
    expect(msg).toContain('src/game.ts:42');
    expect(msg).toContain('REAL, WORKING');
    expect(msg.toLowerCase()).toContain('do not delete');
    expect(msg).toContain('NO placeholder');
  });
});

describe('the incomplete-code heal is wired weak-tier-safe (admin: "free tier me claude nahi")', () => {
  const routes = require('fs').readFileSync(require('path').join(__dirname, '../routes/agentv3.ts'), 'utf8') as string;

  it('fires ONLY on a failed build with real stubs, is kill-switchable, and re-judges the full readiness gate', () => {
    expect(routes).toContain('AGENTV3_INCOMPLETE_CODE_HEAL');
    expect(routes).toContain('highSeverityAuthenticityIssues(Object.fromEntries(writtenFiles))');
    expect(routes).toContain('authenticityRepairInstruction(stubs)');
    // Only recovers ok:true when the WHOLE readiness gate passes, not just authenticity.
    expect(routes).toContain('READINESS_RECOVERED_AFTER_COMPLETION');
  });

  it('routes the completion through the shared tier runner — no Sonnet/Opus on a free build by construction', () => {
    // buildTurnRunner(healRunnerOpts()) carries the same noClaude enforcement as every build turn, so the
    // weak-module Claude ban (🔒) applies automatically — there is no separate model path to leak through.
    const at = routes.indexOf('INCOMPLETE-CODE HEAL');
    expect(at).toBeGreaterThan(-1);
    const block = routes.slice(at, at + 2600);
    expect(block).toContain('buildTurnRunner(healRunnerOpts())');
    expect(block).toContain('resolveModel(powerLevelReqEffective)');
  });
});

describe('scanAuthenticity', () => {
  it('flags a "not implemented" throw as high', () => {
    const issues = scanAuthenticity(
      'src/service.ts',
      'export function pay() {\n  throw new Error("Not implemented");\n}',
    );
    expect(issues.some((x) => x.severity === 'high')).toBe(true);
    const hit = issues.find((x) => x.line === 2);
    expect(hit).toBeTruthy();
    expect(hit!.snippet).toContain('Not implemented');
  });

  it('flags TODO and FIXME comment markers as medium', () => {
    const todo = scanAuthenticity('a.ts', 'const x = 1; // TODO: wire this up');
    expect(todo.some((x) => x.kind === 'todo-marker' && x.severity === 'medium')).toBe(true);
    const fixme = scanAuthenticity('b.ts', '// FIXME later');
    expect(fixme.some((x) => x.kind === 'todo-marker')).toBe(true);
  });

  it('flags a placeholder-image service in an <img src> (medium) but not a real photo service', () => {
    const bad = scanAuthenticity('src/Hero.tsx', '<img src="https://via.placeholder.com/640x480" alt="hero" />');
    expect(bad.some((x) => x.kind === 'placeholder-image' && x.severity === 'medium')).toBe(true);
    expect(scanAuthenticity('src/Hero.tsx', '<img src="https://placehold.co/600x400" alt="x" />').some((x) => x.kind === 'placeholder-image')).toBe(true);
    // Real photo services are not flagged (used in shipping apps).
    expect(scanAuthenticity('src/Hero.tsx', '<img src="https://picsum.photos/600/400" alt="x" />').some((x) => x.kind === 'placeholder-image')).toBe(false);
    expect(scanAuthenticity('src/Hero.tsx', '<img src="/assets/hero.png" alt="x" />').some((x) => x.kind === 'placeholder-image')).toBe(false);
  });

  it('flags a console.log-only handler as an empty handler (medium)', () => {
    const issues = scanAuthenticity(
      'src/handler.ts',
      'function onSubmit(e) {\n  console.log("submitted");\n}',
    );
    expect(issues.some((x) => x.kind === 'empty-handler' && x.severity === 'medium')).toBe(true);
  });

  it('does NOT flag a control block (if/for/while) whose body is a single console.log', () => {
    // Regression: the body-start regex matched any `) {`, so a legit guard `if (!data) { log }`
    // was mislabeled an empty handler. Only a real arrow/function body counts.
    expect(scanAuthenticity('src/a.ts', 'function check(data) {\n  if (!data) {\n    console.log("missing");\n  }\n}')
      .some((x) => x.kind === 'empty-handler')).toBe(false);
    expect(scanAuthenticity('src/b.ts', 'for (const x of xs) {\n  console.log(x);\n}')
      .some((x) => x.kind === 'empty-handler')).toBe(false);
    // …but a real arrow handler whose body is only a log is STILL flagged.
    expect(scanAuthenticity('src/c.tsx', 'const onClick = () => {\n  console.log("clicked");\n};')
      .some((x) => x.kind === 'empty-handler')).toBe(true);
  });

  it('flags lorem-ipsum and mockData stubs as high', () => {
    const lorem = scanAuthenticity('src/page.tsx', 'const body = "Lorem ipsum dolor sit amet";');
    expect(lorem.some((x) => x.kind === 'lorem-ipsum' && x.severity === 'high')).toBe(true);
    const mock = scanAuthenticity('src/data.ts', 'export const users = mockData;');
    expect(mock.some((x) => x.kind === 'fake-data-identifier' && x.severity === 'high')).toBe(true);
  });

  it('stub-marker does NOT fire on Tailwind placeholder utilities (the Hospital-build false positive)', () => {
    // Real UI styling from the blocked build — quoted class strings beginning with the word.
    expect(scanAuthenticity('src/ui/Input.tsx', "const cls = 'placeholder:text-gray-400 dark:placeholder:text-gray-500';").some((x) => x.kind === 'stub-marker')).toBe(false);
    expect(scanAuthenticity('src/ui/Input.tsx', "clsx('placeholder-gray-400 focus:ring-2', className)").some((x) => x.kind === 'stub-marker')).toBe(false);
    // A genuine left-in stub marker is still flagged.
    expect(scanAuthenticity('src/api.ts', '// placeholder until the real API lands').some((x) => x.kind === 'stub-marker')).toBe(true);
    expect(scanAuthenticity('src/api.ts', 'return "this is a stub";').some((x) => x.kind === 'stub-marker')).toBe(true);
  });

  it('coming-soon flags filler but NOT the honest "not available yet" state the constitution mandates', () => {
    expect(scanAuthenticity('src/Page.tsx', '<p>Analytics coming soon</p>').some((x) => x.kind === 'coming-soon')).toBe(true);
    expect(scanAuthenticity('src/Page.tsx', "<p>Live preview is not available yet in this environment.</p>").some((x) => x.kind === 'coming-soon')).toBe(false);
  });

  it('returns [] for clean, real code (no false positives)', () => {
    const clean = scanAuthenticity(
      'src/math.ts',
      'export function add(a: number, b: number): number {\n  return a + b;\n}',
    );
    expect(clean).toEqual([]);
  });

  it('does not flag a handler with a real body', () => {
    const real = scanAuthenticity(
      'src/handler.ts',
      'function onSubmit(e) {\n  e.preventDefault();\n  save(form);\n}',
    );
    expect(real).toEqual([]);
  });

  it('returns [] for files under test or node_modules paths', () => {
    const code = 'throw new Error("Not implemented"); // TODO';
    expect(scanAuthenticity('src/foo.test.ts', code)).toEqual([]);
    expect(scanAuthenticity('src/__tests__/foo.ts', code)).toEqual([]);
    expect(scanAuthenticity('node_modules/pkg/index.js', code)).toEqual([]);
  });

  it('flags a left-in debugger statement (medium)', () => {
    const issues = scanAuthenticity('src/app.ts', 'function f() {\n  debugger;\n  return 1;\n}');
    expect(issues.some((i) => i.kind === 'debugger-statement' && i.severity === 'medium')).toBe(true);
  });

  it('does not flag debugger in a comment or as part of an identifier', () => {
    expect(scanAuthenticity('src/a.ts', '// debugger; left a note')).toEqual([]);
    expect(scanAuthenticity('src/a.ts', 'const debuggerMode = true;')).toEqual([]);
    expect(scanAuthenticity('src/a.ts', 'logger.debugger;')).toEqual([]);
  });

  it('flags a bare eslint-disable (all rules off) but not one that names specific rules', () => {
    expect(scanAuthenticity('src/a.ts', '/* eslint-disable */\nconst x = 1;').some((i) => i.kind === 'eslint-disable-all')).toBe(true);
    expect(scanAuthenticity('src/b.ts', '// eslint-disable-next-line\nfoo();').some((i) => i.kind === 'eslint-disable-all')).toBe(true);
    // Naming the rule(s) is intentional and is not flagged.
    expect(scanAuthenticity('src/c.ts', '// eslint-disable-next-line react-hooks/exhaustive-deps\nfoo();').some((i) => i.kind === 'eslint-disable-all')).toBe(false);
    expect(scanAuthenticity('src/d.ts', '/* eslint-disable no-console */\nfoo();').some((i) => i.kind === 'eslint-disable-all')).toBe(false);
  });

  it('flags @ts-nocheck (medium) and a blind @ts-ignore (low), but not @ts-expect-error', () => {
    const noCheck = scanAuthenticity('src/a.ts', '// @ts-nocheck\nconst x: number = "bad";');
    expect(noCheck.some((i) => i.kind === 'ts-nocheck' && i.severity === 'medium')).toBe(true);
    const ignore = scanAuthenticity('src/b.ts', '// @ts-ignore\nfoo.bar();');
    expect(ignore.some((i) => i.kind === 'ts-ignore' && i.severity === 'low')).toBe(true);
    // @ts-expect-error is intentional and self-verifying — not flagged.
    expect(scanAuthenticity('src/c.ts', '// @ts-expect-error known gap\nfoo.bar();').some((i) => i.kind === 'ts-ignore' || i.kind === 'ts-nocheck')).toBe(false);
  });

  it('flags a leftover debug console.log (bare number / sentinel string) but not a real log', () => {
    expect(scanAuthenticity('src/a.ts', 'console.log(123);').some((i) => i.kind === 'debug-console-log')).toBe(true);
    expect(scanAuthenticity('src/a.ts', "console.log('here');").some((i) => i.kind === 'debug-console-log')).toBe(true);
    expect(scanAuthenticity('src/a.ts', "console.log('test1');").some((i) => i.kind === 'debug-console-log')).toBe(true);
    // a real, meaningful log message is not flagged.
    expect(scanAuthenticity('src/a.ts', "console.log('User saved successfully');").some((i) => i.kind === 'debug-console-log')).toBe(false);
    expect(scanAuthenticity('src/a.ts', 'console.log(user.id);').some((i) => i.kind === 'debug-console-log')).toBe(false);
  });

  it('flags a placeholder @example.com email but not a real one', () => {
    expect(scanAuthenticity('src/Contact.tsx', 'const support = "support@example.com";').some((i) => i.kind === 'placeholder-email')).toBe(true);
    expect(scanAuthenticity('src/Contact.tsx', '<a href="mailto:hello@example.org">Email</a>').some((i) => i.kind === 'placeholder-email')).toBe(true);
    expect(scanAuthenticity('src/Contact.tsx', 'const support = "help@navbharat.ai";').some((i) => i.kind === 'placeholder-email')).toBe(false);
  });

  it('flags an empty promise .catch(() => {}) but not one with a real body', () => {
    expect(scanAuthenticity('src/a.ts', 'fetch(u).then(r => r.json()).catch(() => {});').some((i) => i.kind === 'empty-promise-catch')).toBe(true);
    expect(scanAuthenticity('src/a.ts', 'load().catch(e => {});').some((i) => i.kind === 'empty-promise-catch')).toBe(true);
    // a catch that handles the error is not flagged.
    expect(scanAuthenticity('src/a.ts', 'load().catch((e) => { console.error(e); });').some((i) => i.kind === 'empty-promise-catch')).toBe(false);
  });

  it('flags an empty catch block (low) that silently swallows the error', () => {
    const issues = scanAuthenticity('src/a.ts', 'try {\n  risky();\n} catch (e) {}');
    const hit = issues.find((i) => i.kind === 'empty-catch');
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('low');
    expect(hit!.line).toBe(3);
  });

  it('flags empty catch variants (no binding, multiline whitespace body)', () => {
    expect(scanAuthenticity('src/a.ts', 'try { f() } catch {}').some((i) => i.kind === 'empty-catch')).toBe(true);
    expect(scanAuthenticity('src/a.ts', 'try {\n f()\n} catch (err) {\n   \n}').some((i) => i.kind === 'empty-catch')).toBe(true);
  });

  it('does NOT flag a catch that handles or documents the error', () => {
    expect(scanAuthenticity('src/a.ts', 'try { f() } catch (e) { console.error(e); }').some((i) => i.kind === 'empty-catch')).toBe(false);
    // a comment in the body is an explicit, intentional ignore — not flagged.
    expect(scanAuthenticity('src/a.ts', 'try { f() } catch { /* best-effort, ignore */ }').some((i) => i.kind === 'empty-catch')).toBe(false);
  });
});

describe('authenticitySummary', () => {
  it('reports a clean line when there are no issues', () => {
    expect(authenticitySummary([])).toContain('No fake/incomplete code detected');
  });

  it('summarises by severity with file:line lines when non-empty', () => {
    const sum = authenticitySummary([
      { file: 'a.ts', line: 1, kind: 'not-implemented', severity: 'high', snippet: 'throw new Error("Not implemented")' },
      { file: 'b.ts', line: 2, kind: 'todo-marker', severity: 'medium', snippet: '// TODO' },
    ]);
    expect(sum).toContain('1 high');
    expect(sum).toContain('1 medium');
    expect(sum).toContain('a.ts:1');
    expect(sum).toContain('not-implemented');
  });

  it('truncates to 15 lines with a "more" tail', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      file: `f${i}.ts`,
      line: i + 1,
      kind: 'todo-marker' as const,
      severity: 'medium' as const,
      snippet: '// TODO',
    }));
    const sum = authenticitySummary(many);
    expect(sum).toContain('…and 5 more.');
  });
});
