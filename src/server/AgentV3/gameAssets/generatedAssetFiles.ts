// THE MODEL-LIBRARY FILES THE PLATFORM GENERATES ARE THE PLATFORM'S CODE (failedbr #2496, 2026-11-22).
//
// `isPlatformSeededFile` (platformAuthored.ts) recognises our own files by exact bytes: the golden scaffolds, the
// game kit's recipe output, older kit versions. The model library's files were missing from it because their bytes
// are not fixed — `src/game/three/assetModels.ts` embeds the manifest of the models THIS game has, the
// customization file lists their names, the world-dressing module its scenery. So when `add_library_models` wrote
// them, every reader of "who wrote this?" answered "the builder": the starter-test pass scaffolded
// `src/game/three/assetModels.test.ts` — an `it.todo` skeleton for NavBharatAI's own model loader — and the
// readiness gate would have blamed the build for a line in our generator.
//
// 🔑 RECOGNISED THE SAME WAY AS EVERY OTHER SEED: by content, not by a flag. Each generated file carries its own
// parameters (the manifest JSON, the subject list, the layout). They are read back from the file and the generator
// is run again; only a BYTE-EXACT match is ours. One changed byte and the file is the user's again — the safe
// direction platformAuthored.ts insists on. A generator version we no longer produce simply stops matching, which
// is also the safe direction.
//
// PURE. Never throws.

import {
  GAME_ASSET_CUSTOMIZATIONS_PATH, GAME_ASSET_MODELS_PATH, generateAssetCustomizations, generateAssetModelLoader,
  generateGameAssetRuntime, previousAssetModelLoader,
} from '../../lib/GameAssetRuntimeGenerator';
import { GAME_WORLD_STREAMING_PATH, generateWorldStreamingModule } from '../../lib/GameWorldStreamingGenerator';
import { generateWorldDressingModule, type DressingLayout } from './worldDressing';

const RUNTIME_PATH = 'src/game/three/externalAssets.ts';
const DRESSING_PATH = 'src/game/three/worldDressing.ts';

function jsonAfter(content: string, marker: string, end: string): unknown {
  const at = content.indexOf(marker);
  if (at < 0) return undefined;
  const stop = content.indexOf(end, at + marker.length);
  if (stop < 0) return undefined;
  try { return JSON.parse(content.slice(at + marker.length, stop)); } catch { return undefined; }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const RECOGNISERS: Readonly<Record<string, (content: string) => boolean>> = {
  [GAME_ASSET_MODELS_PATH]: (content) => {
    const models = jsonAfter(content, 'const assets: Record<string, LocalGameAsset> = ', ';\n');
    return isPlainObject(models) && (generateAssetModelLoader(models) === content || previousAssetModelLoader(models) === content);
  },
  [RUNTIME_PATH]: (content) => generateGameAssetRuntime() === content,
  [GAME_WORLD_STREAMING_PATH]: (content) => generateWorldStreamingModule() === content,
  [GAME_ASSET_CUSTOMIZATIONS_PATH]: (content) => {
    const m = /Models in this game: (.*)\.\n/.exec(content);
    if (!m) return false;
    const subjects = m[1] === '(none yet)' ? [] : m[1].split(', ');
    return generateAssetCustomizations(subjects) === content;
  },
  [DRESSING_PATH]: (content) => {
    const subjects = jsonAfter(content, 'export const SCENERY_SUBJECTS: readonly string[] = ', ';\n');
    const layout = jsonAfter(content, 'export const SCENERY_LAYOUT = ', ' as ');
    if (!Array.isArray(subjects) || !subjects.every((s) => typeof s === 'string') || typeof layout !== 'string') return false;
    return generateWorldDressingModule(subjects, layout as DressingLayout) === content;
  },
};

/** Is this an UNEDITED model-library file the platform generated (path + bytes)? PURE; never throws. */
export function isUneditedGeneratedGameAssetFile(path: string, content: string): boolean {
  const recognise = RECOGNISERS[String(path ?? '').replace(/^\.\//, '')];
  if (!recognise || typeof content !== 'string') return false;
  try { return recognise(content); } catch { return false; }
}

/** The paths this module can recognise — for the census test. */
export const GENERATED_GAME_ASSET_PATHS: readonly string[] = Object.freeze(Object.keys(RECOGNISERS));
