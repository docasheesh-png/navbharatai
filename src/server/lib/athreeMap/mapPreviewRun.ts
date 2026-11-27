// 🗺️ THE MAP FROM ABOVE, MEASURED FROM THE GAME'S OWN WORLD (admin 2026-11-27, wave 2 part 2).
//
// When a build makes or changes an Athree map, the user is shown a small top-down picture of THEIR map: blue water that darkens with
// depth, the land by biome, dark roads, the edge nobody crosses, the ponds, building plots once the world has colonies, and where the
// player starts. It is not drawn from the plan or from a guess: the EMITTED world modules this build writes are run (the same loader
// the robot checks use, mapRobotRun.ts) with the seed the game itself uses, and every cell is the world's own answer —
//   • a cell is classified at its centre by world.heightAt / waterAt / biomeAt / boundary.limitAt, exactly as the game reads them;
//   • a road is drawn only where world.roadAt answers a road at a point on the network's own centre line inside that cell;
//   • a pond is drawn where world.ponds() puts one and world.waterAt agrees there is water;
//   • a building plot is drawn where world.colonies() (when the world has colonies) puts a lot on dry land;
//   • the spawn is world.spawnPoints('player', 1)[0].
//
// What it does NOT show, said in the card: the towns and buildings the GAME adds at runtime (an open world's cities), which are not
// part of the map's own layers.
//
// It runs in a WORKER THREAD with a time budget, never on the server's main thread. A run that fails or runs out of time is reported
// as "Map preview unavailable" with the reason — never a placeholder picture.

import { ATHREE_RUNNER_SOURCE, runAthreeScriptInWorker, transpileAthreeModule } from './mapRobotRun';
import { parseMapPreview, type MapPreview } from '../../../lib/mapPreview';

/** Cells across the picture. 128 x 128 = 16,384 samples: a 5 km map at 39 m a cell, a 100 km loop at 780 m. */
export const MAP_PREVIEW_SIDE = 128;
/** The most a build-time preview may take before it is stopped. */
export const MAP_PREVIEW_BUDGET_MS = 10_000;

/**
 * The sampler as plain JavaScript (it runs inside a worker, which has no bundler). `samplePreview(index, opts)` builds the world from
 * the emitted index with the given seed and profile, and returns the grid. Cell codes: src/lib/mapPreview.ts MAP_CELL.
 */
export const PREVIEW_SOURCE = String.raw`
function previewClassify(w, x, z, edge) {
  if (edge) {
    var r = Math.sqrt(x * x + z * z);
    var lim = edge.limitAt(Math.atan2(z, x));
    if (Number.isFinite(lim) && r > lim) return 'c';
  }
  if (w.waterAt(x, z)) return '3';
  var h = w.heightAt(x, z);
  if (h < w.seaLevel) {
    var d = w.seaLevel - h;
    return d >= 20 ? '0' : d >= 5 ? '1' : '2';
  }
  var b = w.biomeAt(x, z);
  if (b === 'beach') return '5';
  if (b === 'desert') return '6';
  if (b === 'forest') return '8';
  if (b === 'mountain') return '9';
  if (b === 'snow') return 'a';
  if (b === 'ocean') return '2';
  return '7';
}
function previewLots(v, out, depth) {
  if (!v || depth > 4 || out.length >= 5000) return;
  if (Array.isArray(v)) { for (var i = 0; i < v.length && out.length < 5000; i++) previewLots(v[i], out, depth + 1); return; }
  if (typeof v !== 'object') return;
  if (typeof v.x === 'number' && typeof v.z === 'number' && Number.isFinite(v.x) && Number.isFinite(v.z) && !Array.isArray(v.points)) { out.push({ x: v.x, z: v.z }); return; }
  var keys = ['lots', 'plots', 'houses', 'colonies'];
  for (var k = 0; k < keys.length; k++) if (v[keys[k]]) previewLots(v[keys[k]], out, depth + 1);
}
function samplePreview(index, opts) {
  var N = opts.size;
  var map = index.createAthreeMap({ seed: opts.seed, profile: opts.profile });
  var w = map.world;
  var S = w.sizeMeters, half = S / 2, cell = S / N;
  var edge = w.boundary && w.boundary.kind !== 'none' && w.boundary.kind !== 'sea' && typeof w.boundary.limitAt === 'function' ? w.boundary : null;
  var cells = new Array(N * N);
  for (var j = 0; j < N; j++) {
    var z = -half + (j + 0.5) * cell;
    for (var i = 0; i < N; i++) cells[j * N + i] = previewClassify(w, -half + (i + 0.5) * cell, z, edge);
  }
  var pix = function (x, z) {
    var i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
    return i >= 0 && j >= 0 && i < N && j < N ? j * N + i : -1;
  };
  // Roads: walk every centre line of the network, a sample every half cell; a cell is a road only where roadAt agrees.
  var roadCells = 0;
  var net = typeof w.roadNetwork === 'function' ? w.roadNetwork() : null;
  if (net) {
    var regions = typeof net.style === 'function' && net.style() !== null ? [net.home()] : net.regionsNear(-half, -half, half, half);
    for (var g = 0; g < regions.length; g++) {
      var roads = regions[g].roads || [];
      for (var q = 0; q < roads.length; q++) {
        var pts = roads[q].points || [];
        var n = roads[q].closed ? pts.length + 1 : pts.length;
        for (var p = 1; p < n; p++) {
          var a = pts[p - 1], b = pts[p % pts.length];
          var len = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.z - a.z) * (b.z - a.z));
          var steps = Math.max(1, Math.ceil(len / (cell / 2)));
          for (var s = 0; s <= steps; s++) {
            var x = a.x + (b.x - a.x) * (s / steps), zz = a.z + (b.z - a.z) * (s / steps);
            var at = pix(x, zz);
            if (at < 0 || cells[at] === 'b' || cells[at] === 'c') continue;
            if (w.roadAt(x, zz)) { cells[at] = 'b'; roadCells++; }
          }
        }
      }
    }
  }
  // Ponds: the world's own list, drawn where waterAt agrees there is water.
  var ponds = 0;
  var pondList = typeof w.ponds === 'function' ? w.ponds() : [];
  for (var k = 0; k < pondList.length; k++) {
    var pd = pondList[k];
    var c = pix(pd.x, pd.z);
    if (c < 0 || !w.waterAt(pd.x, pd.z)) continue;
    ponds++;
    var reach = Math.ceil(pd.radius / cell);
    var ci = c % N, cj = Math.floor(c / N);
    cells[c] = '4';
    for (var dj = -reach; dj <= reach; dj++) for (var di = -reach; di <= reach; di++) {
      var ii = ci + di, jj = cj + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      var px = -half + (ii + 0.5) * cell, pz = -half + (jj + 0.5) * cell;
      if ((px - pd.x) * (px - pd.x) + (pz - pd.z) * (pz - pd.z) <= pd.radius * pd.radius && w.waterAt(px, pz)) cells[jj * N + ii] = '4';
    }
  }
  // Building plots: only when the world has colonies (the colonies layer), and only on dry land off the water.
  var plots = 0;
  if (typeof w.colonies === 'function') {
    var lots = [];
    previewLots(w.colonies(), lots, 0);
    for (var l = 0; l < lots.length; l++) {
      var lc = pix(lots[l].x, lots[l].z);
      if (lc < 0 || cells[lc] === 'c' || cells[lc] === 'b' || w.waterAt(lots[l].x, lots[l].z) || w.heightAt(lots[l].x, lots[l].z) < w.seaLevel) continue;
      if (cells[lc] !== 'd') plots++;
      cells[lc] = 'd';
    }
  }
  var sp = w.spawnPoints('player', 1)[0];
  var spawn = sp && Number.isFinite(sp.x) && Number.isFinite(sp.z) ? { u: Math.min(1, Math.max(0, (sp.x + half) / S)), v: Math.min(1, Math.max(0, (sp.z + half) / S)) } : null;
  return {
    v: 1, width: N, height: N, cells: cells.join(''), sideMeters: S, mode: w.mode, seed: w.seed,
    boundary: w.boundary && w.boundary.kind ? String(w.boundary.kind) : 'none', spawn: spawn,
    counts: { roadCells: roadCells, ponds: ponds, plots: plots },
  };
}
function runPreview(compile, files, opts) {
  try {
    var index = loadEmitted(compile, files, 'index');
    if (typeof index.createAthreeMap !== 'function') return { ok: false, error: 'the emitted map has no entry point' };
    return { ok: true, preview: samplePreview(index, opts) };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}
`;

export type MapPreviewRun = { ok: true; preview: MapPreview } | { ok: false; error: string };
export interface MapPreviewOptions { seed: number; profile: string; size?: number }

type RunFn = (compile: (s: string) => string, files: Readonly<Record<string, string>>, opts: { seed: number; profile: string; size: number }) => { ok: boolean; preview?: unknown; error?: string };
// Our own constant source (above and the shared loader), evaluated once — the same text the worker runs.
// eslint-disable-next-line no-new-func
const RUN = new Function(ATHREE_RUNNER_SOURCE + PREVIEW_SOURCE + '\nreturn runPreview;')() as RunFn;

const side = (n: number | undefined): number => Math.max(16, Math.min(160, Math.floor(n ?? MAP_PREVIEW_SIDE)));
/** A raw run → a checked result: a grid that does not parse is a failure, never a picture. */
function checked(raw: { ok: boolean; preview?: unknown; error?: string } | null | undefined): MapPreviewRun {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'the preview returned nothing usable' };
  if (!raw.ok) return { ok: false, error: String(raw.error ?? 'unknown error') };
  const preview = parseMapPreview(raw.preview);
  return preview ? { ok: true, preview } : { ok: false, error: 'the preview grid was not well formed' };
}

/** The preview, computed in this thread (tests). Never throws. */
export function previewMapOnFiles(files: Readonly<Record<string, string>>, options: MapPreviewOptions): MapPreviewRun {
  try { return checked(RUN(transpileAthreeModule, files, { seed: options.seed | 0, profile: options.profile, size: side(options.size) })); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
${ATHREE_RUNNER_SOURCE}
${PREVIEW_SOURCE}
let result;
try { result = runPreview(function (js) { return js; }, workerData.files, workerData.opts); }
catch (error) { result = { ok: false, error: error && error.message ? error.message : String(error) }; }
parentPort.postMessage(result);
`;

/** The preview, computed in a worker thread within a time budget. Never rejects. */
export async function previewMapInWorker(files: Readonly<Record<string, string>>, options: MapPreviewOptions & { budgetMs?: number }): Promise<MapPreviewRun> {
  const raw = await runAthreeScriptInWorker<{ ok: boolean; preview?: unknown; error?: string }>(
    WORKER_SOURCE, files, { opts: { seed: options.seed | 0, profile: options.profile, size: side(options.size) } }, options.budgetMs ?? MAP_PREVIEW_BUDGET_MS,
    (error) => ({ ok: false, error }),
    (v): v is { ok: boolean; preview?: unknown; error?: string } => !!v && typeof v === 'object' && typeof (v as { ok?: unknown }).ok === 'boolean',
  );
  return checked(raw);
}
