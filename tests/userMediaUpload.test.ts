import { describe, expect, it } from 'vitest';
import { mediaBytesMatch, splitUserMedia, USER_MEDIA_MAX_BYTES } from '../src/server/AgentV3/gameAssets/userMedia';
import { planUserModels } from '../src/server/AgentV3/gameAssets/userModels';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);
const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0]);

function file(name: string, bytes: Uint8Array) {
  return { name, base64: Buffer.from(bytes).toString('base64'), type: 'application/octet-stream' };
}

describe('a user can upload a picture or a sound into the game', () => {
  it('accepts a real png, ogg and mp3, and refuses a renamed text file and an oversized file', () => {
    expect(mediaBytesMatch('png', png)).toBe(true);
    expect(mediaBytesMatch('ogg', ogg)).toBe(true);
    expect(mediaBytesMatch('mp3', mp3)).toBe(true);
    expect(mediaBytesMatch('png', ogg)).toBe(false);
    const big = new Uint8Array(USER_MEDIA_MAX_BYTES + 1);
    big.set(png);
    const split = splitUserMedia([
      file('grass.png', png),
      file('horn.ogg', ogg),
      file('engine.mp3', mp3),
      file('notes.png', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
      file('huge.ogg', big),
      file('readme.txt', new Uint8Array([65, 66])),
    ]);
    expect(split.files.map(f => f.path)).toEqual(['public/textures/grass.png', 'public/sounds/horn.ogg', 'public/sounds/engine.mp3']);
    expect(split.refused.map(r => r.from)).toEqual(['notes.png', 'huge.ogg']);
    expect(split.rest.map(r => r.name)).toEqual(['readme.txt']);
  });

  it('a lone sound is planned as media, not left as a document', async () => {
    const plan = await planUserModels([file('jump.ogg', ogg)]);
    expect(plan.media).toHaveLength(1);
    expect(plan.media[0].path).toBe('public/sounds/jump.ogg');
    expect(plan.rest).toEqual([]);
    expect(plan.pendingNote).toContain('public/sounds/jump.ogg');
    expect(plan.attached).toBe(true);
  });
});
