/**
 * Admin 2026-11-21: "texture pack: zameen, deewar aur lakdi ki surface". Screaming Brain Studios' Tiny Texture Pack (CC0),
 * the admin's own download: 125 seamless 128 px surfaces, packaged in the image and put into a game by
 * add_library_models({ textures }) — durably first, like library models — with the exact three.js lines to use them.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TEXTURE_LIBRARY, TEXTURE_SURFACES, TEXTURE_LICENSE } from '../src/server/AgentV3/gameAssets/textureLibraryData';
import { pickTextures, addLibraryTextures, textureResultNote, readPackagedTexture } from '../src/server/AgentV3/gameAssets/textureLibrary';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { gameLibraryMenuHandoff } from '../src/server/AgentV3/gameAssets/gameLibrarySelection';

describe('the texture library', () => {
  it('125 surfaces, 25 per kind, each a packaged 128 x 128 PNG with exactly its pinned size and hash; CC0', () => {
    expect(TEXTURE_LIBRARY).toHaveLength(125);
    for (const s of TEXTURE_SURFACES) expect(TEXTURE_LIBRARY.filter(t => t[0] === s).map(t => t[1])).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    for (const [surface, variant, sha, bytes] of TEXTURE_LIBRARY) {
      const b = readFileSync(`assets/game-models/textures/${sha}.png`);
      expect([b.length, createHash('sha256').update(b).digest('hex')], `${surface} ${variant}`).toEqual([bytes, sha]);
      expect(b.subarray(1, 4).toString()).toBe('PNG');
      expect([b.readUInt32BE(16), b.readUInt32BE(20)]).toEqual([128, 128]);
    }
    expect(TEXTURE_LICENSE).toMatchObject({ spdx: 'CC0-1.0', author: 'Screaming Brain Studios' });
    // The image copies the whole assets/game-models folder, textures included.
    expect(readFileSync('Dockerfile', 'utf8')).toMatch(/COPY --from=builder \/app\/assets\/game-models \.\/assets\/game-models/);
  });

  it('a request names a surface plainly (wall, ground, lakdi) and a variant, defaulting to 1; nonsense is named back', () => {
    const { picked, unknown } = pickTextures([{ surface: 'grass' }, { surface: 'wall', variant: 3 }, 'lakdi', { surface: 'marble' }, { surface: 'tile', variant: 99 }, { surface: 'grass' }]);
    expect(picked.map(p => p.path)).toEqual(['public/game-assets/textures/grass-1.png', 'public/game-assets/textures/bricks-3.png', 'public/game-assets/textures/wood-1.png']);
    expect(unknown).toEqual(['marble', 'tile #99']);
  });

  it('durable first, exact read-back, then the sandbox; a texture whose save does not read back is not written and is named', async () => {
    const saved = new Map<string, string>();
    const store = {
      saveBinary: vi.fn(async (_: string, f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) if (!p.includes('wood')) saved.set(p, c); }),
      readBinary: vi.fn(async (_: string, p: string) => saved.has(p) ? Buffer.from(saved.get(p)!.split(',')[1], 'base64') : null),
    };
    const writeBinaryFile = vi.fn(async () => {});
    const r = await addLibraryTextures([{ surface: 'grass' }, { surface: 'wood' }], 'w', { writeBinaryFile }, store);
    expect(r.added.map(t => t.surface)).toEqual(['grass']);
    expect(r.failed).toEqual(['wood #1']);
    expect(writeBinaryFile).toHaveBeenCalledTimes(1);
    expect(writeBinaryFile).toHaveBeenCalledWith('w', 'public/game-assets/textures/grass-1.png', expect.any(String));
    const note = textureResultNote(r);
    expect(note).toMatch(/grass #1 → \/game-assets\/textures\/grass-1\.png/);
    expect(note).toMatch(/RepeatWrapping/); expect(note).toMatch(/SRGBColorSpace/); expect(note).toMatch(/never stretch/);
    expect(note).toMatch(/Could not be saved this time: wood #1/);
  });

  it('an altered entry is refused before anything is written', async () => {
    const grass = TEXTURE_LIBRARY[25];
    await expect(readPackagedTexture({ sha256: 'f'.repeat(64), bytes: grass[3] })).rejects.toThrow();
    await expect(readPackagedTexture({ sha256: grass[2], bytes: grass[3] + 1 })).rejects.toThrow('Texture integrity mismatch');
  });

  it('the builder can ask for them: add_library_models takes `textures`, and the library menu lists the surfaces', () => {
    const tool = defaultToolCatalog().find(t => t.name === 'add_library_models')!;
    const props = (tool.input_schema as { properties: Record<string, { items?: { properties?: { surface?: { enum?: string[] } } } }>; required?: string[] }).properties;
    expect(props.textures.items!.properties!.surface!.enum).toEqual(['bricks', 'grass', 'roofs', 'tile', 'wood']);
    expect((tool.input_schema as { required?: string[] }).required).toEqual([]);
    expect(gameLibraryMenuHandoff()).toMatch(/textures \(add_library_models \{ textures \}\)/);
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toMatch(/const textureNote = textureAsk\.length \? await this\.addLibraryTexturesForTool\(textureAsk\) : '';/);
  });
});
