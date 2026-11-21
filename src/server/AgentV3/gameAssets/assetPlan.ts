import { parseEnvFlag } from '../../lib/envFlag';
import { isZTestAccount } from '../../lib/zTestAccount';
import { candidateMatches, type AssetRequirement } from './assetPolicy';
import { CATALOGUE_MAX_ENTRIES, type ReviewedAsset } from './providers';

/**
 * 🟢 DEFAULT ON (admin 2026-11-20, verbatim: "mujhe cloud run me kuch nahi dalna aap default on kar dena"). failedbr #2478
 * showed "3D assets 0.0 s (off)": the reviewed model library (characters, vehicles, buildings, props) never reached a
 * user's game because the switch was default OFF and nobody set it. ON does not approve any unreviewed catalogue entry
 * or paid service — only the reviewed, hash-pinned library is used, and a model that does not arrive leaves the
 * procedural kit in place (assetSeed: "the procedural kit remains the floor").
 *   unset / empty / on / true / 1 / yes  ⇒ every user
 *   AGENTV3_EXTERNAL_GAME_ASSETS=off      ⇒ nobody (kill switch; also false / 0 / no)
 *   any OTHER value (a typo)              ⇒ nobody — someone tried to configure it, so fail safe
 *   AGENTV3_EXTERNAL_GAME_ASSETS=admin   ⇒ limited rollout: only the owner test uid plus verified uids listed in
 *                                          AGENTV3_EXTERNAL_GAME_ASSETS_UIDS (comma list)
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
  if (raw === '') return true;
  return parseEnvFlag(raw) ?? false;
}
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  mage: ['mage', 'mages', 'जादूगर'], wizard: ['wizard', 'wizards'], barbarian: ['barbarian', 'barbarians'], rogue: ['rogue', 'rogues'],
  'hooded rogue': ['hooded rogue', 'hooded rogues'], hatchback: ['hatchback'], 'station wagon': ['station wagon'],
  'straight road tile': ['straight road tile'], 'road corner tile': ['road corner tile'], 'fire hydrant': ['fire hydrant'], dumpster: ['dumpster'], crate: ['crate', 'crates'],
  car: ['car', 'cars', 'कार', 'कारें', 'coche', 'coches', 'auto'],
  // Library batch 6 (2026-11-20): the library's first firearms and more cars — the words a BGMI-style prompt uses.
  gun: ['gun', 'guns', 'बंदूक', 'बंदूकें', 'bandook', 'bandooq'], pistol: ['pistol', 'pistols', 'पिस्तौल', 'पिस्टल'],
  rifle: ['rifle', 'rifles', 'राइफल'], 'assault rifle': ['assault rifle', 'assault rifles', 'ak47', 'ak-47', 'm4', 'm416'],
  'sniper rifle': ['sniper rifle', 'sniper rifles', 'sniper', 'snipers', 'स्नाइपर', 'awm', 'kar98'], shotgun: ['shotgun', 'shotguns', 'शॉटगन'],
  smg: ['smg', 'smgs', 'submachine gun', 'submachine guns', 'uzi', 'ump'], revolver: ['revolver', 'revolvers', 'रिवॉल्वर'],
  suv: ['suv', 'suvs', 'jeep', 'jeeps', 'जीप'], 'sports car': ['sports car', 'sports cars', 'स्पोर्ट्स कार'],
  train: ['train', 'trains', 'locomotive', 'ट्रेन', 'रेलगाड़ी', 'tren', 'trenes'],
  'railway station': ['railway station', 'train station', 'रेलवे स्टेशन', 'ट्रेन स्टेशन', 'estación de tren'],
  bird: ['bird', 'birds', 'पक्षी', 'चिड़िया', 'चिड़ियाँ', 'pájaro', 'pájaros'],
  eagle: ['eagle', 'eagles', 'चील', 'águila'], parrot: ['parrot', 'parrots', 'तोता', 'तोते', 'loro'],
  ship: ['ship', 'ships', 'जहाज', 'जहाज़', 'barco', 'barcos'],
  human: ['human', 'person', 'people', 'humanoid', 'इंसान', 'मानव', 'persona', 'personas'],
  dog: ['dog', 'dogs', 'कुत्ता', 'कुत्ते', 'perro'], cow: ['cow', 'cows', 'गाय', 'gaay', 'vaca'],
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
  // 2026-11-19 library batch 4: people (walk/run), vehicles, boats and animals.
  man: ['man', 'men', 'आदमी', 'पुरुष', 'hombre'], woman: ['woman', 'women', 'lady', 'औरत', 'महिला', 'mujer'],
  'old man': ['old man', 'old men', 'grandfather', 'दादा', 'बूढ़ा', 'बुज़ुर्ग'], 'old woman': ['old woman', 'old women', 'grandmother', 'दादी', 'बूढ़ी'],
  farmer: ['farmer', 'farmers', 'किसान', 'kisan'], 'racing driver': ['racing driver', 'race driver', 'racer', 'racers'],
  mechanic: ['mechanic', 'mechanics', 'मिस्त्री', 'मैकेनिक'], worker: ['worker', 'workers', 'labourer', 'laborer', 'मज़दूर', 'मजदूर'],
  businessman: ['businessman', 'businessmen', 'office worker'],
  ambulance: ['ambulance', 'ambulances', 'एम्बुलेंस'], bicycle: ['bicycle', 'bicycles', 'cycle', 'cycles', 'साइकिल'], bus: ['bus', 'buses', 'बस'],
  'fire truck': ['fire truck', 'fire trucks', 'fire engine', 'दमकल'], 'garbage truck': ['garbage truck', 'garbage trucks', 'kachra gadi'],
  'water tanker': ['water tanker', 'water tankers', 'tanker'], 'electric car': ['electric car', 'electric cars', 'ev'],
  boat: ['boat', 'boats', 'fishing boat', 'नाव', 'नौका', 'kashti', 'barca'], canoe: ['canoe', 'canoes', 'kayak'], jetty: ['jetty', 'pier', 'dock'],
  capybara: ['capybara', 'capybaras'], toucan: ['toucan', 'toucans'], heron: ['heron', 'herons', 'crane bird', 'बगुला'], frog: ['frog', 'frogs', 'मेंढक'],
  jaguar: ['jaguar', 'jaguars', 'leopard', 'cheetah', 'तेंदुआ', 'चीता'], puma: ['puma', 'cougar', 'mountain lion'], wolf: ['wolf', 'wolves', 'भेड़िया'],
  monkey: ['monkey', 'monkeys', 'बंदर', 'mono'], tapir: ['tapir'], sloth: ['sloth', 'sloths'], armadillo: ['armadillo'], 'wild pig': ['wild pig', 'wild boar', 'boar', 'जंगली सूअर'],
  otter: ['otter', 'otters', 'ऊदबिलाव'], bat: ['bat', 'bats', 'चमगादड़'], whale: ['whale', 'whales', 'व्हेल'], dolphin: ['dolphin', 'dolphins', 'डॉल्फिन'],
  manatee: ['manatee', 'sea cow'], shark: ['shark', 'sharks', 'शार्क', 'tiburón'], 'hammerhead shark': ['hammerhead', 'hammerhead shark'],
  'manta ray': ['manta ray', 'stingray', 'ray fish'], seahorse: ['seahorse', 'sea horse'], fish: ['fish', 'fishes', 'मछली', 'machli', 'pez'],
  turtle: ['turtle', 'turtles', 'tortoise', 'कछुआ'], crab: ['crab', 'crabs', 'केकड़ा'], starfish: ['starfish', 'sea star'],
  snake: ['snake', 'snakes', 'साँप', 'सांप', 'serpiente'], lizard: ['lizard', 'lizards', 'छिपकली', 'iguana'], 'harpy eagle': ['harpy eagle'],
  duck: ['duck', 'ducks', 'बत्तख', 'pato'], hummingbird: ['hummingbird', 'hummingbirds'], butterfly: ['butterfly', 'butterflies', 'तितली'],
  dragonfly: ['dragonfly', 'dragonflies'], ant: ['ant', 'ants', 'चींटी'],
  // 2026-11-19 library batch 5: public buildings, commerce, energy, nature, farm, street and dirt roads.
  school: ['school', 'schools', 'स्कूल', 'विद्यालय'], hospital: ['hospital', 'hospitals', 'अस्पताल'], 'police station': ['police station', 'thana', 'थाना'],
  'fire station': ['fire station'], library: ['library building', 'public library', 'पुस्तकालय'], museum: ['museum', 'museums', 'संग्रहालय'],
  'town hall': ['town hall', 'city hall'], university: ['university', 'college', 'campus'], monument: ['monument', 'statue', 'स्मारक'],
  bank: ['bank building', 'बैंक'], hotel: ['hotel', 'hotels', 'होटल'], 'shopping mall': ['shopping mall', 'mall', 'मॉल'], restaurant: ['restaurant', 'restaurants', 'dhaba', 'ढाबा'],
  supermarket: ['supermarket', 'grocery store', 'kirana'], 'charging station': ['charging station', 'ev charger'], factory: ['factory', 'factories', 'फैक्ट्री', 'कारखाना'],
  warehouse: ['warehouse', 'godown', 'गोदाम'], port: ['harbour', 'harbor', 'seaport', 'बंदरगाह'], skyscraper: ['skyscraper', 'skyscrapers', 'tower block'],
  apartment: ['apartment', 'apartments', 'flat building'], bakery: ['bakery', 'bakeries'], dam: ['dam', 'dams', 'बांध', 'बाँध'],
  'wind farm': ['wind farm', 'windmills farm'], 'nuclear plant': ['nuclear plant', 'power plant'], 'solar farm': ['solar farm', 'solar plant'],
  'palm tree': ['palm tree', 'palm trees', 'coconut tree', 'नारियल का पेड़'], 'banana tree': ['banana tree', 'banana plant', 'केले का पेड़'],
  bamboo: ['bamboo', 'बांस'], 'tree stump': ['tree stump', 'stump'], log: ['wooden log', 'fallen log', 'logs', 'लकड़ी का लट्ठा'],
  'rock pile': ['rock pile', 'pile of rocks', 'stones', 'पत्थर'], flowers: ['flowers', 'flower bed', 'फूल'], 'tall grass': ['tall grass', 'घास'],
  'lotus leaf': ['lotus leaf', 'lotus leaves', 'lily pad'], 'termite mound': ['termite mound', 'anthill'],
  scarecrow: ['scarecrow', 'बिजूका'], 'hay bale': ['hay bale', 'hay bales', 'haystack', 'भूसा'], beehive: ['beehive', 'bee hive', 'मधुमक्खी का छत्ता'],
  'farm gate': ['farm gate'], firewood: ['firewood', 'लकड़ियाँ'], 'vegetable garden': ['vegetable garden', 'kitchen garden'],
  'traffic cone': ['traffic cone', 'traffic cones', 'cone'], 'food cart': ['food cart', 'thela', 'ठेला', 'popcorn cart'], 'market stall': ['market stall', 'stall', 'stalls'],
  'stop sign': ['stop sign', 'stop signs'], 'bus stop': ['bus stop', 'bus stops', 'बस स्टॉप'], playground: ['playground', 'park swings', 'झूला'],
  wheelbarrow: ['wheelbarrow'], 'dirt road tile': ['dirt road tile', 'kaccha road tile', 'kachcha road tile'], 'dirt road curve tile': ['dirt road curve tile'],
  'road bridge': ['road bridge', 'flyover'],
  // 2026-11-20 library batch 7: clothed, animated characters (walk/run/jump/crouch/aim/shoot/reload/die/hit/drive).
  villager: ['villager', 'villagers', 'गाँव वाला', 'गांव वाला', 'गाँव वाले', 'गांव वाले', 'ग्रामीण', 'gaon wala', 'gaonwala'],
  peasant: ['peasant', 'peasants'], 'village man': ['village man', 'village men'],
  'village woman': ['village woman', 'village women', 'गाँव की औरत', 'गांव की औरत', 'गाँव की महिला', 'गांव की महिला'],
  ranger: ['ranger', 'rangers'], 'female ranger': ['female ranger', 'female rangers'],
  archer: ['archer', 'archers', 'तीरंदाज', 'तीरंदाज़'], 'female archer': ['female archer', 'female archers', 'woman archer', 'archer girl'],
  hunter: ['hunter', 'hunters', 'शिकारी', 'shikari'],
  // 2026-11-20 library batch 8 (KayKit Adventurers 2.0): a bowman and fantasy props.
  bowman: ['bowman', 'bowmen'], 'cartoon archer': ['cartoon archer', 'chibi archer'],
  bow: ['bow', 'bows', 'bow and arrow', 'धनुष', 'dhanush'], arrow: ['arrow', 'arrows', 'तीर', 'teer'], 'arrow bundle': ['arrow bundle', 'bundle of arrows'],
  quiver: ['quiver', 'तरकश'], dagger: ['dagger', 'daggers', 'knife', 'चाकू', 'खंजर', 'chaku'],
  greatsword: ['greatsword', 'great sword', 'two handed sword', 'big sword'], 'battle axe': ['battle axe', 'war axe'],
  'round shield': ['round shield'], 'spiked shield': ['spiked shield'], 'magic staff': ['magic staff', 'wizard staff', 'mage staff'],
  'magic wand': ['magic wand', 'wand', 'जादू की छड़ी'], spellbook: ['spellbook', 'spell book', 'magic book'],
  book: ['book', 'books', 'किताब', 'kitab'], mug: ['mug', 'beer mug', 'tankard'], 'smoke bomb': ['smoke bomb', 'smoke grenade'],
  // 2026-11-20 library batch 9: the Farm Animal Pack — animals that move.
  'farm cow': ['farm cow', 'dairy cow'], 'farm horse': ['farm horse'], zebra: ['zebra', 'zebras', 'ज़ेबरा', 'जेबरा'],
  llama: ['llama', 'llamas', 'alpaca'], pig: ['pig', 'pigs', 'piglet', 'सूअर', 'suar'], sheep: ['sheep', 'lamb', 'भेड़', 'bhed'], pug: ['pug', 'pugs'],
  // 2026-11-20 library batch 10 (Downtown City MegaKit): whole city buildings, city street tiles, sidewalks, street props.
  'city building': ['city building', 'office building', 'office tower', 'city buildings', 'office buildings'], 'heritage building': ['heritage building', 'old building', 'brick building'],
  'shop building': ['shop building', 'shops building', 'corner shop'], 'city street': ['city street', 'city road', 'two lane road'],
  'four lane road': ['four lane road', '4 lane road', 'highway road'], 'city crossroads': ['crossroads', 'city crossroads', 'chauraha', 'चौराहा'],
  'city t junction': ['t junction', 'city t junction', 'tiraha', 'तिराहा'], 'city street curve': ['city street curve', 'road curve', 'road turn'],
  'four lane road curve': ['four lane road curve'], sidewalk: ['sidewalk', 'footpath', 'pavement', 'फुटपाथ'], 'sidewalk corner': ['sidewalk corner', 'footpath corner'],
  'ac unit': ['ac unit', 'air conditioner', 'aircon'], bollard: ['bollard', 'bollards'], manhole: ['manhole', 'manhole cover', 'gutter cover'],
  planter: ['planter', 'flower pot', 'gamla', 'गमला'], 'street drain': ['street drain', 'drain grate', 'naali'],
  // 2026-11-21 library batch 11 (Medieval Village MegaKit): two whole village houses assembled from its pieces, and props.
  'village house': ['village house', 'village houses', 'gaon ka ghar', 'गाँव का घर', 'गांव का घर'], cottage: ['cottage', 'cottages', 'kutiya', 'कुटिया'],
  wagon: ['wagon', 'wagons', 'cart', 'carts', 'wooden cart'], 'wooden fence': ['wooden fence', 'wood fence', 'lakdi ki baad', 'लकड़ी की बाड़'],
  'stone stairs': ['stone stairs', 'stone steps', 'outdoor stairs'], chimney: ['chimney', 'chimneys', 'चिमनी'], vine: ['vine', 'vines', 'creeper', 'बेल'],
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
      flag: ['feature flag', 'red flag'],
      woman: ['old woman', 'old women', 'wonder woman', 'village woman', 'village women', 'woman archer'], bat: ['cricket bat', 'baseball bat', 'bat and ball', 'bat ball'], mechanic: ['game mechanic', 'game mechanics'],
      worker: ['service worker', 'web worker', 'office worker'], bus: ['bus stop', 'bus stops', 'school bus stop'], school: ['school bus'], bank: ['river bank', 'blood bank'],
      ant: ['ant man'], log: ['log in', 'login', 'log file', 'log out'],
      bicycle: ['day night cycle', 'day and night cycle', 'life cycle', 'cycle through', 'weather cycle'], 'traffic cone': ['ice cream cone', 'ice cream cones'], grave: ['grave danger', 'grave mistake'], door: ['door to door', 'door delivery'], market: ['stock market'],
      car: ['formula one car', 'formula 1 car', 'f1 car', 'hatchback car', 'station wagon car',
        // A named kind of car is that model, not "a car" too (police car → car + police car was the old double).
        'police car', 'police cars', 'sports car', 'sports cars', 'पुलिस कार', 'स्पोर्ट्स कार'],
      building: ['building a', 'building the', 'city building', 'city buildings', 'office building', 'office buildings', 'heritage building', 'old building', 'brick building', 'shop building'],
      wagon: ['food cart', 'food carts', 'shopping cart', 'go cart', 'golf cart', 'cart page', 'add to cart', 'shopping carts'], house: ['village house', 'village houses', 'gaon ka ghar', 'गाँव का घर', 'गांव का घर'], fence: ['wooden fence', 'wood fence'], stairs: ['stone stairs'],
      sidewalk: ['sidewalk corner', 'footpath corner'], 'city street': ['city street curve'], 'four lane road': ['four lane road curve'],
      rifle: ['assault rifle', 'assault rifles', 'sniper rifle', 'sniper rifles'],
      // A named kind of character is that model, not the generic one too.
      ranger: ['power ranger', 'power rangers', 'female ranger', 'female rangers'], archer: ['female archer', 'female archers', 'woman archer', 'archer girl'],
      hunter: ['treasure hunter', 'treasure hunters', 'bug hunter', 'bug hunters', 'job hunter'],
      man: ['pac man', 'spider man', 'iron man', 'snow man', 'super man', 'he man', 'ant man', 'old man', 'old men', 'village man', 'village men'],
      arrow: ['arrow key', 'arrow keys', 'arrow button', 'arrow buttons', 'arrow bundle', 'bundle of arrows'],
      bow: ['bow tie', 'take a bow', 'rainbow'], book: ['book a', 'book now', 'book ticket', 'book tickets', 'book appointment', 'spell book', 'magic book'],
      sword: ['great sword', 'two handed sword', 'big sword'], axe: ['battle axe', 'war axe'], shield: ['shield powerup', 'shield power up', 'round shield', 'spiked shield'],
      dagger: ['knife and fork'],
      pig: ['wild pig', 'wild pigs', 'guinea pig', 'guinea pigs'], cow: ['farm cow', 'dairy cow', 'sea cow'], horse: ['farm horse', 'sea horse', 'seahorse'],
      gun: ['laser gun', 'laser guns', 'ray gun', 'submachine gun', 'submachine guns', 'water gun', 'nail gun', 'glue gun'],
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
      : ['human', 'knight', 'dog', 'cow', 'horse', 'deer', 'fox', 'mage', 'wizard', 'barbarian', 'rogue', 'hooded rogue', 'skeleton', 'man', 'woman', 'old man', 'old woman', 'farmer', 'racing driver', 'mechanic', 'worker', 'businessman',
        'villager', 'peasant', 'village man', 'village woman', 'ranger', 'female ranger', 'archer', 'female archer', 'hunter', 'bowman', 'cartoon archer', 'farm cow', 'farm horse', 'zebra'].includes(subject)
        ? motion('run') ? 'run' : motion('walk') ? 'walk' : undefined : undefined;
    return { subject, ...(animation ? { animation } : {}) };
  });
}

/**
 * One add_library_models entry → a catalogue requirement. The name may be a subject or any word the plan knows ("gaon
 * wala" → villager). An animation role is kept only when some model of that subject plays it: a role no model has would
 * otherwise make the subject itself unavailable (the model is still wanted; it just stands). The dropped role is returned
 * so the tool can say so instead of silently ignoring it.
 */
export function libraryRequirement(name: string, animation: unknown, catalogue: readonly ReviewedAsset[]): { requirement: AssetRequirement; droppedRole?: string } | null {
  const served = new Set(catalogue.slice(0, CATALOGUE_MAX_ENTRIES).flatMap(c => c.subjects));
  const wanted = name.trim().toLowerCase().slice(0, 64);
  const subject = served.has(wanted) ? wanted : gameAssetRequirements(wanted, catalogue).map(r => r.subject).find(s => served.has(s));
  if (!subject) return null;
  const role = typeof animation === 'string' ? animation.trim().toLowerCase().slice(0, 32) : '';
  if (!role) return { requirement: { subject } };
  return catalogue.some(c => candidateMatches(c, { subject, animation: role }))
    ? { requirement: { subject, animation: role } }
    : { requirement: { subject }, droppedRole: role };
}
