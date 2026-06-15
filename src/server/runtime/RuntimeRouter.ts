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
  framework: 'vite' | 'next' | 'cra' | 'node' | 'static' | 'unknown';
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

  // Framework detection
  let framework: ProjectProfile['framework'] = 'unknown';
  if (depSet.has('next')) framework = 'next';
  else if (depSet.has('vite')) framework = 'vite';
  else if (depSet.has('react-scripts')) framework = 'cra';
  else if (hasPackageJson && (depSet.has('express') || depSet.has('koa') || depSet.has('fastify') || depSet.has('@nestjs/core'))) framework = 'node';
  else if (!hasPackageJson) framework = 'static';

  const needsNodeServer =
    framework === 'next' || framework === 'node' ||
    SERVER_DEP_HINTS.some(h => depSet.has(h));

  // Static = no package.json (or no build/start scripts) and has an index.html
  const hasIndexHtml = vfs.has('index.html') || vfs.has('public/index.html');
  const isStatic = !hasPackageJson && hasIndexHtml;

  return { hasPackageJson, framework, needsNodeServer, isStatic, dependencies, scripts };
}

/** Pick the runtime backend for a profiled project. */
export function chooseRuntime(profile: ProjectProfile): RuntimeTarget {
  if (profile.isStatic || (!profile.hasPackageJson && profile.framework === 'static')) return 'static';
  if (profile.needsNodeServer) return 'server-container';
  // Has package.json + build tooling but no persistent server → browser WebContainer.
  return 'webcontainer';
}

/** Convenience: analyze + choose in one call. */
export function routeRuntime(vfs: VirtualFileSystem): { profile: ProjectProfile; target: RuntimeTarget } {
  const profile = analyzeProject(vfs);
  return { profile, target: chooseRuntime(profile) };
}
