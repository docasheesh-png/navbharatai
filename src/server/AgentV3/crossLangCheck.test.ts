import { describe, it, expect } from 'vitest';
import { detectChecks, parseCheckOutcome, type CheckPlan } from './crossLangCheck';

// B6: cross-language typecheck/compile detection + parsing. Both pure — exercise every language branch.

describe('detectChecks', () => {
  it('detects TS via tsconfig + tsx sources (tsc --noEmit by default)', () => {
    const plans = detectChecks(['tsconfig.json', 'src/App.tsx']);
    expect(plans.map(p => p.language)).toEqual(['ts']);
    expect(plans[0].command).toBe('npx tsc --noEmit');
  });

  it('prefers the project\'s own typecheck script when present', () => {
    const pkg = JSON.stringify({ scripts: { typecheck: 'tsc -p tsconfig.build.json --noEmit' } });
    const plans = detectChecks(['tsconfig.json', 'src/x.ts'], pkg);
    expect(plans[0].command).toBe('npm run typecheck');
  });

  it('detects each language and returns one plan per language in a polyglot repo', () => {
    const plans = detectChecks(
      ['tsconfig.json', 'src/App.tsx', 'api/main.py', 'pom.xml', 'src/main/java/App.java', 'server/main.go'],
    );
    expect(plans.map(p => p.language)).toEqual(['ts', 'python', 'java', 'go']);
    expect(plans.find(p => p.language === 'python')!.command).toBe('python -m compileall -q .');
    expect(plans.find(p => p.language === 'java')!.command).toBe('mvn -q -B compile');
    expect(plans.find(p => p.language === 'go')!.command).toBe('go build ./...');
  });

  it('detects a Gradle JVM project and prefers the gradlew wrapper (classes task)', () => {
    const withWrapper = detectChecks(['build.gradle', 'gradlew', 'src/main/java/App.java']);
    const java = withWrapper.find(p => p.language === 'java')!;
    expect(java.command).toBe('./gradlew classes');

    const ktsNoWrapper = detectChecks(['app/build.gradle.kts', 'src/main/kotlin/App.kt']);
    expect(ktsNoWrapper.find(p => p.language === 'java')!.command).toBe('gradle classes');
  });

  it('prefers Maven over Gradle when both build files exist (single Java plan)', () => {
    const plans = detectChecks(['pom.xml', 'build.gradle', 'src/main/java/App.java']);
    const javaPlans = plans.filter(p => p.language === 'java');
    expect(javaPlans).toHaveLength(1);
    expect(javaPlans[0].command).toBe('mvn -q -B compile');
  });

  it('returns [] when nothing checkable is present (honest — never a fake ok)', () => {
    expect(detectChecks(['index.html', 'style.css'])).toEqual([]);
    // TS without a tsconfig is not type-checkable in isolation here.
    expect(detectChecks(['random.ts'])).toEqual([]);
  });
});

const planFor = (language: CheckPlan['language']): CheckPlan => ({ language, command: 'x', reason: 'r' });

describe('parseCheckOutcome', () => {
  it('TS — clean exit is ok with 0 errors', () => {
    const o = parseCheckOutcome(planFor('ts'), 0, '', '');
    expect(o.ok).toBe(true);
    expect(o.errorCount).toBe(0);
  });

  it('TS — parses "Found N errors" and the error lines', () => {
    const out = "src/App.tsx(3,5): error TS2322: Type 'x'.\nsrc/b.ts(9,1): error TS2304: Cannot find name 'y'.\nFound 2 errors.\n";
    const o = parseCheckOutcome(planFor('ts'), 1, out, '');
    expect(o.ok).toBe(false);
    expect(o.errorCount).toBe(2);
    expect(o.firstErrors.length).toBe(2);
    expect(o.firstErrors[0]).toContain('error TS2322');
  });

  it('Go — counts compiler error lines', () => {
    const out = './main.go:10:2: undefined: fmt.Printn\n';
    const o = parseCheckOutcome(planFor('go'), 1, '', out);
    expect(o.ok).toBe(false);
    expect(o.errorCount).toBe(1);
    expect(o.firstErrors[0]).toContain('main.go:10:2');
  });

  it('Java — counts Kotlin "e:" compile-error lines (Gradle JVM)', () => {
    const out = '> Task :compileKotlin FAILED\ne: /src/main/kotlin/App.kt: (12, 5): unresolved reference: foo\nBUILD FAILED\n';
    const o = parseCheckOutcome(planFor('java'), 1, out, '');
    expect(o.ok).toBe(false);
    expect(o.errorCount).toBe(1);
    expect(o.firstErrors.some(l => /unresolved reference/.test(l))).toBe(true);
  });

  it('Java — counts [ERROR] lines', () => {
    const out = '[ERROR] /src/App.java:[5,9] cannot find symbol\n[ERROR] BUILD FAILURE\n';
    const o = parseCheckOutcome(planFor('java'), 1, out, '');
    expect(o.ok).toBe(false);
    expect(o.errorCount).toBeGreaterThanOrEqual(1);
  });

  it('Python — non-zero exit with a SyntaxError is not ok', () => {
    const out = 'File "api/main.py", line 3\n    def f(:\n          ^\nSyntaxError: invalid syntax\n';
    const o = parseCheckOutcome(planFor('python'), 1, out, '');
    expect(o.ok).toBe(false);
    expect(o.firstErrors.join(' ')).toContain('SyntaxError');
  });

  it('non-zero exit with unparseable output is still not ok (exit code is authoritative)', () => {
    const o = parseCheckOutcome(planFor('go'), 2, 'panic: toolchain missing', '');
    expect(o.ok).toBe(false);
  });
});
