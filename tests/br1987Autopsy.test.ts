/** Synthetic non-Node preview / install regression cases. No customer report payload.
 * A clearly non-Node Spring Boot (or Go) app — start file present, no JS/TS app
 * source, no package.json — must not be installed or started with npm, and an
 * npm ENOENT on that tree must not be counted as a defect of the app.
 * A package.json keeps main's Node path, including the port main would use.
 * A JS/TS app or Node framework missing package.json keeps main's npm install,
 * typecheck, RED release gate, and ₹0 bill.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  devServerLaunchPlan,
  startFilesFromPaths,
  fullstackDevPort,
  isNpmInstallWithoutPackageJson,
  isMissingStartToolchain,
  isClearlyNonNodeApp,
  isJsTsAppSourcePath,
} from '../src/server/AgentV3/devServerLaunchPlan';
import { shouldAttemptPlatformPreview } from '../src/server/AgentV3/deliveryProof';
import { oneShotDevPort, zeroBillForFailedBuild } from '../src/server/routes/agentv3';
import { FRAMEWORKS } from '../src/server/AgentV3/FrameworkRegistry';
import { buildDepsStaleCheckCommand, isLongRunningCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { releaseGate } from '../src/server/AgentV3/releaseGate';
import { continueFastLaneGeneration } from '../src/server/AgentV3/FastLaneContinuation';
import { buildBuildInstallCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

const INSTALL = 'npm install --no-audit --no-fund || npm install --no-audit --no-fund --legacy-peer-deps';
const ENOENT = [
  'npm error code ENOENT',
  'npm error syscall open',
  'npm error path /home/user/workspace/package.json',
  'npm error errno -2',
  'npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open \'/home/user/workspace/package.json\'',
].join('\n');

/** Byte-for-byte copy of main's `oneShotDevPort` (no registry fallback). */
function mainOneShotDevPort(framework: string): number {
  if (/next|nuxt|nest|express|fastify|node/i.test(framework)) return 3000;
  if (/angular/i.test(framework)) return 4200;
  if (/astro/i.test(framework)) return 4321;
  if (/static|vanilla/i.test(framework)) return 3000;
  if (/fastapi|flask|django|python/i.test(framework)) return 8000;
  return 5173;
}

const SPRING_TREE = {
  framework: 'spring-boot' as const,
  hasPackageJson: false,
  hasPomXml: true,
  hasJsTsAppSource: false,
};

const previewBase = {
  expectsArtifacts: true, hasPreviewUrl: false, aborted: false, isImportTurn: false,
  appFiles: 16, hasPackageJson: true, remainingMs: 20 * 60_000, env: {} as NodeJS.ProcessEnv,
};

describe('devServerLaunchPlan — Node, Spring Boot, Go, and bare pages', () => {
  it('a Vite / Node tree with package.json still installs and runs npm run dev on the given port', () => {
    const plan = devServerLaunchPlan({
      framework: 'vite-react',
      hasPackageJson: true,
      hasPomXml: false,
      nodePort: 5173,
    });
    expect(plan.kind).toBe('npm');
    expect(plan.installCommand).toBe(buildBuildInstallCommand());
    expect(plan.installCommand).toBe(INSTALL);
    expect(plan.startCommand).toBe('npm run dev');
    expect(plan.port).toBe(5173);
  });

  it('a Next.js app with package.json is still the Node path, even if a pom.xml is also present', () => {
    const plan = devServerLaunchPlan({
      framework: 'nextjs',
      hasPackageJson: true,
      hasPomXml: true,
      nodePort: 3000,
    });
    expect(plan.kind).toBe('npm');
    expect(plan.startCommand).toBe('npm run dev');
    expect(plan.port).toBe(3000);
  });

  it('a Spring Boot app with pom.xml and no package.json starts with Maven on 8080, not npm', () => {
    const plan = devServerLaunchPlan({
      framework: 'spring-boot',
      ...startFilesFromPaths([
        'pom.xml',
        'src/main/java/com/example/demo/Application.java',
        'src/main/resources/static/js/map.js',
        'src/main/resources/static/index.html',
      ]),
    });
    expect(startFilesFromPaths([
      'pom.xml',
      'src/main/java/com/example/demo/Application.java',
      'src/main/resources/static/js/map.js',
      'src/main/resources/static/index.html',
    ]).hasPackageJson).toBe(false);
    expect(plan.kind).toBe('framework');
    expect(plan.installCommand).toBeNull();
    expect(plan.startCommand).toBe('mvn spring-boot:run');
    expect(plan.port).toBe(8080);
    expect(plan.reason).toMatch(/Maven/i);
  });

  it('a Spring Boot label without a POM does not invent a Maven start, and keeps main\'s Node path', () => {
    const plan = devServerLaunchPlan({
      framework: 'spring-boot',
      hasPackageJson: false,
      hasPomXml: false,
      nodePort: oneShotDevPort('spring-boot'),
    });
    expect(plan.kind).toBe('npm');
    expect(plan.startCommand).toBe('npm run dev');
    expect(plan.installCommand).toBe(buildBuildInstallCommand());
    expect(plan.port).toBe(5173);
  });

  it('a Spring Boot or Go app that also has package.json keeps main\'s Node port, not 8080', () => {
    const spring = devServerLaunchPlan({
      framework: 'spring-boot',
      hasPackageJson: true,
      hasPomXml: true,
      nodePort: oneShotDevPort('spring-boot'),
    });
    expect(spring.kind).toBe('npm');
    expect(spring.startCommand).toBe('npm run dev');
    expect(spring.installCommand).toBe(buildBuildInstallCommand());
    expect(spring.port).toBe(5173);
    expect(spring.port).toBe(mainOneShotDevPort('spring-boot'));

    const go = devServerLaunchPlan({
      framework: 'go',
      hasPackageJson: true,
      hasGoModule: true,
      nodePort: oneShotDevPort('go'),
    });
    expect(go.kind).toBe('npm');
    expect(go.startCommand).toBe('npm run dev');
    expect(go.installCommand).toBe(buildBuildInstallCommand());
    expect(go.port).toBe(5173);
    expect(go.port).toBe(mainOneShotDevPort('go'));
  });

  it('the npm plan matches main\'s Node path for every registered framework', () => {
    for (const fw of FRAMEWORKS) {
      const nodePort = mainOneShotDevPort(fw.id);
      const plan = devServerLaunchPlan({
        framework: fw.id,
        hasPackageJson: true,
        hasPomXml: fw.id === 'spring-boot',
        hasGoModule: fw.id === 'go',
        nodePort,
      });
      expect(plan.kind, fw.id).toBe('npm');
      expect(plan.installCommand, fw.id).toBe(buildBuildInstallCommand());
      expect(plan.startCommand, fw.id).toBe('npm run dev');
      expect(plan.port, fw.id).toBe(nodePort);
      expect(oneShotDevPort(fw.id), fw.id).toBe(nodePort);
    }
  });

  it('a Vite app with src/App.tsx and index.html but no package.json keeps main\'s npm path', () => {
    const files = startFilesFromPaths(['src/App.tsx', 'index.html', 'src/main.tsx']);
    expect(files.hasPackageJson).toBe(false);
    expect(files.hasJsTsAppSource).toBe(true);
    const plan = devServerLaunchPlan({
      framework: 'vite-react',
      ...files,
      nodePort: oneShotDevPort('vite-react'),
    });
    expect(plan.kind).toBe('npm');
    expect(plan.installCommand).toBe(buildBuildInstallCommand());
    expect(plan.startCommand).toBe('npm run dev');
    expect(plan.port).toBe(5173);
  });

  it('a Go app with go.mod and no package.json starts with go run on 8080', () => {
    const plan = devServerLaunchPlan({
      framework: 'go',
      ...startFilesFromPaths(['go.mod', 'main.go', 'handlers.go']),
    });
    expect(plan.kind).toBe('framework');
    expect(plan.installCommand).toBeNull();
    expect(plan.startCommand).toBe('go run main.go');
    expect(plan.port).toBe(8080);
  });

  it('a bare HTML page with no package.json keeps main\'s Node install; platform preview still skips (Q-2662)', () => {
    const plan = devServerLaunchPlan({
      framework: 'static',
      ...startFilesFromPaths(['index.html', 'styles.css', 'app.js']),
      nodePort: oneShotDevPort('static'),
    });
    expect(plan.kind).toBe('npm');
    expect(plan.startCommand).toBe('npm run dev');
    expect(plan.port).toBe(3000);
  });

  it('Java static JS under src/main/resources is not JS/TS app source, so a Spring starter stays on Maven', () => {
    const files = startFilesFromPaths([
      'pom.xml',
      'src/main/java/com/example/demo/Application.java',
      'src/main/resources/static/js/map.js',
      'src/main/resources/static/index.html',
    ]);
    expect(files.hasJsTsAppSource).toBe(false);
    expect(isJsTsAppSourcePath('src/main/resources/static/js/map.js')).toBe(false);
    expect(isJsTsAppSourcePath('src/App.tsx')).toBe(true);
    expect(isClearlyNonNodeApp({ framework: 'spring-boot', ...files })).toBe(true);
  });

  it('English and Hindi battle-royale map-game file lists with only a Spring Boot starter stay on Maven', () => {
    const files = [
      'pom.xml',
      'src/main/java/com/example/demo/Application.java',
      'src/main/java/com/example/demo/HelloController.java',
      'src/main/resources/application.properties',
      'src/main/resources/static/index.html',
      'src/main/resources/static/js/map.js',
    ];
    for (const framework of ['spring-boot']) {
      const plan = devServerLaunchPlan({ framework, ...startFilesFromPaths(files) });
      expect(plan.kind, framework).toBe('framework');
      expect(plan.startCommand).toBe('mvn spring-boot:run');
    }
  });
});

describe('shouldAttemptPlatformPreview — same rule, including opposite neighbours', () => {
  it('still attempts a Node app that has package.json', () => {
    expect(shouldAttemptPlatformPreview(previewBase).attempt).toBe(true);
  });

  it('still stands down for a bare page with no package.json and no Spring/Go start file', () => {
    const d = shouldAttemptPlatformPreview({ ...previewBase, hasPackageJson: false });
    expect(d.attempt).toBe(false);
    expect(d.reason).toMatch(/no package\.json/i);
  });

  it('stands down for a Vite tree that has app source but no package.json (Q-2662 / main)', () => {
    const d = shouldAttemptPlatformPreview({
      ...previewBase,
      hasPackageJson: false,
      framework: 'vite-react',
      hasJsTsAppSource: true,
    });
    expect(d.attempt).toBe(false);
    expect(d.reason).toMatch(/no package\.json/i);
  });

  it('does attempt a Spring Boot app that has a POM and no package.json', () => {
    const d = shouldAttemptPlatformPreview({
      ...previewBase,
      hasPackageJson: false,
      framework: 'spring-boot',
      hasPomXml: true,
    });
    expect(d.attempt).toBe(true);
  });

  it('does not treat a Vite app as Maven just because the word spring appears in a path list we never passed', () => {
    const d = shouldAttemptPlatformPreview({
      ...previewBase,
      hasPackageJson: true,
      framework: 'vite-react',
      hasPomXml: false,
    });
    expect(d.attempt).toBe(true);
  });
});

describe('oneShotDevPort and launch-command ports', () => {
  it('oneShotDevPort matches main, including Spring Boot and Go falling through to 5173', () => {
    expect(oneShotDevPort('spring-boot')).toBe(5173);
    expect(oneShotDevPort('go')).toBe(5173);
    expect(oneShotDevPort('vite-react')).toBe(5173);
    expect(oneShotDevPort('vue')).toBe(5173);
    expect(oneShotDevPort('flask')).toBe(8000);
    expect(oneShotDevPort('python-fastapi')).toBe(8000);
    expect(oneShotDevPort('nextjs')).toBe(3000);
  });

  it('fullstackDevPort reads Maven and Go launches, and leaves npm / Vite / Flask alone', () => {
    expect(fullstackDevPort('mvn spring-boot:run')).toBe(8080);
    expect(fullstackDevPort('mvn -q spring-boot:run')).toBe(8080);
    expect(fullstackDevPort('go run main.go')).toBe(8080);
    expect(fullstackDevPort('npm run dev')).toBeNull();
    expect(fullstackDevPort('npx vite --port 5173')).toBeNull();
    expect(fullstackDevPort('flask run')).toBeNull();
    expect(fullstackDevPort('go test ./...')).toBeNull();
    expect(fullstackDevPort('mvn package')).toBeNull();
  });
});

describe('isLongRunningCommand — Maven and Go servers, not one-shot builds', () => {
  it('treats mvn spring-boot:run and go run as long-running servers', () => {
    expect(isLongRunningCommand('mvn spring-boot:run')).toBe(true);
    expect(isLongRunningCommand('mvn -q spring-boot:run')).toBe(true);
    expect(isLongRunningCommand('go run main.go')).toBe(true);
  });

  it('does not treat go test, go build, or mvn package as servers', () => {
    expect(isLongRunningCommand('go test ./...')).toBe(false);
    expect(isLongRunningCommand('go build ./...')).toBe(false);
    expect(isLongRunningCommand('mvn package')).toBe(false);
    expect(isLongRunningCommand('mvn test')).toBe(false);
    expect(isLongRunningCommand('npm run dev')).toBe(true);
  });
});

describe('buildDepsStaleCheckCommand — no package.json is not STALE', () => {
  it('a directory with no package.json does not print STALE, even if a node_modules folder exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'br1987-stale-'));
    try {
      mkdirSync(join(root, 'node_modules'));
      const out = execSync(buildDepsStaleCheckCommand(), { cwd: root, encoding: 'utf8' });
      expect(out).not.toMatch(/STALE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a Node tree whose package.json is newer than node_modules still prints STALE', () => {
    const root = mkdtempSync(join(tmpdir(), 'br1987-stale-node-'));
    try {
      mkdirSync(join(root, 'node_modules'));
      execSync('touch -d "2020-01-01" node_modules', { cwd: root });
      writeFileSync(join(root, 'package.json'), '{"name":"app","private":true}');
      const out = execSync(buildDepsStaleCheckCommand(), { cwd: root, encoding: 'utf8' });
      expect(out).toMatch(/STALE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('npm install ENOENT without package.json is not an app-breaking blocker', () => {
  it('recognises the missing-manifest install only on a clearly non-Node tree, and ignores a real ERESOLVE on a Node project', () => {
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', ENOENT, SPRING_TREE)).toBe(true);
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', ENOENT)).toBe(false);
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', ENOENT, null)).toBe(false);
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', ENOENT, { ...SPRING_TREE, hasPackageJson: true })).toBe(false);
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', ENOENT, {
      framework: 'vite-react', hasPackageJson: false, hasJsTsAppSource: true,
    })).toBe(false);
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', ENOENT, {
      framework: 'vite-react', hasPackageJson: false, hasJsTsAppSource: false,
    })).toBe(false);
    expect(isNpmInstallWithoutPackageJson('npm install', 'added 0 packages', 'npm ERR! ERESOLVE could not resolve react@19', SPRING_TREE)).toBe(false);
    expect(isNpmInstallWithoutPackageJson('npm run build', '', ENOENT, SPRING_TREE)).toBe(false);
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', 'ENOENT: no such file or directory, open \'/home/user/workspace/src/missing.js\'', SPRING_TREE)).toBe(false);
  });

  it('a nested frontend/package.json is not excluded just because the error text mentions package.json', () => {
    const tree = startFilesFromPaths(['frontend/package.json', 'frontend/src/App.tsx', 'pom.xml']);
    expect(tree.hasPackageJson).toBe(true);
    expect(isNpmInstallWithoutPackageJson(INSTALL, '', ENOENT, { framework: 'spring-boot', ...tree })).toBe(false);
  });

  it('recordCommand files a clearly non-Node missing-manifest install as an info SANDBOX_CMD, not a shipping error', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.recordCommand({ command: INSTALL, exitCode: 254, stdout: '', stderr: ENOENT, durationMs: 2000, tree: SPRING_TREE });
    const report = d.report();
    const failed = report.issues.filter((i) => i.code === 'SANDBOX_CMD_FAILED');
    const recorded = report.issues.filter((i) => i.code === 'SANDBOX_CMD' || i.code === 'SANDBOX_CMD_FAILED');
    expect(failed).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].severity).toBe('info');
    expect(recorded[0].autoResolved).toBe(true);
    expect(d.shippingIssueCount('error')).toBe(0);
  });

  it('without tree evidence, the same npm ENOENT stays a shipping error (main)', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.recordCommand({ command: INSTALL, exitCode: 254, stdout: '', stderr: ENOENT, durationMs: 2000 });
    expect(d.report().issues.some((i) => i.code === 'SANDBOX_CMD_FAILED' && i.severity === 'error')).toBe(true);
    expect(d.shippingIssueCount('error')).toBe(1);
  });

  it('a JS app missing package.json stays a shipping defect, turns the gate RED, and bills ₹0, matching main', () => {
    const tree = {
      framework: 'vite-react',
      ...startFilesFromPaths(['src/App.tsx', 'index.html', 'src/main.tsx']),
    };
    expect(tree.hasPackageJson).toBe(false);
    expect(tree.hasJsTsAppSource).toBe(true);
    const d = new BuildDiagnostics({ now: () => 1 });
    d.setWorkspaceTree(tree);
    d.recordCommand({ command: INSTALL, exitCode: 254, stdout: '', stderr: ENOENT, durationMs: 2000 });
    expect(d.report().issues.some((i) => i.code === 'SANDBOX_CMD_FAILED' && i.severity === 'error')).toBe(true);
    expect(d.shippingIssueCount('error')).toBe(1);
    const gate = releaseGate(
      { preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'not-run', tests: 'not-run', buildOk: true },
      { blockers: d.shippingIssueCount('error'), highSeverity: 0, warnings: 0 },
    );
    expect(gate.state).toBe('red');
    const ok = gate.state !== 'red';
    expect(ok).toBe(false);
    expect(zeroBillForFailedBuild(ok)).toBe(true);
    expect(zeroBillForFailedBuild(false)).toBe(true);
    expect(zeroBillForFailedBuild(true)).toBe(false);
  });

  it('a real npm install failure on a Node project is still a shipping error, and still turns the gate red', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.recordCommand({
      command: INSTALL,
      exitCode: 1,
      stdout: 'added 0 packages',
      stderr: 'npm ERR! ERESOLVE could not resolve react@19',
      durationMs: 4200,
    });
    expect(d.report().issues.some((i) => i.code === 'SANDBOX_CMD_FAILED' && i.severity === 'error')).toBe(true);
    expect(d.shippingIssueCount('error')).toBe(1);
    const gate = releaseGate(
      { preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'not-run', tests: 'not-run', buildOk: true },
      { blockers: d.shippingIssueCount('error'), highSeverity: 0, warnings: 0 },
    );
    expect(gate.state).toBe('red');
  });

  it('a Spring Boot tree with no npm failure and no preview is UNKNOWN, not RED for a fake npm blocker', () => {
    const gate = releaseGate(
      { preview: 'not-run', pages: 'not-run', journeys: 'not-run', typecheck: 'not-run', tests: 'not-run', buildOk: true },
      { blockers: 0, highSeverity: 0, warnings: 0 },
    );
    expect(gate.state).toBe('unknown');
    expect(gate.headline).not.toMatch(/npm install/i);
  });
});

describe('fast-lane and platform preview wiring (census)', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('fastPreview decides the start command from devServerLaunchPlan, and still reconciles before npm run dev', () => {
    const previewStart = route.indexOf('const fastPreview = async ()');
    const body = route.slice(previewStart, route.indexOf('const fastVerify = async ()', previewStart));
    expect(body).toContain('devServerLaunchPlan');
    expect(body).toContain("id: 'fast-dev'");
    expect(body).toContain('launch.startCommand');
    const reconcileAt = body.indexOf("await fastReconcileDependencies('preview')");
    const devAt = body.indexOf("id: 'fast-dev'");
    expect(reconcileAt).toBeGreaterThan(0);
    expect(reconcileAt).toBeLessThan(devAt);
    expect(body).toContain('FASTLANE_PREVIEW_SKIPPED_NON_NODE');
  });

  it('fastVerifyOnce skips sandbox tsc only for a framework (Maven/Go) plan, and still reconciles before tsc on the Node path', () => {
    const verifyStart = route.indexOf('const fastVerifyOnce = async ()');
    const tscAt = route.indexOf('${TSC_BIN} --noEmit > /tmp/nb_tsc.log', verifyStart);
    const body = route.slice(verifyStart, tscAt + 80);
    expect(body).toContain("if (verifyLaunch.kind === 'framework')");
    const reconcileAt = route.indexOf("await fastReconcileDependencies('verify')", verifyStart);
    expect(reconcileAt).toBeGreaterThan(verifyStart);
    expect(reconcileAt).toBeLessThan(tscAt);
  });

  it('platform preview starts the planned command, not a hardcoded npm run dev only', () => {
    const at = route.indexOf("platform-preview-start");
    expect(at).toBeGreaterThan(0);
    const window = route.slice(at - 400, at + 80);
    expect(window).toContain('platformLaunch.startCommand');
    expect(window).not.toMatch(/runCommand\(workspaceId, 'npm run dev'\)/);
  });
});

describe('truncated binary tails are not continued as text', () => {
  const png = '<<<FILE src/main/resources/static/images/placeholder-map.png>>>\n89504e470d0a';
  const complete = '<<<FILE src/main/resources/static/js/map.js>>>\nexport function draw() {}\n<<<ENDFILE>>>\n';

  it('drops an unterminated PNG tail, keeps finished text files, and continues only for remaining text', async () => {
    let calls = 0;
    let prompt = '';
    const result = await continueFastLaneGeneration(
      { text: complete + png, stopReason: 'max_tokens' },
      { generate: async (p) => {
        calls++;
        prompt = p;
        return {
          text: '<<<FILE src/main/resources/static/js/controls.js>>>\nexport function pan() {}\n<<<ENDFILE>>>',
          stopReason: 'end_turn',
        };
      } },
    );
    expect(result.text).toContain('src/main/resources/static/js/map.js');
    expect(result.text).toContain('src/main/resources/static/js/controls.js');
    expect(result.text).not.toMatch(/placeholder-map\.png/);
    expect(prompt).not.toMatch(/placeholder-map\.png/);
    expect(calls).toBe(1);
    expect(result.continued).toBe(1);
  });

  it('still continues a truncated TypeScript file', async () => {
    let calls = 0;
    const result = await continueFastLaneGeneration(
      { text: '<<<FILE src/App.tsx>>>\nexport default function App() { return <div>He', stopReason: 'max_tokens' },
      { generate: async () => { calls++; return { text: 'llo</div>; }\n<<<ENDFILE>>>', stopReason: 'end_turn' }; } },
    );
    expect(calls).toBe(1);
    expect(result.text).toContain('Hello');
    expect(result.continued).toBe(1);
  });
});

describe('a missing Maven or Go binary is infrastructure, not an app blocker', () => {
  it('recognises command-not-found and leaves a real Maven compile error alone', () => {
    expect(isMissingStartToolchain('mvn spring-boot:run', '', 'bash: mvn: command not found')).toBe(true);
    expect(isMissingStartToolchain('go run main.go', '', 'go: command not found')).toBe(true);
    expect(isMissingStartToolchain('mvn spring-boot:run', '', '[ERROR] COMPILATION ERROR : cannot find symbol')).toBe(false);
    expect(isMissingStartToolchain('npm run dev', '', 'bash: mvn: command not found')).toBe(false);
  });

  it('recordCommand does not count a missing Maven as a shipping error', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.recordCommand({ command: 'mvn spring-boot:run', exitCode: 127, stdout: '', stderr: 'bash: mvn: command not found', durationMs: 80 });
    expect(d.report().issues.some((i) => i.code === 'SANDBOX_CMD_FAILED')).toBe(false);
    expect(d.shippingIssueCount('error')).toBe(0);
  });
});
