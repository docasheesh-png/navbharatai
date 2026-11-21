/**
 * Admin 2026-11-21 (Indian clothing — saree, dhoti, kurta, pagdi): no CC0 rigged model exists, so CC-BY 4.0 models
 * (credit required) may be PACKAGED too — only with the author's credit, which then travels into the game's credits.
 * A packaged Sketchfab model (downloaded by the admin, converted offline) needs no download adapter; a non-packaged one
 * still does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateCatalogue } from '../src/server/AgentV3/gameAssets/providers';
import { REVIEWED_LIBRARY_BATCH_6 } from '../src/server/AgentV3/gameAssets/reviewedLibraryBatch6';

const base = REVIEWED_LIBRARY_BATCH_6.find(a => a.id === 'q6-gun-pistol')!;
const ccby = { ...base, provider: 'sketchfab', id: 'sf-test', downloadUrl: 'https://sketchfab.com/3d-models/test', sourceUrl: 'https://sketchfab.com/3d-models/test',
  downloadOrigins: ['https://sketchfab.com'], license: { ...base.license, spdx: 'CC-BY-4.0', evidenceUrl: 'https://sketchfab.com/3d-models/test', author: 'A. Author',
    attribution: '"Indian Man In Dhoti" by A. Author (sketchfab.com/a-author), CC BY 4.0' } };

describe('a CC-BY model may ship packaged, and only with its credit', () => {
  it('packaged CC-BY with a credit line is accepted; without one, or unpackaged from Sketchfab, it is refused', () => {
    expect(() => validateCatalogue([ccby as never])).not.toThrow();
    expect(() => validateCatalogue([{ ...ccby, license: { ...ccby.license, attribution: '' } } as never])).toThrow(/Unreviewed (packaged model|catalogue entry)/);
    const { packaged: _p, ...unpackaged } = ccby;
    expect(() => validateCatalogue([unpackaged as never])).toThrow(/Sketchfab requires a separately authorized download adapter/);
  });
  it('the credit of a CC-BY model reaches the game (the seed writes it as the in-game credit and into ATTRIBUTION.txt)', () => {
    const seed = readFileSync('src/server/AgentV3/gameAssets/assetSeed.ts', 'utf8');
    expect(seed).toMatch(/c\.license\.spdx === 'CC-BY-4\.0' \? \{ attributionCredit: `\$\{c\.license\.author\} — CC BY 4\.0` \}/);
    expect(seed).toMatch(/'public\/game-assets\/ATTRIBUTION\.txt': mergedCredits/);
  });
});
