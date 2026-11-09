import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { restoreMutations } from './restoreMutationCensus.ts';

// Test-only protocol: parse source text, never import/evaluate a production module. An exception
// leaves no success response and exits nonzero; the parent retains every policy/body assertion.
const request = JSON.parse(readFileSync(0, 'utf8'));
if (!request || typeof request !== 'object' || Array.isArray(request)
  || !Array.isArray(request.paths) || request.paths.some((path) => typeof path !== 'string')
  || !request.snapshots || typeof request.snapshots !== 'object' || Array.isArray(request.snapshots)
  || Object.values(request.snapshots).some((text) => typeof text !== 'string')) {
  throw new Error('Invalid restore census request');
}
const routePath = 'src/server/routes/agentv3.ts';
const routeSnapshot = Object.hasOwn(request.snapshots, routePath) ? request.snapshots[routePath] : undefined;
// The existing census reuses this parented route AST. Recreate it from the same captured bytes.
const routeSource = routeSnapshot === undefined ? undefined
  : ts.createSourceFile('agentv3.ts', routeSnapshot, ts.ScriptTarget.Latest, true);
const files = request.paths.map((path) => {
  const text = Object.hasOwn(request.snapshots, path) ? request.snapshots[path] : readFileSync(path, 'utf8');
  return { path, mutations: restoreMutations(path, text, path === routePath ? routeSource : undefined) };
});
process.stdout.write(JSON.stringify({ version: 1, completed: true, files }));
