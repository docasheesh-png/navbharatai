import { parseEnvFlag } from '../../lib/envFlag';
import type { AssetRequirement } from './assetPolicy';
import type { ReviewedAsset } from './providers';

/** Default OFF; enabling does not approve any unreviewed catalogue entry or paid service. */
export function externalGameAssetsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_EXTERNAL_GAME_ASSETS) ?? false;
}
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  car: ['car', 'cars', 'racing', 'gaadi'], train: ['train', 'trains', 'railway'],
  'railway station': ['railway station', 'train station'], bird: ['bird', 'birds', 'parrot'],
  ship: ['ship', 'ships'], human: ['human', 'person', 'people', 'character'],
  dog: ['dog', 'dogs'], cow: ['cow', 'cows'], horse: ['horse', 'horses'], deer: ['deer'],
  tree: ['tree', 'trees'], building: ['building', 'buildings'], aircraft: ['aircraft', 'airplane'],
};
function mentioned(text: string, phrase: string): boolean {
  return (` ${text.toLowerCase().replace(/[^a-z0-9 -]/g, ' ')} `).includes(` ${phrase} `);
}
/** Deterministic extraction costs no inference. Curated subjects extend coverage without broad substitution. */
export function gameAssetRequirements(prompt: string, catalogue: readonly ReviewedAsset[]): AssetRequirement[] {
  const subjects = [...new Set([...Object.keys(ALIASES), ...catalogue.flatMap(c => c.subjects)])];
  return subjects.filter(subject => (ALIASES[subject] ?? [subject]).some(word => mentioned(prompt, word)))
    .slice(0, 6).map(subject => ({ subject,
      ...(subject === 'bird' && /\b(fly|flying|flight|flap)\b/i.test(prompt) ? { animation: 'fly' } : {}),
      ...(subject === 'human' && /\b(walk|walking)\b/i.test(prompt) ? { animation: 'walk' } : {}),
    }));
}
