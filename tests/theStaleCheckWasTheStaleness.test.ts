/**
 * THE REST OF THE "LEKHAN SAHYAK" LEDGER (autopsy 2026-09-27) — five platform faults the same six
 * builds tripped over, each locked here against the exact shape the report recorded.
 *
 *  1. The dependency staleness probe reported STALE on every healthy vite-react tree, so every dev start
 *     reinstalled — and with a lock file that meant `npm ci`, which deletes node_modules first. Turns
 *     then began with `tsc: not found` and a missing react.
 *  2. A model's multi-line "start the server, sleep, tail the log" script became the dev command whole.
 *  3. Playwright's `test-results/` was saved into the user's project as if it were source.
 *  4. `about:srcdoc` inside a pasted stack trace became "Requested feature not found: about page".
 *  5. Hindi-script screens named in Latin letters were called "not on the screen".
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDepsStaleCheckCommand, dropProbesAfterDevServer, stripDevServerBackgrounding } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { isIgnoredListPath } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { TSC_ENSURE } from '../src/server/AgentV3/tscCommand';
import { isAffirmativelyRequested, withoutMachineText } from '../src/server/AgentV3/featureRequest';
import { requestedFeatureLabels } from '../src/server/AgentV3/RequirementCoverage';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';
import { platformFixRequestPrompt } from '../src/lib/platformFixRequest';

const ROOT = join(__dirname, '..');

/** A tiny real project on disk, installed the way the report's was. */
function project(opts: { omit?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nbai-stale-'));
  const deps = { react: '^18.3.1', '@vitejs/plugin-react': '^5.0.0' };
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: deps }));
  const pkg = (name: string, body: Record<string, unknown>) => {
    if (name === opts.omit) return;
    mkdirSync(join(dir, 'node_modules', name), { recursive: true });
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, ...body }));
  };
  pkg('react', { main: 'index.js' });
  // The real @vitejs/plugin-react: an exports map WITHOUT "./package.json".
  pkg('@vitejs/plugin-react', { exports: { '.': './dist/index.js' } });
  mkdirSync(join(dir, 'node_modules', 'caniuse-lite', 'dist', 'unpacker'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'caniuse-lite', 'package.json'), JSON.stringify({ name: 'caniuse-lite' }));
  writeFileSync(join(dir, 'node_modules', 'caniuse-lite', 'dist', 'unpacker', 'agents.js'), 'module.exports = {};');
  // node_modules newer than package.json — a settled tree.
  const later = new Date(Date.now() + 5_000);
  utimesSync(join(dir, 'node_modules'), later, later);
  return dir;
}

const staleVerdict = (dir: string) => execFileSync('bash', ['-c', buildDepsStaleCheckCommand()], { cwd: dir, encoding: 'utf8' }).trim();

describe('1 · the staleness probe asks what is on disk', () => {
  it('a healthy tree whose plugin hides package.json from require.resolve reads FRESH — the report\'s tree', () => {
    expect(staleVerdict(project())).toBe('');
  });

  it('a declared package that is really missing still reads STALE', () => {
    expect(staleVerdict(project({ omit: 'react' }))).toBe('STALE');
  });

  it('npm ci only ever installs into an EMPTY tree — never wipes one that exists', () => {
    const src = readFileSync(join(ROOT, 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
    expect(src).toContain('if (hasLock && !treePresent) {');
    expect(src).toMatch(/const treePresent = await sandbox\.files\.exists\(`\$\{WORKSPACE_ROOT\}\/node_modules`\)/);
    // Every successful install stamps the tree so the mtime test settles.
    expect(src.match(/return settled\(/g)?.length).toBe(4);
    expect(src).toContain("sandbox.commands.run('touch node_modules'");
  });

  it('the typecheck prelude stamps the tree after installing, so it does not reinstall every run', () => {
    // The install is logged since autopsy 12c642ed (npm's reason used to go to /dev/null); the stamp
    // still follows a successful install, and only that.
    expect(TSC_ENSURE).toMatch(/then \(npm install >>\S+ 2>&1 \|\| \([^)]*\)\) && touch node_modules; fi/);
  });
});

describe('2 · a dev-server line followed by probes is reduced to the server', () => {
  const REPORTED = 'npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/dev.log 2>&1 &\necho "started pid $!"\nsleep 4\ntail -30 /tmp/dev.log';

  it('the report\'s script runs only the server, with its own redirect stripped', () => {
    const reduced = dropProbesAfterDevServer(REPORTED);
    expect(reduced).toBe('npm run dev -- --host 0.0.0.0 --port 5173 > /tmp/dev.log 2>&1 &');
    expect(stripDevServerBackgrounding(reduced)).toBe('npm run dev -- --host 0.0.0.0 --port 5173');
  });

  it('setup lines BEFORE the server are kept — a cd must not be dropped', () => {
    expect(dropProbesAfterDevServer('cd frontend && npm run dev &\nsleep 3\ncurl localhost:5173')).toBe('cd frontend && npm run dev &');
    expect(dropProbesAfterDevServer('export PORT=5173\nnpm run dev &\nsleep 2')).toBe('export PORT=5173\nnpm run dev &');
  });

  it('every single-line command, and a server already last, is returned byte-for-byte', () => {
    for (const c of ['npm run dev', 'npm run dev 2>&1 | head -20', 'pkill -f "vite"; sleep 1; npm run dev &', 'npm run build', 'cd a && npm run dev']) {
      expect(dropProbesAfterDevServer(c)).toBe(c);
    }
  });

  it('two servers is ambiguous and left alone; a quoted newline never splits', () => {
    const two = 'npm run server &\nnpm run dev &\nsleep 2';
    expect(dropProbesAfterDevServer(two)).toBe(two);
    const quoted = 'echo "a\nb" && npm run dev';
    expect(dropProbesAfterDevServer(quoted)).toBe(quoted);
  });

  it('the launcher uses it and tells the model where the output went', () => {
    const src = readFileSync(join(ROOT, 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');
    expect(src).toContain('const strippedForResolve = stripDevServerBackgrounding(serverOnly);');
    expect(src).toMatch(/the lines after it were not run\. The dev server's output is in \$\{DEV_SERVER_LOG_PATH\}/);
  });
});

describe('3 · test-runner output is never a project file', () => {
  it('test-results/ and playwright-report/ are pruned like dist/ and node_modules/', () => {
    expect(isIgnoredListPath('test-results/.last-run.json')).toBe(true);
    expect(isIgnoredListPath('test-results/smoke-app/trace.zip')).toBe(true);
    expect(isIgnoredListPath('playwright-report/index.html')).toBe(true);
    expect(isIgnoredListPath('src/tests/results.ts')).toBe(false);
  });
});

describe('4 · machine text is not a feature request', () => {
  const STACK = "Cannot read properties of null (reading 'useState')\n    at useAppState (eval at requireModule (about:srcdoc:739:12), <anonymous>:13:55)";

  it('the report\'s fix request names no feature — no "about page"', () => {
    expect(requestedFeatureLabels(platformFixRequestPrompt(STACK))).toEqual([]);
    expect(isAffirmativelyRequested(platformFixRequestPrompt(STACK), /\babout\b/i)).toBe(false);
  });

  it('a user pasting the same stack is not asking for an About page either', () => {
    expect(isAffirmativelyRequested(`my app crashes:\n${STACK}`, /\babout\b/i)).toBe(false);
    expect(withoutMachineText('see https://example.com/about and about:blank')).not.toMatch(/about/);
  });

  it('a person who asks for an About page in words still gets one', () => {
    expect(requestedFeatureLabels('build a portfolio with an about page and a contact form')).toContain('about page');
    expect(isAffirmativelyRequested('add an about: section too', /\babout\b/i)).toBe(true);
  });
});

describe('5 · a transliteration is not a fabrication', () => {
  const SUMMARY = 'Aapka app:\n- **Lekhan Sahyak**\n- **Meri Kahaniyaan**\n- **Lekhan Shaili**\n- **Kirdaar**\n- **Adhyay**\n- **Naam Soojh**';

  it('Latin names for Hindi-script screens are unjudgeable, never "not on the screen"', () => {
    const source = "export const TABS = ['लेखन सहायक', 'मेरी कहानियाँ', 'लेखन शैली', 'किरदार', 'अध्याय', 'नाम सूझ'];";
    expect(auditSummaryClaims(SUMMARY, { sourceText: source } as never).filter((c) => c.kind === 'ui-described')).toEqual([]);
  });

  it('the same invented labels against an all-Latin app are still caught', () => {
    const source = "export const TABS = ['Home', 'Settings', 'Profile', 'Inbox'];";
    expect(auditSummaryClaims(SUMMARY, { sourceText: source } as never).map((c) => c.kind)).toContain('ui-described');
  });
});
