/**
 * Q-115 (autopsy 424ecdab): a build ended RED on `<IndianRupee />` and `<Clock />` — lucide-react icons used once
 * and imported nowhere. The import heal could only copy an import the project had already made elsewhere, so a
 * name used in exactly one file was structurally unfixable. The package's OWN export list — read from the
 * project's node_modules, never guessed — now answers it, for JSX tags only.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import {
  addMissingProjectImports, unboundJsxTagCandidates, packageExportsCommand, parsePackageExports,
} from '../src/server/AgentV3/ImportExportReconcile';

const PAGE = `export default function Fees() {
  return (<div><IndianRupee size={16} /> <Clock /> <span>Due</span></div>);
}`;

describe('an icon the project never imported is healed from the package itself', () => {
  it('the report\'s two icons get their import, from the one package that exports them', async () => {
    const r = await addMissingProjectImports({ 'src/pages/Fees.tsx': PAGE }, { packageExports: { 'lucide-react': ['IndianRupee', 'Clock'] } });
    expect(r.added.map((a) => `${a.name} ← ${a.from}`).sort()).toEqual(['Clock ← lucide-react', 'IndianRupee ← lucide-react']);
    expect(r.files['src/pages/Fees.tsx']).toMatch(/import \{ IndianRupee \} from "lucide-react";/);
  });

  it('never: two packages claim the name, the project defines it, it is already imported, or it is not a JSX tag', async () => {
    const two = await addMissingProjectImports({ 'src/a.tsx': 'export const A = () => <Link to="/" />;' }, { packageExports: { 'react-router-dom': ['Link'], 'wouter': ['Link'] } });
    expect(two.added).toEqual([]);
    const own = await addMissingProjectImports({ 'src/a.tsx': 'export const A = () => <Clock />;', 'src/Clock.tsx': 'export const Clock = () => null;' }, { packageExports: { 'lucide-react': ['Clock'] } });
    expect(own.added.map((a) => a.from)).toEqual(['./Clock']); // the project's own module wins
    const imported = await addMissingProjectImports({ 'src/a.tsx': 'import { Clock } from "react-feather";\nexport const A = () => <Clock />;' }, { packageExports: { 'lucide-react': ['Clock'] } });
    expect(imported.added).toEqual([]);
    const global = await addMissingProjectImports({ 'src/a.ts': 'export const img = new Image();' }, { packageExports: { 'lucide-react': ['Image'] } });
    expect(global.added).toEqual([]); // a browser global is never bound to an icon
  });

  it('without the package answer, nothing changes (today\'s behaviour)', async () => {
    expect((await addMissingProjectImports({ 'src/pages/Fees.tsx': PAGE })).added).toEqual([]);
  });

  it('asks only about unbound capitalised JSX tags', () => {
    expect(unboundJsxTagCandidates({ 'src/pages/Fees.tsx': PAGE, 'src/b.tsx': 'import { X } from "y";\nconst Y = 1;\nexport const B = () => <><X /><Y /></>;' })).toEqual(['Clock', 'IndianRupee']);
  });

  it('the sandbox command reads the real package (run here against this repo\'s own node_modules)', () => {
    const cmd = packageExportsCommand(['Clock', 'IndianRupee', 'NotAnIcon'], ['lucide-react', 'not-a-package-xyz'])!;
    const out = parsePackageExports(execSync(cmd, { encoding: 'utf8', shell: '/bin/sh' }));
    expect(out['lucide-react']?.sort()).toEqual(['Clock', 'IndianRupee']);
    expect(out['not-a-package-xyz']).toBeUndefined();
  });

  it('names and packages are validated before they reach the shell', () => {
    expect(packageExportsCommand(["Clock'; rm -rf / #"], ['lucide-react'])).toBeNull();
    expect(packageExportsCommand(['Clock'], ['lucide-react; touch /tmp/x'])).toBeNull();
  });
});
