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
import { TemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { goldenBaseFiles } from '../src/server/AgentV3/goldenScaffolds/base';

/** Every path a package.json's scripts point at with `tsc -p <path>` / `--project <path>`. */
export function tsconfigsReferencedByScripts(packageJsonText: string): string[] {
  let scripts: Record<string, string> = {};
  try { scripts = (JSON.parse(packageJsonText)?.scripts ?? {}) as Record<string, string>; } catch { return []; }
  const out = new Set<string>();
  for (const cmd of Object.values(scripts)) {
    // ⚠️ ONLY inside a command that actually runs `tsc`. `-p` is not a tsc-only flag: the static
    // scaffold serves with `… -p 3000`, and reading that as a project path made the widened sweep
    // report a missing file called "3000". That matters more than a stray failure — the first thing
    // anyone does with a guard that cries wolf is weaken it, which is exactly how the real bug gets
    // back in. Split on shell separators so `tsc -p a.json && serve -p 3000` checks the first and
    // ignores the second.
    for (const part of String(cmd).split(/&&|\|\||;|\|/)) {
      if (!/\btsc\b/.test(part)) continue;
      for (const m of part.matchAll(/(?:-p|--project)\s+([^\s&|;]+)/g)) out.add(m[1]);
    }
  }
  return [...out];
}

/**
 * Every scaffold the platform can build with, discovered from the registry rather than listed by hand.
 *
 * THIS IS THE POINT OF THE CHANGE (2026-09-04). The sweep below used to cover TWO file sets — the
 * vite-react provider and the golden base — out of the twenty-five the registry serves. The 2026-08-23
 * bug this file exists for shipped in a provider that happened to be one of them; in any of the other
 * twenty-four the identical mistake would have reached users with nothing to catch it, because the dev
 * server never reads these configs and the preview looks perfect right up until `npm run build`.
 *
 * Reading the registry means a provider added TOMORROW is covered the day it lands, without anyone
 * remembering to add it here. A hand-written list only ever protects the frameworks someone thought of.
 */
function allProviderFileSets(): Array<{ name: string; files: Record<string, string> }> {
  const registry = new TemplateRegistry();
  return registry.listFrameworks().map((framework) => ({
    name: `provider:${framework}`,
    files: registry.getProvider(framework).getFiles([]),
  }));
}

const fileSets: Array<{ name: string; files: Record<string, string> }> = [
  ...allProviderFileSets(),
  { name: 'goldenBaseFiles', files: goldenBaseFiles('Test', 'export default function App() { return null; }') },
];

describe('every scaffold ships the files its own scripts reference', () => {
  it('found scaffolds to check — the sweep is not vacuously passing', () => {
    // Breadth IS the guarantee here, so it is asserted rather than hoped for: if the registry ever
    // stops enumerating (a refactor, a renamed accessor) this sweep would silently pass over nothing
    // at all, which is indistinguishable from every scaffold being correct.
    expect(fileSets.length).toBeGreaterThan(20);
    expect(fileSets.some((f) => f.name === 'provider:vite-react')).toBe(true);
    expect(fileSets.some((f) => f.name === 'provider:node-express')).toBe(true);
    for (const s of fileSets) expect(Object.keys(s.files).length, s.name).toBeGreaterThan(1);
  });

  for (const { name, files } of fileSets) {
    it(`${name}: every tsconfig its scripts name is present`, () => {
      // A python/go/JVM scaffold legitimately ships no package.json — nothing to check, not a failure.
      const pkg = files['package.json'];
      if (!pkg) return;
      const referenced = tsconfigsReferencedByScripts(pkg);
      const missing = referenced.filter((p) => !(p in files));
      expect(
        missing,
        `${name}'s scripts run "tsc -p <file>" on these, but the scaffold never writes them — `
        + 'npm run build will fail with TS5058 on every app it makes.',
      ).toEqual([]);
    });
  }

  it('a `-p <port>` flag is never mistaken for a project path', () => {
    // Real case, found while widening this sweep: the static scaffold serves with `… -p 3000`, and the
    // old pattern reported a missing file named "3000". A guard that cries wolf gets weakened, and the
    // weakening is what would let the real bug back in — so this is pinned, not just fixed.
    expect(tsconfigsReferencedByScripts(JSON.stringify({ scripts: { start: 'serve dist -p 3000' } }))).toEqual([]);
    expect(tsconfigsReferencedByScripts(JSON.stringify({ scripts: { dev: 'http-server -p 8080 -c-1' } }))).toEqual([]);
    // …while a real tsc project path is still found, including alongside a port flag in one command.
    expect(tsconfigsReferencedByScripts(JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json && serve -p 3000' } })))
      .toEqual(['tsconfig.build.json']);
  });

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

/**
 * THE SAME FAILURE, THROUGH THREE OTHER DOORS.
 *
 * `tsc -p <missing>` is one way a scaffold can reference a file it never ships. These are the others
 * that fail identically — silently, invisibly in the preview, and only at build/serve time:
 *
 *   • a tsconfig that `extends` a file we do not write   → TS5083, every compile dies
 *   • an index.html whose entry <script src> is missing  → a blank page in dev AND in the built app
 *   • a package.json `main`/`module` pointing nowhere    → the entry cannot be resolved
 *
 * All twenty-five scaffolds pass these today — this is PREVENTION, not a bug fix, and it is worth
 * saying so plainly rather than implying a save. The value is that the next provider, or the next
 * script edit, cannot introduce one of them unnoticed.
 */
describe('a scaffold never references a file it does not ship', () => {
  for (const { name, files } of fileSets) {
    const names = new Set(Object.keys(files));

    it(`${name}: every tsconfig "extends" target exists`, () => {
      const missing: string[] = [];
      for (const [path, content] of Object.entries(files)) {
        if (!/tsconfig.*\.json$/.test(path)) continue;
        const m = String(content).match(/"extends"\s*:\s*"([^"]+)"/);
        if (!m || !m[1].startsWith('.')) continue; // a package name ("@tsconfig/node18") is not ours to ship
        const target = m[1].replace(/^\.\//, '');
        if (![target, `${target}.json`].some((c) => names.has(c))) missing.push(`${path} extends ${m[1]}`);
      }
      expect(missing, 'a tsconfig extending a file the scaffold does not write fails with TS5083').toEqual([]);
    });

    it(`${name}: index.html's local entry files exist`, () => {
      const html = files['index.html'];
      if (!html) return;
      const missing: string[] = [];
      for (const m of String(html).matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
        const target = m[1].replace(/^\//, '');
        // Only files a scaffold would ship itself; a CDN or public asset path is not this test's business.
        if (/\.(tsx?|jsx?|css)$/.test(target) && !names.has(target)) missing.push(m[1]);
      }
      expect(missing, 'index.html points at an entry the scaffold never writes — the app renders blank').toEqual([]);
    });

    it(`${name}: package.json main/module point at files that exist`, () => {
      const pkg = files['package.json'];
      if (!pkg) return;
      let parsed: Record<string, unknown> = {};
      expect(() => { parsed = JSON.parse(pkg) as Record<string, unknown>; }, `${name}'s package.json must parse`).not.toThrow();
      const missing: string[] = [];
      for (const key of ['main', 'module']) {
        const v = parsed[key];
        if (typeof v === 'string' && /\.(tsx?|jsx?)$/.test(v) && !names.has(v.replace(/^\.\//, ''))) missing.push(`${key} -> ${v}`);
      }
      expect(missing).toEqual([]);
    });
  }

  it('these checks actually bite — a scaffold referencing a missing file FAILS', () => {
    // A guard nobody has seen fail is just a comment (this file's own rule, applied to its new half).
    const shippedConfigs = new Set(['tsconfig.json']);
    const m = '{"extends":"./tsconfig.base.json"}'.match(/"extends"\s*:\s*"([^"]+)"/);
    const target = m![1].replace(/^\.\//, '');
    expect([target, `${target}.json`].some((c) => shippedConfigs.has(c))).toBe(false);

    const shippedFiles = new Set(['index.html']);
    const found = [...'<script type="module" src="/src/main.tsx"></script>'.matchAll(/(?:src|href)="(\/[^"]+)"/g)]
      .map((x) => x[1].replace(/^\//, ''))
      .filter((t) => /\.(tsx?|jsx?|css)$/.test(t) && !shippedFiles.has(t));
    expect(found).toEqual(['src/main.tsx']);
  });
});
