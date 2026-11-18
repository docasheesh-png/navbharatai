// HOW A BUILD STARTS ITS OWN APP — npm when there is a package.json, or when the tree
// is not clearly a non-Node app; the framework start command only for a Spring Boot or
// Go tree that has its start file and no JS/TS app source.
//
// 🔴 THE DEFECT. A battle-royale-style map game was built into a Spring Boot workspace
// (pom.xml, no package.json). The fast lane still ran
// `npm install --no-audit --no-fund || … --legacy-peer-deps`, then `npm run dev`,
// then probed port 5173. The install failed ENOENT on package.json (exit 254), the
// release gate counted that as a build-breaking blocker of the APP, and a success
// verdict was flipped to not ok. The later platform preview path already knew better
// ("no package.json — nothing to run a dev server from") but never offered the
// Spring Boot start command the registry already lists (`mvn spring-boot:run` on 8080).
//
// 🔑 THE RULE. A package.json keeps today's Node path, byte for byte, including the
// port main would have used (`oneShotDevPort` with no registry fallback). npm is
// skipped only when the tree is clearly a non-Node app: a declared Spring Boot or Go
// app with its start file, and no JS/TS app source. Everything else — a JS/TS app or
// a Node framework missing its package.json, a nested package.json, a bare HTML page
// — keeps main's Node path, so a missing manifest stays a shipping defect (RED, ₹0).
// A bare HTML page is still not statically served (Q-2662). PURE.

import { buildBuildInstallCommand } from './sandbox/EngineerAI/actuators/devServerHost';
import { getFramework } from './FrameworkRegistry';

export type DevServerLaunchKind = 'npm' | 'framework' | 'none';

export interface DevServerLaunchInput {
  framework?: string;
  hasPackageJson: boolean;
  hasPomXml?: boolean;
  hasGoModule?: boolean;
  /** Frontend app entries / bundler configs, not Java static resources. */
  hasJsTsAppSource?: boolean;
  /** Port used for the Node path so existing one-shot / recipe ports stay in charge. */
  nodePort?: number;
}

export interface DevServerLaunchPlan {
  kind: DevServerLaunchKind;
  installCommand: string | null;
  startCommand: string | null;
  port: number | null;
  reason: string;
}

const DEFAULT_NODE_PORT = 5173;

function frameworkId(framework: string | undefined): string {
  return String(framework || '').trim().toLowerCase();
}

/**
 * Frontend app source or bundler config. Paths under a Java/Kotlin Maven tree
 * (`src/main/java`, `src/main/resources`, `src/test/…`) are not a JS app, even
 * when they include a static `.js` or `index.html`. PURE.
 */
export function isJsTsAppSourcePath(path: string): boolean {
  const p = String(path || '').replace(/\\/g, '/');
  if (/(^|\/)src\/(main|test)\/(java|resources|kotlin)\//.test(p)) return false;
  if (/(^|\/)(vite|vitest|next|nuxt|astro|svelte|webpack|rspack)\.config\.[cm]?[jt]s$/.test(p)) return true;
  if (/(^|\/)(angular\.json|svelte\.config\.[cm]?[jt]s)$/.test(p)) return true;
  if (/(^|\/)src\/App\.(t|j)sx$/.test(p)) return true;
  if (/(^|\/)src\/main\.(t|j)sx$/.test(p)) return true;
  if (/(^|\/)src\/index\.(t|j)sx$/.test(p)) return true;
  if (/(^|\/)src\/App\.vue$/.test(p)) return true;
  if (/(^|\/)src\/main\.ts$/.test(p)) return true;
  if (/(^|\/)(src|app|pages|components)\/.+\.(tsx|jsx)$/.test(p)) return true;
  if (/(^|\/)(src|app|pages|components)\/.+\.(mjs|cjs|mts|cts|ts|js|vue)$/.test(p)) return true;
  return false;
}

/** Paths that name a Maven or Go start file, a package.json, or JS/TS app source. Pure. */
export function startFilesFromPaths(paths: readonly string[]): {
  hasPackageJson: boolean;
  hasPomXml: boolean;
  hasGoModule: boolean;
  hasJsTsAppSource: boolean;
} {
  let hasPackageJson = false;
  let hasPomXml = false;
  let hasGoModule = false;
  let hasJsTsAppSource = false;
  for (const raw of paths) {
    const p = String(raw || '').replace(/\\/g, '/');
    if (/(^|\/)package\.json$/.test(p)) hasPackageJson = true;
    if (/(^|\/)pom\.xml$/.test(p)) hasPomXml = true;
    if (/(^|\/)go\.mod$/.test(p) || /(^|\/)main\.go$/.test(p)) hasGoModule = true;
    if (isJsTsAppSourcePath(p)) hasJsTsAppSource = true;
  }
  return { hasPackageJson, hasPomXml, hasGoModule, hasJsTsAppSource };
}

/**
 * True only when the tree is clearly a non-Node app: the declared Spring Boot or
 * Go framework, its start file, no package.json, and no JS/TS app source. PURE.
 */
export function isClearlyNonNodeApp(input: DevServerLaunchInput): boolean {
  if (input.hasPackageJson) return false;
  if (input.hasJsTsAppSource) return false;
  const id = frameworkId(input.framework);
  if (id === 'spring-boot' && input.hasPomXml) return true;
  if (id === 'go' && input.hasGoModule) return true;
  return false;
}

function npmPlan(input: DevServerLaunchInput, reason: string): DevServerLaunchPlan {
  return {
    kind: 'npm',
    installCommand: buildBuildInstallCommand(),
    startCommand: 'npm run dev',
    port: Number.isInteger(input.nodePort) && (input.nodePort as number) > 0
      ? (input.nodePort as number)
      : DEFAULT_NODE_PORT,
    reason,
  };
}

export function devServerLaunchPlan(input: DevServerLaunchInput): DevServerLaunchPlan {
  if (input.hasPackageJson) {
    return npmPlan(input, 'package.json is present — install dependencies and start the Node dev server');
  }
  if (isClearlyNonNodeApp(input)) {
    const id = frameworkId(input.framework);
    if (id === 'spring-boot') {
      const meta = getFramework('spring-boot');
      return {
        kind: 'framework',
        installCommand: null,
        startCommand: meta?.startCommand ?? 'mvn spring-boot:run',
        port: meta?.devPort ?? 8080,
        reason: 'Spring Boot project with pom.xml — start with Maven, not npm',
      };
    }
    const meta = getFramework('go');
    return {
      kind: 'framework',
      installCommand: null,
      startCommand: meta?.startCommand ?? 'go run main.go',
      port: meta?.devPort ?? 8080,
      reason: 'Go project with a module or main file — start with go run, not npm',
    };
  }
  // Missing package.json, but not clearly a non-Node app: keep main's Node path
  // so the failed install remains a shipping defect (RED, ₹0).
  return npmPlan(input, 'no package.json on a Node or unknown tree — keep the Node install so a missing manifest stays a defect');
}

/**
 * The port a non-Node start command should be probed on, or null when the command
 * is not a known Spring Boot / Go launch. An explicit `--port` / `PORT=` on the
 * command is the caller's job and must win. PURE.
 */
export function fullstackDevPort(command: string): number | null {
  const cmd = String(command || '');
  if (/\bmvn\b[^\n]*\bspring-boot:run\b|\bspring-boot:run\b/.test(cmd)) return 8080;
  if (/(?:^|[\s;|&])go\s+run\b/.test(cmd)) return 8080;
  return null;
}

/**
 * True when `npm install` failed only because a clearly non-Node tree has no
 * package.json, and the tree itself has no package.json anywhere (including a
 * nested frontend/package.json). The error text alone is not enough: a JS/TS
 * app, a Node framework, or a tree that has a package.json keeps the failure.
 * Without tree evidence the exclusion does not fire (main's behaviour). PURE.
 */
export function isNpmInstallWithoutPackageJson(
  command: string,
  stdout?: string,
  stderr?: string,
  tree?: DevServerLaunchInput | null,
): boolean {
  if (!tree || tree.hasPackageJson || tree.hasJsTsAppSource || !isClearlyNonNodeApp(tree)) return false;
  if (!/\bnpm\s+install\b/.test(command || '')) return false;
  const out = `${stdout || ''}\n${stderr || ''}`;
  if (!/enoent/i.test(out) || !/package\.json/i.test(out)) return false;
  return /no such file or directory|could not read package\.json/i.test(out);
}

/**
 * True when a Spring Boot / Go start failed only because the sandbox image does
 * not have Maven or Go. That is infrastructure, not a defect in the app's code.
 * A compile error from a present Maven/Go remains a failure. PURE.
 */
export function isMissingStartToolchain(command: string, stdout?: string, stderr?: string): boolean {
  const cmd = command || '';
  const out = `${stdout || ''}\n${stderr || ''}`;
  if (/\bmvn\b/.test(cmd) && /(?:^|[\s/'"`])mvn(?:\b|:)[^\n]{0,40}(?:not found|command not found|No such file or directory)/im.test(out)) return true;
  if (/(?:^|[\s;|&])go\s+run\b/.test(cmd) && /(?:^|[\s/'"`])go(?:\b|:)[^\n]{0,40}(?:not found|command not found|No such file or directory)/im.test(out)) return true;
  return false;
}
