// HOW A BUILD STARTS ITS OWN APP — npm when there is a package.json, the framework
// start command for Spring Boot / Go, and never a Node install on a tree that has no
// package.json.
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
// 🔑 THE RULE. A package.json keeps today's Node path, byte for byte. A declared
// Spring Boot or Go app with its start file and no package.json uses that framework's
// start command and port. Everything else (including a bare HTML page — Q-2662) is
// skipped, not installed with npm. PURE.

import { buildBuildInstallCommand } from './sandbox/EngineerAI/actuators/devServerHost';
import { getFramework } from './FrameworkRegistry';

export type DevServerLaunchKind = 'npm' | 'framework' | 'none';

export interface DevServerLaunchInput {
  framework?: string;
  hasPackageJson: boolean;
  hasPomXml?: boolean;
  hasGoModule?: boolean;
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

/** Paths (and optional flags) that name a Maven or Go start file. Pure. */
export function startFilesFromPaths(paths: readonly string[]): { hasPackageJson: boolean; hasPomXml: boolean; hasGoModule: boolean } {
  let hasPackageJson = false;
  let hasPomXml = false;
  let hasGoModule = false;
  for (const raw of paths) {
    const p = String(raw || '').replace(/\\/g, '/');
    if (/(^|\/)package\.json$/.test(p)) hasPackageJson = true;
    if (/(^|\/)pom\.xml$/.test(p)) hasPomXml = true;
    if (/(^|\/)go\.mod$/.test(p) || /(^|\/)main\.go$/.test(p)) hasGoModule = true;
  }
  return { hasPackageJson, hasPomXml, hasGoModule };
}

export function devServerLaunchPlan(input: DevServerLaunchInput): DevServerLaunchPlan {
  if (input.hasPackageJson) {
    return {
      kind: 'npm',
      installCommand: buildBuildInstallCommand(),
      startCommand: 'npm run dev',
      port: Number.isInteger(input.nodePort) && (input.nodePort as number) > 0
        ? (input.nodePort as number)
        : DEFAULT_NODE_PORT,
      reason: 'package.json is present — install dependencies and start the Node dev server',
    };
  }
  const id = frameworkId(input.framework);
  if (id === 'spring-boot' && input.hasPomXml) {
    const meta = getFramework('spring-boot');
    return {
      kind: 'framework',
      installCommand: null,
      startCommand: meta?.startCommand ?? 'mvn spring-boot:run',
      port: meta?.devPort ?? 8080,
      reason: 'Spring Boot project with pom.xml — start with Maven, not npm',
    };
  }
  if (id === 'go' && input.hasGoModule) {
    const meta = getFramework('go');
    return {
      kind: 'framework',
      installCommand: null,
      startCommand: meta?.startCommand ?? 'go run main.go',
      port: meta?.devPort ?? 8080,
      reason: 'Go project with a module or main file — start with go run, not npm',
    };
  }
  return {
    kind: 'none',
    installCommand: null,
    startCommand: null,
    port: null,
    reason: 'no package.json — nothing to run a Node dev server from',
  };
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
 * True when `npm install` failed only because there was no package.json to install
 * into. A real install error on a Node project (ERESOLVE, a missing named package,
 * ENOENT for some other path) stays a failure. PURE.
 */
export function isNpmInstallWithoutPackageJson(
  command: string,
  stdout?: string,
  stderr?: string,
): boolean {
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
