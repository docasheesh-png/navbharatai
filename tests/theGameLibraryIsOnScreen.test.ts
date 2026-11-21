/**
 * The in-app Game library (2026-11-19): a user browses the reviewed models with pictures and taps one to add it.
 * Locks: (1) the list is the catalogue itself, one row per model, with no source name; (2) a picture exists for every
 * model whose licence allows one, and only those are served; (3) the instruction names the exact library id, and
 * add_library_models pins that model even when other models share its subject; (4) the client trusts only a
 * library-shaped answer.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { REVIEWED_GAME_ASSETS } from '../src/server/AgentV3/gameAssets/providers';
import { browseLibrary, libraryDisplayName, libraryBrowseRows, libraryThumbPath, addToGamePrompt, thumbnailAllowed, LIBRARY_THUMB_DIR } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { parseLibraryResponse } from '../src/components/agentv3/GameLibraryPicker';

const distinct = [...new Map(REVIEWED_GAME_ASSETS.map((c) => [c.sha256, c])).values()];

describe('the library on screen is the catalogue the builder fetches from', () => {
  it('one row per reviewed model, nothing more, nothing less', () => {
    const rows = libraryBrowseRows();
    expect(rows.map((r) => r.id).sort()).toEqual(distinct.map((c) => c.id).sort());
  });

  it('no row carries a provider, pack or author name (White-Label Law)', () => {
    const names = new Set(REVIEWED_GAME_ASSETS.flatMap((c) => [c.provider, c.license.author]).map((s) => String(s).toLowerCase()).filter((s) => s.length > 3));
    for (const r of libraryBrowseRows()) {
      const shown = `${r.name} ${r.category}`.toLowerCase();
      for (const n of names) expect(shown.includes(n), `${r.id} shows ${n}`).toBe(false);
    }
  });

  it('a name is the object, never an internal batch or pack prefix', () => {
    expect(libraryDisplayName('lib4-cow')).toBe('Cow');
    expect(libraryDisplayName('city-car_taxi')).toBe('Car Taxi');
    expect(libraryDisplayName('fox')).toBe('Fox');
    for (const r of libraryBrowseRows()) expect(r.name, r.id).not.toMatch(/^(Lib\d|Library |City |Medieval |Prototype |Adventurers )/);
  });

  it('search matches names and subjects; category filters; limit is bounded', () => {
    const cow = distinct.find((c) => c.subjects.includes('cow'));
    if (cow) expect(browseLibrary({ q: 'cow' }).rows.some((r) => r.id === cow.id)).toBe(true);
    const cat = browseLibrary({}).categories[0].category;
    expect(browseLibrary({ category: cat, limit: 500 }).rows.every((r) => r.category === cat)).toBe(true);
    expect(browseLibrary({ limit: 500 }).rows.length).toBeLessThanOrEqual(120);
    expect(browseLibrary({ q: 'zzzz-not-a-model' }).total).toBe(0);
  });
});

describe('pictures', () => {
  it('every model whose licence allows a picture has one, and it is a real webp', () => {
    const missing = distinct.filter((c) => thumbnailAllowed(c) && !existsSync(`${LIBRARY_THUMB_DIR}/${c.sha256}.webp`)).map((c) => c.id);
    expect(missing).toEqual([]);
    for (const c of distinct.filter(thumbnailAllowed)) {
      const path = `${LIBRARY_THUMB_DIR}/${c.sha256}.webp`;
      expect(statSync(path).size, c.id).toBeGreaterThan(400);
      expect(readFileSync(path).subarray(8, 12).toString('latin1'), c.id).toBe('WEBP');
    }
  });

  it('a CC BY model gets no picture (it would need an on-screen credit) and shows a plain tile', () => {
    const ccby = distinct.find((c) => c.license.spdx === 'CC-BY-4.0');
    if (!ccby) return;
    expect(libraryThumbPath(ccby.sha256)).toBeNull();
    expect(libraryBrowseRows(undefined, () => true).find((r) => r.id === ccby.id)?.thumb).toBeNull();
  });

  it('only a catalogue hash is ever served; paths and unknown hashes are refused', () => {
    expect(libraryThumbPath('../../etc/passwd')).toBeNull();
    expect(libraryThumbPath('a'.repeat(64))).toBeNull();
    const ok = distinct.find(thumbnailAllowed)!;
    expect(libraryThumbPath(ok.sha256)).toMatch(/thumbs\/[a-f0-9]{64}\.webp$/);
  });

  it('every thumbnail file in the directory belongs to a model (no orphans ship)', () => {
    const files = readdirSync(LIBRARY_THUMB_DIR);
    const hashes = new Set(distinct.filter(thumbnailAllowed).map((c) => c.sha256));
    expect(files.filter((f) => !hashes.has(f.replace(/\.webp$/, '')))).toEqual([]);
  });
});

describe('tapping a model names that exact model', () => {
  it('the instruction carries the library id', () => {
    const row = libraryBrowseRows()[0];
    expect(addToGamePrompt(row)).toContain(`library id: "${row.id}"`);
  });

  it('add_library_models pins an id: other models sharing its subjects are left out of the catalogue it passes', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    // The model half moved out of the switch unchanged (2026-11-21, textures joined the tool): the case delegates to it.
    const caseBlock = src.slice(src.indexOf("case 'add_library_models'"), src.indexOf("case 'add_library_models'") + 1200);
    expect(caseBlock).toMatch(/await this\.addLibraryModelsForTool\(input, agent\)/);
    const block = src.slice(src.indexOf('private async addLibraryModelsForTool('), src.indexOf('private async addLibraryModelsForTool(') + 6000);
    expect(block).toMatch(/REVIEWED_GAME_ASSETS\.find\(\(c\) => c\.id === m\.id\)/);
    expect(block).toMatch(/pins\.includes\(c\) \|\| !c\.subjects\.some/);
    expect(block).toMatch(/addLibraryModels\(\{ requirements, \.\.\.\(catalogue \? \{ catalogue \} : \{\}\)/);
  });
});

describe('the client trusts only a library-shaped answer', () => {
  it('accepts a real answer and drops malformed rows and foreign picture urls', () => {
    const parsed = parseLibraryResponse({
      enabled: true, total: 2, categories: [{ category: 'animals', count: 2 }], prompts: { cow: 'Add cow', bad: 5 },
      rows: [
        { id: 'cow', name: 'Cow', category: 'animals', subjects: ['cow'], animations: ['walk'], thumb: '/api/agentv3/game-library/thumb/' + 'a'.repeat(64) },
        { id: 'evil', name: 'Evil', category: 'x', subjects: [], animations: [], thumb: 'https://elsewhere.example/x.webp' },
      ],
    });
    expect(parsed?.rows.map((r) => r.id)).toEqual(['cow']);
    expect(parsed?.prompts).toEqual({ cow: 'Add cow' });
  });
  it('anything else is an error, never data', () => {
    for (const body of [null, 'x', { error: 'nope' }, { enabled: 'yes', rows: [], total: 0, categories: [], prompts: {} }]) expect(parseLibraryResponse(body)).toBeNull();
  });
});
