// AgentV3 — Backend-presence detector (Task #64, honest full-stack preview state).
//
// The in-browser preview (src/server/runtime/renderPreview.ts) compiles only a React/Vue/static
// FRONTEND into a self-contained srcDoc. If the built app also has a backend (an Express/Fastify API,
// a Prisma database, a Python server, or defined HTTP routes), the preview silently shows a frontend
// whose API calls all fail — the app "looks broken" for a reason the user can't see. This module
// derives, deterministically from the workspace files, whether the app HAS a backend the in-browser
// preview cannot run, so the UI can show an HONEST "this app needs a Live server" banner instead of a
// silently-broken preview.
//
// PURE & dependency-light: parses package.json + scans file paths/content with the same signals already
// proven in ProjectSummary.detectStack and apiGraph.extractEndpoints. No I/O; fully unit-testable.
// It answers the APP-level axis ("does THIS app need a server?") — orthogonal to PreviewHealth's
// deployment-level axis ("is a live server available HERE?").

import { extractEndpoints } from './apiGraph';

export interface BackendPresence {
  /** True when the built app includes a backend the in-browser (frontend-only) preview cannot run. */
  hasBackend: boolean;
  /** Short, honest, user-facing reason (English) — e.g. "a Node/Express API and a database". Empty when none. */
  reason: string;
}

const NODE_BACKEND_DEPS = ['express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', 'hapi', 'apollo-server'];
const PY_BACKEND_MARKERS = ['fastapi', 'flask', 'django', 'uvicorn', 'gunicorn'];
const CODE_FILE = /\.(t|j)sx?$/;

function parseDeps(pkgRaw: string | undefined): Set<string> {
  if (typeof pkgRaw !== 'string') return new Set();
  try {
    const pkg = JSON.parse(pkgRaw);
    if (!pkg || typeof pkg !== 'object') return new Set();
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ];
    return new Set(names);
  } catch {
    return new Set();
  }
}

/**
 * Detect whether the app has a backend the frontend-only preview can't run. Pure & deterministic.
 * Any ONE signal is sufficient; the reason names the concrete pieces found (most specific first).
 */
export function detectBackendPresence(files: Record<string, string>): BackendPresence {
  const none: BackendPresence = { hasBackend: false, reason: '' };
  if (!files || typeof files !== 'object') return none;

  const paths = Object.keys(files);
  const deps = parseDeps(files['package.json']);
  const reasons: string[] = [];

  // 1. A Node backend framework in the dependencies (the separate API server case).
  const nodeHit = NODE_BACKEND_DEPS.find((d) => deps.has(d));
  if (nodeHit) reasons.push('a Node/Express-style API server');

  // 2. A Prisma database (schema.prisma anywhere in the tree).
  const hasPrisma = paths.some((p) => p.toLowerCase().endsWith('schema.prisma'));
  if (hasPrisma) reasons.push('a database');

  // 3. A Python backend — a requirements.txt / pyproject listing a server framework, or a .py file that
  //    imports one. (Python deps aren't in package.json, so scan the python manifests + sources.)
  const pyFiles = paths.filter((p) => p.toLowerCase().endsWith('.py'));
  const pyManifests = paths.filter((p) => {
    const b = p.toLowerCase();
    return b.endsWith('requirements.txt') || b.endsWith('pyproject.toml') || b.endsWith('pipfile');
  });
  const pyText = [...pyManifests, ...pyFiles]
    .map((p) => (typeof files[p] === 'string' ? files[p].toLowerCase() : ''))
    .join('\n');
  const hasPyBackend = pyFiles.length > 0 && PY_BACKEND_MARKERS.some((m) => pyText.includes(m));
  if (hasPyBackend) reasons.push('a Python server');

  // 4. Defined HTTP route endpoints (reuse apiGraph's pure extractor over the code files). This catches
  //    a backend even when the dependency signal is missing (e.g. a hand-rolled route file).
  if (reasons.length === 0) {
    const codeFiles = paths
      .filter((p) => CODE_FILE.test(p) && typeof files[p] === 'string')
      .map((p) => ({ path: p, content: files[p] }));
    if (extractEndpoints(codeFiles).length > 0) reasons.push('server API routes');
  }

  if (reasons.length === 0) return none;
  return { hasBackend: true, reason: reasons.join(' and ') };
}
