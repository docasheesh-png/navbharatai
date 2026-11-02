import { parseEnvFlag } from '../../lib/envFlag';
import type { AssetRequirement } from './assetPolicy';
import type { ReviewedAsset } from './providers';

/** Default OFF; enabling does not approve any unreviewed catalogue entry or paid service. */
export function externalGameAssetsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.AGENTV3_EXTERNAL_GAME_ASSETS) ?? false;
}
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  car: ['car', 'cars', 'gaadi'], train: ['train', 'trains', 'locomotive'],
  'railway station': ['railway station', 'train station'], bird: ['bird', 'birds'], eagle: ['eagle', 'eagles'], parrot: ['parrot', 'parrots'],
  ship: ['ship', 'ships'], human: ['human', 'person', 'people', 'humanoid'],
  dog: ['dog', 'dogs'], cow: ['cow', 'cows'], horse: ['horse', 'horses'], deer: ['deer'], fox: ['fox', 'foxes'],
  tree: ['tree', 'trees'], building: ['building', 'buildings'], aircraft: ['aircraft', 'airplane'],
};
function mentioned(text: string, phrase: string): boolean {
  return (` ${text.toLowerCase().replace(/[^a-z0-9 -]/g, ' ')} `).includes(` ${phrase} `);
}
/** Deterministic extraction costs no inference. Curated subjects extend coverage without broad substitution. */
export function gameAssetRequirements(prompt: string, catalogue: readonly ReviewedAsset[]): AssetRequirement[] {
  const text = prompt.slice(0, 16000).toLowerCase();
  const clauses = text.split(/[,;.!?]|\band\b/).map(s => s.trim()).filter(Boolean);
  const subjects = [...new Set([...Object.keys(ALIASES), ...catalogue.flatMap(c => c.subjects)])];
  const matching = (subject: string, clause: string) => {
    // A train station does not imply a locomotive; species must never broaden to another bird.
    const scoped = subject === 'train' ? clause.replace(/\btrain station\b/g, '') : clause;
    return (ALIASES[subject] ?? [subject]).some(word => mentioned(scoped, word));
  };
  const found = subjects.filter(subject => clauses.some(c => matching(subject, c)));
  return found.filter(subject => !(subject === 'bird' && found.some(s => ['eagle', 'parrot'].includes(s))))
    .slice(0, 6).map(subject => {
      const local = clauses.filter(c => matching(subject, c)).join(' ');
      const animation = ['bird', 'eagle', 'parrot'].includes(subject) && /\b(fly|flying|flight|flap)\b/.test(local) ? 'fly'
        : ['human', 'knight', 'dog', 'cow', 'horse', 'deer', 'fox'].includes(subject)
          ? /\b(run|running)\b/.test(local) ? 'run' : /\b(walk|walking)\b/.test(local) ? 'walk' : undefined
          : undefined;
      return { subject, ...(animation ? { animation } : {}) };
    });
}
