/**
 * Maintainer-only, offline (library batch 9, 2026-11-20): FBX → GLB for a reviewed CC0 pack that ships no glTF. Runs inside a
 * sandboxed headless Chromium with the repo's own three.js FBXLoader + GLTFExporter — no downloaded native converter.
 * Two fixes it applies, both found on the Quaternius Farm Animal Pack: the loader reads these packs' TransparencyFactor as
 * fully transparent (the animals exported invisible), and FBX keeps one group per polygon run (a cow became 106 primitives).
 * Then run gltf-transform dedup/weld/resample/prune and the batch admission (scripts/library/admitLibraryBatch.mts).
 * Usage: node scripts/library/fbxToGlb.mjs <dir with .fbx> <out dir> <playwright index.mjs>
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [inDir, outDir, playwrightPath] = process.argv.slice(2);
if (!inDir || !outDir || !playwrightPath) throw new Error('Usage: node scripts/library/fbxToGlb.mjs <fbx dir> <out dir> <playwright index.mjs>');
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const T = resolve('node_modules/three');
const srv = createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u.startsWith('/in/')) { r.setHeader('content-type', 'application/octet-stream'); return r.end(readFileSync(join(inDir, u.slice(4)))); }
  if (u.startsWith('/t/')) { r.setHeader('content-type', 'text/javascript'); return r.end(readFileSync(join(T, u.slice(3)))); }
  r.setHeader('content-type', 'text/html'); r.end('<html><head><script type="importmap">{"imports":{"three":"/t/build/three.module.js"}}</script></head><body></body></html>');
});
await new Promise(r => srv.listen(0, r));
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); const errors = []; p.on('pageerror', e => errors.push(String(e)));
await p.goto(`http://127.0.0.1:${srv.address().port}/`);
for (const f of readdirSync(inDir).filter(x => x.toLowerCase().endsWith('.fbx'))) {
  const res = await p.evaluate(async (f) => {
    const { FBXLoader } = await import('/t/examples/jsm/loaders/FBXLoader.js');
    const { GLTFExporter } = await import('/t/examples/jsm/exporters/GLTFExporter.js');
    const obj = await new FBXLoader().loadAsync('/in/' + f);
    // FBXLoader reads these packs' TransparencyFactor as fully transparent (opacity 0, BLEND): the animals exported
    // invisible. They are solid-colour, so every material is made opaque; animation names lose the "Armature|" prefix.
    obj.traverse(n => { for (const m of [].concat(n.material ?? [])) { m.transparent = false; m.opacity = 1; } });
    for (const c of obj.animations) c.name = c.name.replace(/^.*\|/, '');
    // FBX keeps a group per polygon run, so one cow became 106 primitives (over the 64 the validator allows): reorder
    // each geometry's triangles so every material is ONE contiguous group. Only triangle order changes; skinning is kept.
    obj.traverse(n => {
      const g = n.geometry; if (!g || !Array.isArray(n.material) || !g.groups.length) return;
      if (!g.index) { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); }
      const src = g.index.array; const byMat = new Map();
      for (const grp of g.groups) { const list = byMat.get(grp.materialIndex) ?? []; for (let i = grp.start; i < grp.start + grp.count; i++) list.push(src[i]); byMat.set(grp.materialIndex, list); }
      const out = []; g.clearGroups();
      for (const [mi, list] of [...byMat].sort((a, b) => a[0] - b[0])) { g.addGroup(out.length, list.length, mi); out.push(...list); }
      g.setIndex(out);
    });
    const clips = obj.animations.map(c => c.name);
    const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations, onlyVisible: true });
    return { clips, bytes: Array.from(new Uint8Array(glb)) };
  }, f);
  writeFileSync(join(outDir, f.replace(/\.fbx$/i, '.glb')), Buffer.from(res.bytes));
  console.log(f, res.bytes.length, res.clips.join(','));
}
console.log(JSON.stringify({ errors }));
await b.close(); srv.close();
