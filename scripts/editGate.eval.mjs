#!/usr/bin/env node
/** OFFLINE evaluation of the edit-promotion gate on a labelled corpus built from a 3D-game fixture. No model calls,
 *  no network, no production data. It measures the gate's DECISIONS and its compute time — nothing else.
 *  Run: node --import ./node_modules/tsx/dist/loader.mjs scripts/editGate.eval.mjs */
import { assessEditCandidate } from '../src/server/AgentV3/editPromotionGate.ts';
import { cityGame, differentGame } from '../tests/fixtures/threeDGame.ts';

const base = cityGame();
const m = (f) => { const c = { ...base }; f(c); return c; };
const cases = [];
const legit = (name, candidate, msg) => cases.push({ name, label: 'edit', candidate, msg });
const bad = (name, candidate, msg) => cases.push({ name, label: 'replacement', candidate, msg });

// legitimate edits: every one of these must promote
for (let i = 0; i < 12; i++) legit(`one-file tweak ${i}`, m((c) => { c['src/game/CameraRig.tsx'] += `\n// tweak ${i}`; }), 'tweak the camera');
for (let i = 0; i < 6; i++) legit(`add a file ${i}`, m((c) => { c[`src/game/extra${i}.ts`] = `export const x${i} = ${i};`; }), 'add a helper');
legit('camera + settings', m((c) => { c['src/game/CameraRig.tsx'] += '//3p'; c['src/game/settings.ts'] += '//3p'; }), 'add a third-person camera');
legit('collision + test', m((c) => { c['src/game/collision.ts'] += '//fix'; c['src/game/collision.test.ts'] = 't'; }), 'fix collision');
legit('rename (move)', m((c) => { c['src/game/physics/collision.ts'] = c['src/game/collision.ts']; delete c['src/game/collision.ts']; }), 'move collision into physics');
legit('named deletion', m((c) => { delete c['src/game/collision.ts']; }), 'delete collision.ts please');
legit('platform files only', m((c) => { c['public/sw.js'] = 'x'; c['e2e/smoke.spec.ts'] = 'y'; c['package-lock.json'] = '{}'; }), 'polish');
legit('broad rewrite, asked', m((c) => { for (const p of Object.keys(c)) if (!p.endsWith('.glb')) c[p] += '\n// refactored'; }), 'refactor everything to the new style');
legit('explicit full rewrite request', m((c) => { for (const p of Object.keys(c)) if (!p.endsWith('.glb')) c[p] += '\n// rewritten'; }), 'rewrite the project, migrate it to the new layout');

// replacements: every one of these must be held
bad('a different game (the incident)', differentGame(), 'make the camera third-person');
for (const scene of ['City', 'Harbor', 'Airport']) bad(`scene ${scene} deleted`, m((c) => { delete c[`src/scenes/${scene}Scene.tsx`]; delete c[`public/models/${scene.toLowerCase()}.glb`]; }), 'tweak the camera');
bad('engine swapped, files kept', m((c) => { c['package.json'] = JSON.stringify({ dependencies: { react: '^18' } }); }), 'tweak the camera');
bad('entry deleted', m((c) => { delete c['src/App.tsx']; }), 'tweak the camera');
bad('mass in-place rewrite, unasked', m((c) => { for (const p of Object.keys(c)) if (!p.endsWith('.glb')) c[p] += '\n// rewritten'; }), 'tweak the sky colour');
bad('dangling import after a deletion', m((c) => { delete c['src/game/collision.ts']; c['src/game/PlayerCar.tsx'] = 'import { collides } from "./collision";export const P=1;'; }), 'remove collision');
bad('half the project removed', m((c) => { for (const p of Object.keys(c).filter((k) => k.startsWith('src/game/') || k.startsWith('public/'))) delete c[p]; }), 'tweak the camera');
for (let i = 0; i < 6; i++) bad(`different game variant ${i}`, { ...differentGame(), [`src/Level${i}.tsx`]: `export const L=${i}` }, 'adjust the controls');

let tp = 0, fp = 0, tn = 0, fn = 0;
const wrong = [];
for (const c of cases) {
  const held = assessEditCandidate({ base, candidate: c.candidate, userMessage: c.msg }).verdict === 'reject';
  if (c.label === 'replacement') { if (held) tp++; else { fn++; wrong.push(c.name); } }
  else if (held) { fp++; wrong.push(c.name); } else tn++;
}
// the OLD rule: a candidate that renders is promoted — it holds nothing
const oldHeld = 0;

function bigProject(n) { const f = {}; for (let i = 0; i < n; i++) f[`src/mod${i}/File${i}.ts`] = `import { a } from "../mod${(i + 1) % n}/File${(i + 1) % n}";\nexport const v${i} = ${i};\n`.repeat(8); return f; }
const timings = {};
for (const n of [14, 200, 1500]) {
  const b = n === 14 ? base : bigProject(n);
  const cand = { ...b, [Object.keys(b)[1]]: b[Object.keys(b)[1]] + '\n// edit' };
  const t = [];
  for (let i = 0; i < 40; i++) { const s = performance.now(); assessEditCandidate({ base: b, candidate: cand, userMessage: 'tweak' }); t.push(performance.now() - s); }
  t.sort((a, b2) => a - b2);
  timings[`${n} files`] = { p50_ms: +t[20].toFixed(2), p95_ms: +t[Math.floor(t.length * 0.95) - 1].toFixed(2) };
}
const out = {
  corpus: { total: cases.length, edits: cases.filter((c) => c.label === 'edit').length, replacements: cases.filter((c) => c.label === 'replacement').length, source: 'synthetic, built from a 3D-game fixture — NOT real user edits' },
  newGate: { replacementsHeld: `${tp}/${tp + fn}`, legitEditsPromoted: `${tn}/${tn + fp}`, falsePositives: fp, falseNegatives: fn, misjudged: wrong },
  oldRule: { replacementsHeld: `${oldHeld}/${tp + fn}`, note: 'render-only promotion holds nothing' },
  gateComputeTime: timings,
};
console.log(JSON.stringify(out, null, 2));
