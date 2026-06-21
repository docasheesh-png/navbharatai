/**
 * Phase 3 — Hybrid runtime router.
 *
 * Given a project's Virtual File System, decide WHERE/HOW to run its live preview:
 *   - 'static'          : pure HTML/CSS/JS (no build step) → serve directly / iframe srcdoc.
 *   - 'webcontainer'    : frontend build (Vite/CRA/Next-static) with npm deps but no
 *                         long-running server → run in-browser via StackBlitz WebContainer
 *                         (fast, cheap, no server cost).
 *   - 'server-container': needs a real Node/SSR/DB backend (Express/Next server/Nest/etc.)
 *                         → run in a server-side container (Cloud Run/Firecracker/Docker).
 *
 * This is the pure decision layer. The concrete runtimes implement `PreviewRuntime`
 * and are selected by `chooseRuntime`. No side effects here — trivially testable.
 */
import { VirtualFileSystem } from '../project/ProjectModel';

export type RuntimeTarget = 'static' | 'webcontainer' | 'server-container';

export interface ProjectProfile {
  hasPackageJson: boolean;
  framework: 'vite' | 'next' | 'cra' | 'node' | 'static' | 'python' | 'go' | 'rust' | 'java' | 'php' | 'ruby' | 'unknown';
  /** Needs a persistent server process (Express/Next SSR/etc.). */
  needsNodeServer: boolean;
  /** Pure static site (html/css/js, no build). */
  isStatic: boolean;
  dependencies: string[];
  scripts: Record<string, string>;
}

/** Runtime-agnostic preview handle implemented by each backend (web/server). */
export interface PreviewRuntime {
  readonly target: RuntimeTarget;
  start(projectId: string, vfs: VirtualFileSystem): Promise<{ url: string; sessionId: string }>;
  stop(sessionId: string): Promise<void>;
  status(sessionId: string): Promise<'starting' | 'ready' | 'stopped' | 'error'>;
}

const SERVER_DEP_HINTS = [
  'express', 'koa', 'fastify', '@nestjs/core', 'next', 'hapi', 'socket.io',
  'mongoose', 'pg', 'mysql', 'mysql2', 'sqlite3', 'prisma', '@prisma/client',
  'http-server', 'ws',
];

function safeParseJson(text: string | undefined): any {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Inspect the VFS and produce a structural profile of the project. */
export function analyzeProject(vfs: VirtualFileSystem): ProjectProfile {
  const pkg = safeParseJson(vfs.readText('package.json'));
  const hasPackageJson = !!pkg;
  const deps: Record<string, string> = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const dependencies = Object.keys(deps);
  const scripts: Record<string, string> = pkg?.scripts || {};
  const depSet = new Set(dependencies.map(d => d.toLowerCase()));

  // Framework detection (Node/JS first, then other languages by file presence)
  let framework: ProjectProfile['framework'] = 'unknown';
  if (depSet.has('next')) framework = 'next';
  else if (depSet.has('vite')) framework = 'vite';
  else if (depSet.has('react-scripts')) framework = 'cra';
  else if (hasPackageJson && (depSet.has('express') || depSet.has('koa') || depSet.has('fastify') || depSet.has('@nestjs/core'))) framework = 'node';
  else if (!hasPackageJson) {
    // Detect non-JS languages by characteristic files
    if (vfs.has('requirements.txt') || vfs.has('main.py') || vfs.has('app.py') || vfs.has('manage.py')) framework = 'python';
    else if (vfs.has('go.mod') || vfs.has('main.go')) framework = 'go';
    else if (vfs.has('Cargo.toml') || vfs.has('src/main.rs')) framework = 'rust';
    else if (vfs.has('pom.xml') || vfs.has('build.gradle') || vfs.has('src/main/java')) framework = 'java';
    else if (vfs.has('composer.json') || vfs.has('index.php') || vfs.has('artisan')) framework = 'php';
    else if (vfs.has('Gemfile') || vfs.has('config/routes.rb') || vfs.has('app.rb')) framework = 'ruby';
    else framework = 'static';
  }

  const needsNodeServer =
    framework === 'next' || framework === 'node' ||
    framework === 'python' || framework === 'go' ||
    framework === 'rust' || framework === 'java' ||
    framework === 'php' || framework === 'ruby' ||
    SERVER_DEP_HINTS.some(h => depSet.has(h));

  // Static = no package.json (or no build/start scripts) and has an index.html
  const hasIndexHtml = vfs.has('index.html') || vfs.has('public/index.html');
  const isStatic = !hasPackageJson && hasIndexHtml && framework === 'static';

  return { hasPackageJson, framework, needsNodeServer, isStatic, dependencies, scripts };
}

/** Pick the runtime backend for a profiled project. */
export function chooseRuntime(profile: ProjectProfile): RuntimeTarget {
  if (profile.isStatic || (!profile.hasPackageJson && profile.framework === 'static')) return 'static';
  // Non-JS server languages always need a real container (can't run in browser).
  if (['python', 'go', 'rust', 'java', 'php', 'ruby'].includes(profile.framework)) return 'server-container';
  // BUG C1 FIX: Projects with no package.json (data files, plain HTML, CSV/JSON) should be
  // 'static' — previously they fell through to 'webcontainer' with no benefit.
  if (!profile.hasPackageJson) return 'static';
  if (profile.needsNodeServer) return 'server-container';
  // Frontend build (Vite/CRA) with no persistent server → bundle in-browser as a
  // self-contained static preview (React via Babel-standalone). No external infra.
  if (profile.framework === 'vite' || profile.framework === 'cra') return 'static';
  // Other package.json frontends → browser WebContainer (adapter pending).
  return 'webcontainer';
}

/** Convenience: analyze + choose in one call. */
export function routeRuntime(vfs: VirtualFileSystem): { profile: ProjectProfile; target: RuntimeTarget } {
  const profile = analyzeProject(vfs);
  return { profile, target: chooseRuntime(profile) };
}
