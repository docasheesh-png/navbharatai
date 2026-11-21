/**
 * Put library textures into a game (add_library_models `textures`, 2026-11-21). Same discipline as library models: the
 * packaged file is read by its pinned hash and size only, saved durably first, read back exactly, then written into the
 * live sandbox — so a texture is never reported added and then lost on the next sandbox recycle.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEXTURE_LIBRARY, TEXTURE_SURFACES, TEXTURE_LICENSE, type TextureSurface } from './textureLibraryData';
import type { GameAssetPersistence } from './assetProject';

export const TEXTURES_DIR = 'public/game-assets/textures';
const MAX_PER_CALL = 8;
const SURFACE_WORDS: Readonly<Record<string, TextureSurface>> = {
  brick: 'bricks', bricks: 'bricks', wall: 'bricks', eent: 'bricks', grass: 'grass', ground: 'grass', lawn: 'grass', ghaas: 'grass',
  roof: 'roofs', roofs: 'roofs', tiles: 'tile', tile: 'tile', floor: 'tile', wood: 'wood', wooden: 'wood', planks: 'wood', lakdi: 'wood',
};

export interface PickedTexture { surface: TextureSurface; variant: number; sha256: string; bytes: number; path: string }

/** Requested textures → pinned library entries. A surface word may be loose ("wall", "lakdi"); variant defaults to 1. PURE. */
export function pickTextures(asked: readonly unknown[]): { picked: PickedTexture[]; unknown: string[] } {
  const picked: PickedTexture[] = []; const unknown: string[] = [];
  for (const raw of asked.slice(0, MAX_PER_CALL)) {
    const r = (typeof raw === 'string' ? { surface: raw } : raw && typeof raw === 'object' ? raw : {}) as { surface?: unknown; variant?: unknown };
    const word = String(r.surface ?? '').trim().toLowerCase();
    const surface = (TEXTURE_SURFACES as readonly string[]).includes(word) ? word as TextureSurface : SURFACE_WORDS[word];
    const variant = Number.isInteger(r.variant) ? Number(r.variant) : 1;
    const entry = surface && TEXTURE_LIBRARY.find(([s, v]) => s === surface && v === variant);
    if (!entry) { unknown.push(word ? `${word}${r.variant !== undefined ? ` #${String(r.variant)}` : ''}` : '(no surface)'); continue; }
    const path = `${TEXTURES_DIR}/${entry[0]}-${entry[1]}.png`;
    if (!picked.some(p => p.path === path)) picked.push({ surface: entry[0], variant: entry[1], sha256: entry[2], bytes: entry[3], path });
  }
  return { picked, unknown };
}

/** The packaged PNG, only if its size and hash are exactly the pinned ones. */
export async function readPackagedTexture(t: Pick<PickedTexture, 'sha256' | 'bytes'>): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(t.sha256)) throw new Error('Unreviewed texture');
  const bytes = await readFile(join(process.cwd(), 'assets/game-models/textures', `${t.sha256}.png`));
  if (bytes.length !== t.bytes || createHash('sha256').update(bytes).digest('hex') !== t.sha256) throw new Error('Texture integrity mismatch');
  return bytes;
}

/** Durable first, exact read-back second, sandbox last. Each failure named. */
export async function addLibraryTextures(asked: readonly unknown[], workspaceId: string,
  workspace: { writeBinaryFile(workspaceId: string, path: string, base64: string): Promise<void> },
  store: Pick<GameAssetPersistence, 'saveBinary' | 'readBinary'>,
  read: (t: PickedTexture) => Promise<Uint8Array> = readPackagedTexture): Promise<{ added: PickedTexture[]; failed: string[]; unknown: string[] }> {
  const { picked, unknown } = pickTextures(asked);
  const added: PickedTexture[] = []; const failed: string[] = [];
  for (const t of picked) {
    try {
      const base64 = Buffer.from(await read(t)).toString('base64');
      await store.saveBinary(workspaceId, { [t.path]: `data:image/png;base64,${base64}` });
      const saved = await store.readBinary(workspaceId, t.path, t.bytes);
      if (!saved || createHash('sha256').update(saved).digest('hex') !== t.sha256) throw new Error('not saved');
      await workspace.writeBinaryFile(workspaceId, t.path, base64);
      added.push(t);
    } catch { failed.push(`${t.surface} #${t.variant}`); }
  }
  return { added, failed, unknown };
}

/** What the builder is told: the files, and the exact three.js lines that make a seamless surface of them. PURE. */
export function textureResultNote(r: { added: readonly PickedTexture[]; failed: readonly string[]; unknown: readonly string[] }): string {
  const lines: string[] = [];
  if (r.added.length) {
    lines.push(`Added textures (${TEXTURE_LICENSE.author}, CC0 — no credit needed): ${r.added.map(t => `${t.surface} #${t.variant} → /${t.path.replace(/^public\//, '')}`).join('; ')}.`
      + ` Use: const tex = new THREE.TextureLoader().load('/${r.added[0].path.replace(/^public\//, '')}'); tex.colorSpace = THREE.SRGBColorSpace;`
      + ` tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(widthInMetres / 2, depthInMetres / 2); tex.magFilter = THREE.NearestFilter (crisp pixel look) or LinearFilter (smooth);`
      + ` then material.map = tex (keep material.color white so the picture shows as drawn). They are tiny 128 px tiles: repeat them, never stretch one over a whole field.`);
  }
  if (r.unknown.length) lines.push(`Not a library texture: ${r.unknown.join(', ')}. Surfaces: ${TEXTURE_SURFACES.join(', ')}, each variant 1–25.`);
  if (r.failed.length) lines.push(`Could not be saved this time: ${r.failed.join(', ')} — nothing was changed for those.`);
  return lines.join('\n');
}
