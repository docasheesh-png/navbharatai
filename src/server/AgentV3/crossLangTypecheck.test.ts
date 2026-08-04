import { describe, it, expect } from 'vitest';
import { detectTypecheckPlan, parseTypecheckOutcome, typecheckSummary } from './crossLangTypecheck';

describe('detectTypecheckPlan', () => {
  it('plans mypy when Python sources + mypy are configured', () => {
    const plans = detectTypecheckPlan(['app/main.py', 'app/util.py'], { 'pyproject.toml': '[tool.mypy]\nstrict = true' });
    expect(plans).toHaveLength(1);
    expect(plans[0].lang).toBe('python');
    expect(plans[0].command).toContain('mypy');
  });

  it('plans a fallback Python check when mypy is not configured', () => {
    const plans = detectTypecheckPlan(['main.py']);
    expect(plans[0].lang).toBe('python');
    expect(plans[0].command).toMatch(/mypy|py_compile/);
  });

  it('plans maven compile for a Java + pom.xml project, gradle for build.gradle, javac otherwise', () => {
    expect(detectTypecheckPlan(['src/Main.java', 'pom.xml'])[0].command).toBe('mvn -q -DskipTests compile');
    expect(detectTypecheckPlan(['src/Main.java', 'build.gradle'])[0].command).toBe('./gradlew -q compileJava');
    expect(detectTypecheckPlan(['Main.java'])[0].command).toContain('javac');
  });

  it('plans `go build ./...` when Go sources are present', () => {
    const plans = detectTypecheckPlan(['cmd/main.go', 'internal/svc.go']);
    expect(plans).toHaveLength(1);
    expect(plans[0].lang).toBe('go');
    expect(plans[0].command).toBe('go build ./...');
  });

  it('plans ALL THREE for a polyglot app, and NOTHING for a TS-only app (tsc owns TS)', () => {
    const all = detectTypecheckPlan(['a.py', 'B.java', 'pom.xml', 'cmd/main.go']);
    expect(all.map((p) => p.lang).sort()).toEqual(['go', 'java', 'python']);
    expect(detectTypecheckPlan(['src/App.tsx', 'src/index.ts'])).toEqual([]);
  });

  it('ignores vendored dirs (node_modules/venv/target/vendor)', () => {
    expect(detectTypecheckPlan(['venv/lib/x.py', 'target/Gen.java', 'vendor/github.com/x/y.go'])).toEqual([]);
  });
});

describe('parseTypecheckOutcome', () => {
  it('python: parses "Found N errors" and marks not-ok', () => {
    const o = parseTypecheckOutcome('python', 1, 'main.py:3: error: Incompatible types\nFound 1 error in 1 file', '');
    expect(o.ok).toBe(false);
    expect(o.ran).toBe(true);
    expect(o.errorCount).toBe(1);
    expect(o.firstErrors[0]).toContain('error:');
  });

  it('python: clean exit 0 with no errors is ok', () => {
    expect(parseTypecheckOutcome('python', 0, 'Success: no issues found', '')).toMatchObject({ ok: true, ran: true, errorCount: 0 });
  });

  it('java: counts javac/maven [ERROR] lines; exit!=0 with no parsed line still counts ≥1', () => {
    const o = parseTypecheckOutcome('java', 1, '[ERROR] /src/Main.java:[5,3] incompatible types', '');
    expect(o.ok).toBe(false);
    expect(o.errorCount).toBeGreaterThanOrEqual(1);
    expect(parseTypecheckOutcome('java', 1, 'build failed', '').errorCount).toBe(1);
  });

  it('go: counts "file.go:line:col:" error lines; clean exit 0 is ok', () => {
    const o = parseTypecheckOutcome('go', 1, '# myapp/internal\ninternal/svc.go:12:6: declared and not used: x\ninternal/svc.go:20:2: undefined: Foo', '');
    expect(o.ok).toBe(false);
    expect(o.ran).toBe(true);
    expect(o.errorCount).toBe(2);
    expect(o.firstErrors[0]).toContain('.go:12:6:');
    expect(parseTypecheckOutcome('go', 0, '', '')).toMatchObject({ ok: true, ran: true, errorCount: 0 });
  });

  it('a missing tool → ran:false (honest "could not run", never a fake pass)', () => {
    expect(parseTypecheckOutcome('python', null, '', '').ran).toBe(false);
    expect(parseTypecheckOutcome('python', 127, 'python: command not found', '').ran).toBe(false);
    expect(parseTypecheckOutcome('python', 1, "ModuleNotFoundError: No module named 'mypy'", '').ran).toBe(false);
    expect(parseTypecheckOutcome('go', 127, 'go: command not found', '').ran).toBe(false);
  });
});

describe('typecheckSummary', () => {
  it('is empty for nothing, and renders clean / errors / could-not-run honestly', () => {
    expect(typecheckSummary([])).toBe('');
    const s = typecheckSummary([
      { lang: 'python', ok: true, ran: true, errorCount: 0, firstErrors: [] },
      { lang: 'java', ok: false, ran: true, errorCount: 2, firstErrors: ['Main.java:5 error'] },
    ]);
    expect(s).toContain('Cross-language type-check');
    expect(s).toContain('python: type-checks clean');
    expect(s).toContain('java: 2 type/compile error');
    expect(typecheckSummary([{ lang: 'python', ok: false, ran: false, errorCount: 0, firstErrors: [] }])).toContain('could not run');
  });
});
