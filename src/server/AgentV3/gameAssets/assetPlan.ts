import { parseEnvFlag } from '../../lib/envFlag';
import { isZTestAccount } from '../../lib/zTestAccount';
import type { AssetRequirement } from './assetPolicy';
import type { ReviewedAsset } from './providers';

/**
 * Default OFF; enabling does not approve any unreviewed catalogue entry or paid service.
 *   AGENTV3_EXTERNAL_GAME_ASSETS=on     ⇒ every user
 *   AGENTV3_EXTERNAL_GAME_ASSETS=admin  ⇒ limited rollout: only the owner test uid (z@gmail.com) plus
 *                                         verified uids listed in AGENTV3_EXTERNAL_GAME_ASSETS_UIDS (comma list)
 *   unset / off / anything else         ⇒ nobody
 * Uid must be the server-verified owner uid; no uid ⇒ not admitted in `admin` mode.
 */
export function externalGameAssetsEnabled(env: NodeJS.ProcessEnv = process.env, verifiedUid?: string | null): boolean {
  const raw = String(env.AGENTV3_EXTERNAL_GAME_ASSETS ?? '').trim().toLowerCase();
  if (raw === 'admin') {
    if (typeof verifiedUid !== 'string' || !verifiedUid) return false;
    if (isZTestAccount(null, verifiedUid)) return true;
    const list = String(env.AGENTV3_EXTERNAL_GAME_ASSETS_UIDS ?? '').split(',').map(v => v.trim()).filter(Boolean);
    return list.includes(verifiedUid);
  }
  return parseEnvFlag(env.AGENTV3_EXTERNAL_GAME_ASSETS) ?? false;
}
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  car: ['car', 'cars', 'कार', 'कारें', 'coche', 'coches', 'auto'],
  train: ['train', 'trains', 'locomotive', 'ट्रेन', 'रेलगाड़ी', 'tren', 'trenes'],
  'railway station': ['railway station', 'train station', 'रेलवे स्टेशन', 'ट्रेन स्टेशन', 'estación de tren'],
  bird: ['bird', 'birds', 'पक्षी', 'चिड़िया', 'चिड़ियाँ', 'pájaro', 'pájaros'],
  eagle: ['eagle', 'eagles', 'चील', 'águila'], parrot: ['parrot', 'parrots', 'तोता', 'तोते', 'loro'],
  ship: ['ship', 'ships', 'जहाज', 'जहाज़', 'barco', 'barcos'],
  human: ['human', 'person', 'people', 'humanoid', 'इंसान', 'मानव', 'persona', 'personas'],
  dog: ['dog', 'dogs', 'कुत्ता', 'कुत्ते', 'perro'], cow: ['cow', 'cows', 'गाय', 'vaca'],
  horse: ['horse', 'horses', 'घोड़ा', 'घोड़े', 'caballo'], deer: ['deer', 'हिरण', 'ciervo'],
  fox: ['fox', 'foxes', 'लोमड़ी', 'zorro'], tree: ['tree', 'trees', 'पेड़', 'árbol'],
  table: ['table', 'tables', 'मेज', 'मेज़', 'mesa'], chair: ['chair', 'chairs', 'कुर्सी', 'silla'],
  bench: ['bench', 'benches', 'बेंच'], rock: ['rock', 'rocks', 'चट्टान', 'roca'], plant: ['plant', 'plants', 'पौधा', 'planta'],
  stool: ['stool', 'stools', 'स्टूल', 'taburete'], sofa: ['sofa', 'sofas', 'सोफा', 'sofá'],
  cabinet: ['cabinet', 'cabinets', 'अलमारी', 'armario'], lamp: ['lamp', 'lamps', 'लैंप', 'lámpara'],
  building: ['building', 'buildings', 'इमारत', 'edificio'], aircraft: ['aircraft', 'airplane', 'विमान', 'avión'],
  // 2026-11-04 (L3 step 2): the subjects the expanded KayKit catalogue can serve.
  bush: ['bush', 'bushes', 'झाड़ी', 'झाड़ियाँ', 'arbusto'], streetlight: ['streetlight', 'street light', 'street lights', 'lamp post', 'स्ट्रीट लाइट', 'farola'],
  'traffic light': ['traffic light', 'traffic lights', 'traffic signal', 'ट्रैफिक लाइट', 'semáforo'], 'water tower': ['water tower', 'पानी की टंकी', 'torre de agua'],
  taxi: ['taxi', 'taxis', 'cab', 'टैक्सी'], 'police car': ['police car', 'police cars', 'पुलिस कार', 'coche de policía'],
  hill: ['hill', 'hills', 'पहाड़ी', 'colina'], mountain: ['mountain', 'mountains', 'पहाड़', 'पर्वत', 'montaña', 'montañas'],
  // Never the bare English 'well' or 'home': "runs well" / "home screen" would add a model nobody asked for.
  house: ['house', 'houses', 'hut', 'घर', 'मकान', 'झोपड़ी', 'casa'], well: ['water well', 'village well', 'कुआँ', 'कुआं', 'pozo'],
  windmill: ['windmill', 'windmills', 'पवनचक्की', 'molino'], target: ['target', 'targets', 'निशाना', 'लक्ष्य', 'diana'],
  barrel: ['barrel', 'barrels', 'ड्रम', 'बैरल', 'barril'], wall: ['wall', 'walls', 'दीवार', 'muro'],
};
const MOTIONS: Readonly<Record<string, readonly string[]>> = {
  fly: ['fly', 'flying', 'flight', 'flap', 'उड़ता', 'उड़ती', 'उड़ते', 'उड़ना', 'उड़ने', 'volando'],
  walk: ['walk', 'walking', 'चलता', 'चलती', 'चलते', 'चलना', 'चलने', 'caminando'],
  run: ['run', 'running', 'दौड़ता', 'दौड़ती', 'दौड़ते', 'दौड़ना', 'दौड़ने', 'corriendo'],
};
function normalized(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim().replace(/ +/g, ' ');
}
function mentioned(text: string, phrase: string): boolean {
  return (` ${text} `).includes(` ${normalized(phrase)} `);
}
/** Bounded deterministic vocabulary, with conservative clause rejection rather than guessed negation scope. */
export function gameAssetRequirements(prompt: string, catalogue: readonly ReviewedAsset[]): AssetRequirement[] {
  const clauses = prompt.slice(0, 16000).normalize('NFKC').toLowerCase()
    .split(/[,;.!?।]|\b(?:and|but)\b|(?:^|\s)(?:और|लेकिन|y|pero)(?=\s|$)/u).slice(0, 128)
    .map(normalized).filter(c => c && !['no', 'not', 'don t', 'dont', 'doesn t', 'isn t', 'can t', 'never', 'without', 'exclude', 'excluding', 'avoid', 'omit', 'remove', 'except', 'नहीं', 'न', 'बिना', 'मत', 'sin', 'excepto'].some(n => mentioned(c, n)));
  const subjects = [...new Set([...Object.keys(ALIASES), ...catalogue.slice(0, 64).flatMap(c => c.subjects.slice(0, 16))])];
  const matching = (subject: string, clause: string) => {
    let scoped = ` ${clause} `;
    const excludedPhrases: Record<string, readonly string[]> = {
      table: ['table tennis', 'pool table', 'ping pong table', 'coffee table', 'dining table'],
      chair: ['wheel chair', 'rocking chair', 'office chair'],
      rock: ['rock music', 'rock band'], tree: ['tree diagram', 'decision tree'],
      stool: ['stool sample', 'stool test'], cabinet: ['cabinet minister', 'cabinet meeting'],
      lamp: ['street lamp', 'traffic lamp'],
      car: ['formula one car', 'formula 1 car', 'f1 car'], building: ['building a', 'building the'],
    };
    if ((excludedPhrases[subject] ?? []).some(p => mentioned(clause, p))) return false;

    if (subject === 'train') for (const station of ALIASES['railway station']) scoped = scoped.replaceAll(` ${normalized(station)} `, ' ');
    if (subject === 'bird' && ['eagle', 'parrot'].some(s => ALIASES[s].some(w => mentioned(clause, w)))) return false;
    return (ALIASES[subject] ?? [subject]).some(word => mentioned(scoped.trim(), word));
  };
  return subjects.filter(subject => clauses.some(c => matching(subject, c))).slice(0, 6).map(subject => {
    const local = clauses.filter(c => matching(subject, c)).join(' ');
    const motion = (role: string) => MOTIONS[role].some(word => mentioned(local, word));
    const animation = ['bird', 'eagle', 'parrot'].includes(subject) && motion('fly') ? 'fly'
      : ['human', 'knight', 'dog', 'cow', 'horse', 'deer', 'fox'].includes(subject)
        ? motion('run') ? 'run' : motion('walk') ? 'walk' : undefined : undefined;
    return { subject, ...(animation ? { animation } : {}) };
  });
}
