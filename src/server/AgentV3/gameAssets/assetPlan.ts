import { parseEnvFlag } from '../../lib/envFlag';
import { isZTestAccount } from '../../lib/zTestAccount';
import type { AssetRequirement } from './assetPolicy';
import { CATALOGUE_MAX_ENTRIES, type ReviewedAsset } from './providers';

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
  mage: ['mage', 'mages', 'जादूगर'], wizard: ['wizard', 'wizards'], barbarian: ['barbarian', 'barbarians'], rogue: ['rogue', 'rogues'],
  'hooded rogue': ['hooded rogue', 'hooded rogues'], hatchback: ['hatchback'], 'station wagon': ['station wagon'],
  'straight road tile': ['straight road tile'], 'road corner tile': ['road corner tile'], 'fire hydrant': ['fire hydrant'], dumpster: ['dumpster'], crate: ['crate', 'crates'],
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
  boxer: ['boxer', 'boxers', 'boxing', 'मुक्केबाज़', 'मुक्केबाज', 'बॉक्सर', 'बॉक्सिंग', 'boxeador', 'boxeo'],
  // 2026-11-19 library batch 2. Tile subjects stay literal so a bare "road" or "river" keeps the procedural terrain.
  motorcycle: ['motorcycle', 'motorcycles', 'motorbike', 'motorbikes', 'मोटरसाइकिल', 'बाइक', 'moto'],
  truck: ['truck', 'trucks', 'lorry', 'ट्रक', 'camión'], skeleton: ['skeleton', 'skeletons', 'कंकाल', 'esqueleto'],
  axe: ['axe', 'axes', 'कुल्हाड़ी', 'hacha'], crossbow: ['crossbow', 'crossbows', 'ballesta'], sword: ['sword', 'swords', 'तलवार', 'espada'],
  shield: ['shield', 'shields', 'ढाल', 'escudo'], blaster: ['blaster', 'blasters', 'laser gun', 'laser guns', 'ray gun'],
  coin: ['coin', 'coins', 'सिक्का', 'सिक्के', 'moneda', 'monedas'], 'coin block': ['coin block', 'coin blocks'],
  flag: ['flag', 'flags', 'झंडा', 'bandera'], 'flying enemy': ['flying enemy', 'flying enemies', 'enemy drone', 'enemy drones'],
  bed: ['bed', 'beds', 'पलंग', 'बिस्तर', 'cama'], armchair: ['armchair', 'armchairs'], shelf: ['shelf', 'shelves', 'bookshelf', 'bookshelves'],
  cactus: ['cactus', 'cacti', 'कैक्टस', 'नागफनी'], castle: ['castle', 'castles', 'महल', 'castillo', 'fort', 'forts', 'किला', 'fortress'],
  market: ['market', 'marketplace', 'bazaar', 'बाज़ार', 'बाजार', 'mercado'], tavern: ['tavern', 'taverns'], church: ['church', 'churches', 'iglesia'],
  watermill: ['watermill', 'water mill'], tower: ['tower', 'towers', 'मीनार', 'torre'], barracks: ['barracks'], bridge: ['bridge', 'bridges', 'पुल', 'puente'],
  'forest grove': ['forest grove', 'grove'], fence: ['fence', 'fences', 'बाड़', 'valla'], dustbin: ['dustbin', 'dustbins', 'कूड़ेदान', 'डस्टबिन', 'trash can', 'trash cans', 'garbage can'],
  'road junction tile': ['road junction tile'], 'road t junction tile': ['road t junction tile'], 'road crossing tile': ['road crossing tile', 'zebra crossing tile'],
  'curved road tile': ['curved road tile'], 'race track straight tile': ['race track straight tile'], 'race track corner tile': ['race track corner tile'],
  'race finish line': ['race finish line', 'finish line'],
  // 2026-11-19 library batch 3: food, kitchen, horror, sci-fi base, town and medieval pieces.
  burger: ['burger', 'burgers', 'बर्गर', 'hamburguesa'], meal: ['meal', 'meals', 'dinner plate', 'खाना', 'thali'], stew: ['stew', 'soup bowl'],
  tomato: ['tomato', 'tomatoes', 'टमाटर'], carrot: ['carrot', 'carrots', 'गाजर'], potato: ['potato', 'potatoes', 'आलू'], onion: ['onion', 'onions', 'प्याज', 'प्याज़'],
  cheese: ['cheese', 'चीज़', 'चीज'], 'vegetable crate': ['vegetable crate', 'vegetable crates', 'sabzi crate'],
  oven: ['oven', 'ovens', 'ओवन'], fridge: ['fridge', 'fridges', 'refrigerator', 'फ्रिज'], stove: ['stove', 'stoves', 'चूल्हा', 'gas stove'],
  'cooking pot': ['cooking pot', 'cooking pots', 'पतीला'], 'frying pan': ['frying pan', 'frying pans', 'kadhai', 'कड़ाही'],
  'round table': ['round table', 'round tables'], 'kitchen counter': ['kitchen counter', 'kitchen counters'],
  pumpkin: ['pumpkin', 'pumpkins', 'कद्दू'], 'jack o lantern': ['jack o lantern', 'jack o lanterns'], gravestone: ['gravestone', 'gravestones', 'tombstone', 'tombstones'],
  grave: ['grave', 'graves', 'कब्र', 'graveyard', 'cemetery', 'कब्रिस्तान'], coffin: ['coffin', 'coffins', 'ताबूत'], skull: ['skull', 'skulls', 'खोपड़ी'],
  'dead tree': ['dead tree', 'dead trees', 'spooky tree'], 'autumn tree': ['autumn tree', 'autumn trees'], lantern: ['lantern', 'lanterns', 'लालटेन'],
  crypt: ['crypt', 'crypts', 'tomb'], 'iron fence': ['iron fence', 'iron fences'], 'cemetery gate': ['cemetery gate', 'graveyard gate'],
  lander: ['lander', 'moon lander', 'landers'], 'space rover': ['space rover', 'mars rover', 'moon rover', 'rover'], 'wind turbine': ['wind turbine', 'wind turbines'],
  'solar panel': ['solar panel', 'solar panels', 'सोलर पैनल'], 'space base': ['space base', 'moon base', 'mars base', 'space colony'],
  'landing pad': ['landing pad', 'landing pads', 'helipad'], 'cargo container': ['cargo container', 'cargo containers', 'shipping container', 'shipping containers'],
  'drill rig': ['drill rig', 'mining drill'], fountain: ['fountain', 'fountains', 'फव्वारा', 'फ़व्वारा', 'fuente'], garage: ['garage', 'garages', 'गैराज'],
  blacksmith: ['blacksmith', 'लोहार'], 'mine entrance': ['mine entrance', 'gold mine', 'coal mine', 'mine shaft'], 'archery range': ['archery range'],
  sawmill: ['sawmill', 'lumber mill', 'lumbermill'], 'pine forest': ['pine forest', 'pine trees', 'pine tree'], boulder: ['boulder', 'boulders'],
  'water lily': ['water lily', 'water lilies', 'lily pad', 'lily pads'], door: ['door', 'doors', 'दरवाज़ा', 'दरवाजा', 'puerta'],
  stairs: ['stairs', 'staircase', 'सीढ़ी', 'सीढ़ियाँ', 'escaleras'], pallet: ['pallet', 'pallets'],
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
  const subjects = [...new Set([...Object.keys(ALIASES), ...catalogue.slice(0, CATALOGUE_MAX_ENTRIES).flatMap(c => c.subjects.slice(0, 16))])];
  const matching = (subject: string, clause: string) => {
    let scoped = ` ${clause} `;
    const excludedPhrases: Record<string, readonly string[]> = {
      table: ['table tennis', 'pool table', 'ping pong table', 'coffee table', 'dining table'],
      chair: ['wheel chair', 'rocking chair', 'office chair'],
      rock: ['rock music', 'rock band'], tree: ['tree diagram', 'decision tree'],
      stool: ['stool sample', 'stool test'], cabinet: ['cabinet minister', 'cabinet meeting'],
      lamp: ['street lamp', 'traffic lamp'],
      rogue: ['hooded rogue', 'hooded rogues'],
      flag: ['feature flag', 'red flag'], grave: ['grave danger', 'grave mistake'], door: ['door to door', 'door delivery'], market: ['stock market'], shield: ['shield powerup', 'shield power up'],
      car: ['formula one car', 'formula 1 car', 'f1 car', 'hatchback car', 'station wagon car'], building: ['building a', 'building the'],
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
      : ['human', 'knight', 'dog', 'cow', 'horse', 'deer', 'fox', 'mage', 'wizard', 'barbarian', 'rogue', 'hooded rogue', 'skeleton'].includes(subject)
        ? motion('run') ? 'run' : motion('walk') ? 'walk' : undefined : undefined;
    return { subject, ...(animation ? { animation } : {}) };
  });
}
