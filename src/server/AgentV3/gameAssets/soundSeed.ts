/**
 * NavBharatAI's recorded sound library for new games (admin request 2026-11-19: the best game at the lowest cost).
 *
 * Every game the kit lays down already makes sound from code (synth.ts). This step copies RECORDED sounds into
 * the new game — footsteps, clicks, hits, rain, forest, engines, animals… — chosen for its prompt, so the same
 * names play real recordings instead. Pinned, hash-checked bytes from facebookincubator/Meta-open-sound (Oculus
 * Audio Pack, CC BY 4.0, credited in public/sfx/library/SOUND_CREDITS.txt). No AI and no paid service runs here.
 *
 * Nothing here can break a game: a sound that does not download is simply left to its built-in voice, and the
 * game's own src/game/fx/soundCustomizations.ts can swap any sound for the user's file, or back to built-in.
 * Kill switch: AGENTV3_GAME_SOUND_LIBRARY=off. Default ON.
 */
import { createHash } from 'node:crypto';
import { parseEnvFlag } from '../../lib/envFlag';
import { downloadGameAsset } from './assetDownload';
import type { GameAssetPersistence, GameAssetWorkspace } from './assetProject';
import type { AssetObjectStore } from './assetCache';
import { gameAssetObjectStore } from './objectStore';
import { SOUND_LIBRARY, SOUND_LIBRARY_LICENCE, SOUND_LIBRARY_REVISION, type LibrarySound } from './soundLibraryCatalogue';

export const GAME_SOUND_LIBRARY_PATH = 'src/game/fx/soundLibrary.ts';
export const GAME_SOUND_CUSTOMIZATIONS_PATH = 'src/game/fx/soundCustomizations.ts';
export const GAME_SOUND_DIR = 'public/sfx/library';
/** Bounds per game: an ambience loop is ~1 MB, so a prompt naming everything still ships a light game. */
export const SOUND_BUDGET = Object.freeze({ maxSounds: 28, maxBytes: 8 * 1024 * 1024, maxLoops: 4 });
const ORIGIN = 'https://raw.githubusercontent.com';
/** One retry after a refused download, just past the downloader's one-second per-origin window. */
export const RETRY_AFTER_MS = 1200;

export const gameSoundLibraryEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => parseEnvFlag(env.AGENTV3_GAME_SOUND_LIBRARY) ?? true;

const normalized = (text: string) => ` ${String(text ?? '').slice(0, 16000).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim()} `;

/** Core sounds always, then every sound whose words the prompt names — inside the per-game budget. Pure. */
export function soundsForPrompt(prompt: string, library: readonly LibrarySound[] = SOUND_LIBRARY): LibrarySound[] {
  const text = normalized(prompt);
  const named = library.filter((s) => !s.core && s.words.some((w) => text.includes(normalized(w))));
  const chosen: LibrarySound[] = []; let bytes = 0; let loops = 0;
  for (const s of [...library.filter((s) => s.core), ...named]) {
    if (chosen.length >= SOUND_BUDGET.maxSounds || bytes + s.bytes > SOUND_BUDGET.maxBytes || (s.loop && loops >= SOUND_BUDGET.maxLoops)) continue;
    chosen.push(s); bytes += s.bytes; if (s.loop) loops++;
  }
  return chosen;
}

/** The game's loader: loads every prepared sound, applies the game's own changes, and starts ambience on request. */
export function generateSoundLibraryModule(sounds: readonly LibrarySound[]): string {
  const table = Object.fromEntries(sounds.map((s) => [s.name, { file: `sfx/library/${s.name}.ogg`, gain: s.gain, loop: s.loop, bus: s.bus }]));
  return `import { audio, type SoundCategory } from './audio';

/**
 * Recorded sounds from NavBharatAI's library (credits: public/sfx/library/SOUND_CREDITS.txt). A name that the
 * game already plays (step, click, hit, rain…) now plays the recording; if a file cannot load, the built-in voice
 * plays instead. Change or replace any sound in ./soundCustomizations.ts.
 */
export interface SoundCustomization {
  /** 'library' (default) | 'built-in' (the code-made voice) | { file } — your own .ogg/.mp3/.wav under public/. */
  source?: 'library' | 'built-in' | { file: string };
  /** 0..2, multiplied into the sound's level. */
  volume?: number;
}
export const librarySounds: Record<string, { file: string; gain: number; loop: boolean; bus: SoundCategory }> = ${JSON.stringify(table)};

const customizationModules = import.meta.glob('./soundCustomizations.ts', { eager: true }) as Record<string, { soundCustomizations?: Record<string, SoundCustomization> }>;
const customizations: Record<string, SoundCustomization> = Object.values(customizationModules)[0]?.soundCustomizations ?? {};

function ownFile(file: unknown): string | null {
  let path = String(file ?? '');
  while (path.startsWith('/')) path = path.slice(1);
  if (path.startsWith('public/')) path = path.slice('public/'.length);
  const lower = path.toLowerCase();
  const safe = path.length > 0 && path.length <= 240 && path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..' && [...part].every((ch) => /[A-Za-z0-9_ .-]/.test(ch)));
  return safe && (lower.endsWith('.ogg') || lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a')) ? path : null;
}

let loaded = false;
/** Called once by the game shell (or by your own startup code). Safe to call again. */
export function loadSoundLibrary(): void {
  if (loaded) return;
  loaded = true;
  for (const name of new Set([...Object.keys(librarySounds), ...Object.keys(customizations)])) {
    const custom = customizations[name];
    if (custom?.source === 'built-in') continue;
    const own = custom?.source && typeof custom.source === 'object' ? ownFile(custom.source.file) : null;
    const file = own ?? librarySounds[name]?.file;
    if (!file) continue;
    const volume = typeof custom?.volume === 'number' && Number.isFinite(custom.volume) ? Math.max(0, Math.min(2, custom.volume)) : 1;
    void audio.load(name, import.meta.env.BASE_URL + file, (own ? 1 : librarySounds[name]?.gain ?? 1) * volume);
  }
}

/** Starts every prepared ambience loop (amb_* on the music bus) and returns one stop function. */
export function startAmbience(names: readonly string[] = Object.keys(librarySounds).filter((n) => n.startsWith('amb_'))): () => void {
  loadSoundLibrary();
  const stops = names.filter((n) => librarySounds[n] || customizations[n]).map((n) => audio.play(n, librarySounds[n]?.bus ?? 'music', { loop: true, detune: 0 }));
  return () => { for (const stop of stops) stop(); };
}
`;
}

export function generateSoundCustomizations(sounds: readonly LibrarySound[]): string {
  return `import type { SoundCustomization } from './soundLibrary';

/**
 * Change any sound in this game here. Key = the sound name the game plays.
 * Sounds in this game: ${sounds.map((s) => s.name).join(', ') || '(none)'}.
 *
 *   step: { volume: 0.5 }                                   // quieter footsteps
 *   click: { source: 'built-in' }                           // back to the code-made voice
 *   shoot: { source: { file: 'public/sfx/my-shot.mp3' } }   // replace with your own file (.ogg .mp3 .wav .m4a)
 *   amb_forest: { source: { file: 'sfx/jungle.ogg' }, volume: 0.6 }
 *
 * A wrong value is ignored and a file that cannot load falls back to the built-in voice, so a change here can
 * never break the game.
 */
export const soundCustomizations: Record<string, SoundCustomization> = {};
`;
}

export interface GameSoundSeedOptions {
  prompt: string;
  workspaceId: string;
  workspace: GameAssetWorkspace;
  persistence: GameAssetPersistence;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
  library?: readonly LibrarySound[];
  download?: (sound: LibrarySound, signal: AbortSignal) => Promise<Uint8Array>;
  /** The shared public-asset cache (the models' bucket); null = no cache. Default: the production store. */
  store?: AssetObjectStore | null;
}
export interface GameSoundSeedResult { status: 'off' | 'prepared' | 'none'; files: Record<string, string>; prepared: string[]; skipped: string[]; handoff: string }

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Called inside the new-game seed after the kit laid down src/game/fx/audio.ts. Never throws past a failed sound. */
export async function prepareGameSounds(options: GameSoundSeedOptions): Promise<GameSoundSeedResult> {
  const none: GameSoundSeedResult = { status: 'off', files: {}, prepared: [], skipped: [], handoff: '' };
  if (!gameSoundLibraryEnabled(options.env)) return none;
  const chosen = soundsForPrompt(options.prompt, options.library);
  const download = options.download ?? ((s: LibrarySound, signal: AbortSignal) => downloadGameAsset({ downloadUrl: s.url }, new Set([ORIGIN]), signal));
  const ready: LibrarySound[] = []; const skipped: string[] = [];
  let store: AssetObjectStore | null = null;
  try { store = options.store === undefined ? gameAssetObjectStore() : options.store; } catch { store = null; }
  const verified = (s: LibrarySound, b: Uint8Array | null | undefined): b is Uint8Array => !!b && b.byteLength === s.bytes && sha256(b) === s.sha256 && Buffer.from(b.subarray(0, 4)).toString('latin1') === 'OggS';
  /**
   * The shared cache first, then the pinned source. ONE download at a time (2026-11-19, found by the end-to-end
   * village build: 17 of 18 sounds skipped): the downloader allows one request per second per origin and refuses
   * any that would wait longer, so four parallel fetches from raw.githubusercontent.com lost three of every four.
   * A cache hit costs no origin request at all, so a sound any earlier game fetched is instant.
   */
  const fetchSound = async (s: LibrarySound): Promise<Uint8Array> => {
    const key = `game-assets-public-cc/v1/${s.sha256}.ogg`;
    try { const hit = await store?.read(key, s.bytes + 1); if (verified(s, hit)) return hit; } catch { /* cache outage: the source still answers */ }
    let bytes: Uint8Array;
    try { bytes = await download(s, options.signal); } catch (first) {
      // A refused or rate-limited request is transient by nature: wait out the per-origin window once, then retry.
      // Wrong bytes are NOT retried — they are never right on a second try.
      options.signal.throwIfAborted();
      await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
      bytes = await download(s, options.signal).catch(() => { throw first; });
    }
    if (!verified(s, bytes)) throw new Error('unverified sound');
    try { await store?.write(key, bytes, 'audio/ogg'); } catch { /* the game has its copy; caching is optional */ }
    return bytes;
  };
  const queue = [...chosen];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      options.signal.throwIfAborted();
      try {
        const bytes = await fetchSound(s);
        const path = `${GAME_SOUND_DIR}/${s.name}.ogg`;
        const base64 = Buffer.from(bytes).toString('base64');
        await options.persistence.saveBinary(options.workspaceId, { [path]: `data:audio/ogg;base64,${base64}` });
        const saved = await options.persistence.readBinary(options.workspaceId, path, s.bytes + 1);
        if (!saved || sha256(saved) !== s.sha256) throw new Error('sound persistence not acknowledged');
        await options.workspace.writeBinaryFile(options.workspaceId, path, base64);
        ready.push(s);
      } catch {
        options.signal.throwIfAborted();
        skipped.push(s.name); // its built-in voice keeps playing
      }
    }
  };
  await worker();
  if (!ready.length) return { ...none, status: 'none', skipped };
  const order = new Map(chosen.map((s, i) => [s.name, i]));
  ready.sort((a, b) => order.get(a.name)! - order.get(b.name)!);
  const credits = `Sounds: ${SOUND_LIBRARY_LICENCE.attribution}\nLicence: CC BY 4.0 — ${SOUND_LIBRARY_LICENCE.evidenceUrl}\nSource revision: ${SOUND_LIBRARY_REVISION}\nChanges: renamed per sound; playback level adjusted in src/game/fx/soundLibrary.ts.\n\n`
    + ready.map((s) => `${s.name}: ${s.id} (sha256 ${s.sha256})`).join('\n') + '\n';
  const files: Record<string, string> = {
    [GAME_SOUND_LIBRARY_PATH]: generateSoundLibraryModule(ready),
    [GAME_SOUND_CUSTOMIZATIONS_PATH]: generateSoundCustomizations(ready),
    [`${GAME_SOUND_DIR}/SOUND_CREDITS.txt`]: credits,
  };
  await options.persistence.saveText(options.workspaceId, files);
  for (const [path, content] of Object.entries(files)) await options.workspace.writeFile(options.workspaceId, path, content);
  const ambience = ready.filter((s) => s.name.startsWith('amb_')).map((s) => s.name);
  const handoff = `RECORDED SOUNDS READY (${ready.length}): ${ready.map((s) => s.name).join(', ')}. The game shell loads them automatically (src/game/fx/soundLibrary.ts); `
    + 'play them by these names with audio.play(name) — step, click, hit, rain… now sound real, and a name that fails to load keeps its built-in voice. '
    + (ambience.length ? `Start the background ambience (${ambience.join(', ')}) once gameplay starts: import { startAmbience } from './fx/soundLibrary'; const stop = startAmbience(); call stop() on game over. ` : '')
    + 'If the game does not use the shell, call loadSoundLibrary() once at startup. To change, quieten or replace any sound with the user\'s own file, edit ONLY src/game/fx/soundCustomizations.ts. Keep public/sfx/library/SOUND_CREDITS.txt in the published game.';
  return { status: 'prepared', files, prepared: ready.map((s) => s.name), skipped, handoff };
}
