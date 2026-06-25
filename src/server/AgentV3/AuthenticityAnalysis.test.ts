import { describe, it, expect } from 'vitest';
import { scanAuthenticity, authenticitySummary } from './AuthenticityAnalysis';

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

  it('flags lorem-ipsum and mockData stubs as high', () => {
    const lorem = scanAuthenticity('src/page.tsx', 'const body = "Lorem ipsum dolor sit amet";');
    expect(lorem.some((x) => x.kind === 'lorem-ipsum' && x.severity === 'high')).toBe(true);
    const mock = scanAuthenticity('src/data.ts', 'export const users = mockData;');
    expect(mock.some((x) => x.kind === 'fake-data-identifier' && x.severity === 'high')).toBe(true);
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
