import { describe, expect, it, vi } from 'vitest';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

const packageJson = JSON.stringify({ devDependencies: { vitest: '^3' }, scripts: { test: 'vitest run' } });
const realTest = "import { expect, test } from 'vitest'; test('payout', () => expect(payoutFor(bet, result)).toBe(20));";
const seed = () => {
  const harness = makeDispatcher();
  harness.act.files.set('package.json', packageJson);
  harness.act.files.set('src/app/models.test.ts', realTest);
  return harness;
};

describe('cdffbb71: test execution waits for the existing dependency preparation guarantee', () => {
  it.each([true, false])('prepares once before execution (installer ran=%s) and leaves the suite intact', async (ran) => {
    const { act, d } = seed();
    const order: string[] = [];
    const ensureDependencies = vi.fn(async () => { order.push('prepare'); return { ok: true, ran, log: ran ? 'installed' : 'already installed' }; });
    Object.assign(act, { ensureDependencies });
    vi.spyOn(act, 'runCommand').mockImplementation(async (_ws, command) => {
      order.push(command);
      return { exitCode: 0, stdout: 'Tests  1 passed (1)', stderr: '' };
    });
    const res = await d.dispatch(toolCall('run_tests', {}), 'architect');
    expect(res.is_error).not.toBe(true);
    expect(ensureDependencies).toHaveBeenCalledOnce();
    expect(order).toEqual(['prepare', 'npm run test']);
    expect(res.content).toContain(ran ? 'sync attempted' : 'no install run');
    expect(res.content).toContain('1/1 passed');
    expect(act.files.get('src/app/models.test.ts')).toBe(realTest);
    expect(act.files.get('package.json')).toBe(packageJson);
  });

  it('an installation failure is unverified, executes no suite and deletes no tests/dependencies', async () => {
    const { act, d } = seed();
    Object.assign(act, { ensureDependencies: vi.fn(async () => ({ ok: false, ran: true, log: 'ERESOLVE incompatible peer' })) });
    const before = [...act.files];
    const res = await d.dispatch(toolCall('run_tests', {}), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('Tests were not executed');
    expect(res.content).toContain('Preserve the test suite');
    expect(res.content).toContain('ERESOLVE incompatible peer');
    expect(act.commands).toEqual([]);
    expect([...act.files]).toEqual(before);
  });

  it('an actuator without preparation still reports the observed missing runner honestly', async () => {
    const { act, d } = seed();
    act.commandResult = { exitCode: 127, stdout: '', stderr: 'sh: 1: vitest: not found' };
    const before = [...act.files];
    const res = await d.dispatch(toolCall('run_tests', {}), 'architect');
    expect(res.content).toContain('COULD NOT RUN');
    expect(res.content).not.toContain('PASS');
    expect([...act.files]).toEqual(before);
  });

  it('does not install JavaScript dependencies for a native Go suite', async () => {
    const { act, d } = makeDispatcher();
    const ensureDependencies = vi.fn(async () => ({ ok: true, ran: true, log: 'installed' }));
    Object.assign(act, { ensureDependencies });
    act.files.set('go.mod', 'module colourgame');
    act.files.set('game_test.go', 'package game');
    act.commandResult = { exitCode: 0, stdout: 'PASS\nok colourgame 0.01s', stderr: '' };
    await d.dispatch(toolCall('run_tests', {}), 'architect');
    expect(ensureDependencies).not.toHaveBeenCalled();
    expect(act.commands).toContain('go test ./...');
  });

  it('the real generation tool reads transitive Vite metadata before declaring the runner', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('package.json', JSON.stringify({ devDependencies: { '@angular-devkit/build-angular': '^18.0.0' } }));
    act.files.set('package-lock.json', JSON.stringify({ packages: { 'node_modules/vite': { version: '5.4.21' } } }));
    const res = await d.dispatch(toolCall('generate_tests', {
      path: 'src/app/models.test.ts', module_path: './models', functions: [{ name: 'payoutFor', params: ['bet', 'result'] }],
    }), 'architect');
    expect(res.is_error).not.toBe(true);
    expect(JSON.parse(act.files.get('package.json')!).devDependencies.vitest).toBe('^3');
    expect(res.content).toContain('Declared vitest@^3');
    expect(res.content).toContain('pending behavioural cases');
    expect(res.content).toContain('no test execution is proved');
    expect(act.files.get('src/app/models.test.ts')).toContain('it.todo');
  });

  it.each(['generate_tests', 'generate_money_format'])('%s reports unsupported transitive versions without inventing a runner declaration', async (tool) => {
    const { act, d } = makeDispatcher();
    const before = '{"devDependencies":{"@angular/build":"^30"}}';
    act.files.set('package.json', before);
    act.files.set('node_modules/vite/package.json', '{"name":"vite","version":"9.0.0"}');
    const res = await d.dispatch(toolCall(tool, tool === 'generate_tests' ? {
      path: 'src/app/models.test.ts', module_path: './models', functions: [{ name: 'payoutFor' }],
    } : {}), 'architect');
    expect(res.is_error).not.toBe(true);
    expect(res.content).toContain('No compatible Vitest version was automatically declared');
    expect(res.content).toContain('Preserve the tests');
    expect(act.files.get('package.json')).toBe(before);
    expect([...act.files.keys()].some((path) => path.endsWith('.test.ts'))).toBe(true);
  });
});

describe('search errors retain their tool error flag', () => {
  it('propagates filesystem failure rather than handing the reviewer a successful tool result', async () => {
    const { act, d } = makeDispatcher();
    act.commandResult = { exitCode: 0, stdout: '__NBAI_GREP:F:2\ngrep: missing: No such file or directory\n', stderr: '' };
    const res = await d.dispatch(toolCall('grep', { pattern: 'wallet', path: 'missing' }), 'reviewer');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('NOT a "no matches" answer');
  });

  it('a genuine no-match remains a successful search', async () => {
    const { act, d } = makeDispatcher();
    act.commandResult = { exitCode: 0, stdout: '__NBAI_GREP:F:1\n', stderr: '' };
    const res = await d.dispatch(toolCall('grep', { pattern: 'wallet', path: '' }), 'reviewer');
    expect(res.is_error).not.toBe(true);
    expect(res.content).toBe('(no matches)');
  });
});
