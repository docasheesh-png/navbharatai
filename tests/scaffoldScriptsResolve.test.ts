/**
 * A SCAFFOLD MAY NOT SHIP A SCRIPT THAT POINTS AT A FILE IT DOES NOT SHIP.
 *
 * THE USER BUILD THIS CATCHES (2026-08-23, "Make an VPN App"). The vite-react provider's package.json
 * runs `tsc -p tsconfig.build.json && vite build`. The config was EXPORTED by the template module and
 * never written into the file set, so `npm run build` died instantly on every app the provider made:
 *
 *     error TS5058: The specified path does not exist: 'tsconfig.build.json'.
 *
 * The builder then "repaired" it with `cp tsconfig.json tsconfig.build.json` — not the same config —
 * which produced 96,610 characters of new type errors on an app whose preview was ALREADY rendering
 * correctly. A one-line omission, and the user watched an 18-minute avalanche.
 *
 * Nothing caught it because the dev server never runs the build script: `npm run dev` transpiles with
 * esbuild and does not read tsconfig.build.json at all. So the gap was invisible in every preview and
 * only appeared at the one moment it mattered.
 */
import { describe, it, expect } from 'vitest';
import { ViteReactProvider } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProvider';
import { goldenBaseFiles } from '../src/server/AgentV3/goldenScaffolds/base';

/** Every path a package.json's scripts point at with `tsc -p <path>` / `--project <path>`. */
export function tsconfigsReferencedByScripts(packageJsonText: string): string[] {
  let scripts: Record<string, string> = {};
  try { scripts = (JSON.parse(packageJsonText)?.scripts ?? {}) as Record<string, string>; } catch { return []; }
  const out = new Set<string>();
  for (const cmd of Object.values(scripts)) {
    for (const m of String(cmd).matchAll(/(?:-p|--project)\s+([^\s&|;]+)/g)) out.add(m[1]);
  }
  return [...out];
}

const fileSets: Array<{ name: string; files: Record<string, string> }> = [
  { name: 'ViteReactProvider', files: new ViteReactProvider().getFiles([]) },
  { name: 'goldenBaseFiles', files: goldenBaseFiles('Test', 'export default function App() { return null; }') },
];

describe('every scaffold ships the files its own scripts reference', () => {
  it('found scaffolds to check — the sweep is not vacuously passing', () => {
    expect(fileSets.length).toBeGreaterThan(0);
    for (const s of fileSets) expect(Object.keys(s.files).length, s.name).toBeGreaterThan(3);
  });

  for (const { name, files } of fileSets) {
    it(`${name}: every tsconfig its scripts name is present`, () => {
      const pkg = files['package.json'];
      expect(pkg, `${name} has no package.json`).toBeTruthy();
      const referenced = tsconfigsReferencedByScripts(pkg);
      const missing = referenced.filter((p) => !(p in files));
      expect(
        missing,
        `${name}'s scripts run "tsc -p <file>" on these, but the scaffold never writes them — `
        + 'npm run build will fail with TS5058 on every app it makes.',
      ).toEqual([]);
    });
  }

  it('the check actually bites — a scaffold missing its referenced config FAILS', () => {
    // A guard nobody has seen fail is just a comment.
    const broken = { 'package.json': JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json && vite build' } }) };
    const referenced = tsconfigsReferencedByScripts(broken['package.json']);
    expect(referenced).toEqual(['tsconfig.build.json']);
    expect(referenced.filter((p) => !(p in broken))).toEqual(['tsconfig.build.json']);
  });
});

describe('the provided ErrorBoundary is not something the builder should rewrite', () => {
  const files = new ViteReactProvider().getFiles([]);

  it('extends React.Component — the ONE thing that types this.state/setState/props', () => {
    // The user's build lost this clause and then spent seven minutes on
    // "Property 'setState' does not exist on type 'ErrorBoundary'", rewriting the file three more
    // times without ever restoring it.
    expect(files['src/ErrorBoundary.tsx']).toMatch(/class ErrorBoundary extends React\.Component<Props, State>/);
  });

  it('says so at the top, so a rewrite is a deliberate act rather than an accident', () => {
    expect(files['src/ErrorBoundary.tsx']).toMatch(/PROVIDED AND CORRECT — do not rewrite/);
  });
});
