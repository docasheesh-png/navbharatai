/** Library batch 2 (2026-11-19). Changing a row changes the reviewed catalogue: rebuild and re-admit. */
import { P, type Row } from './packs.mts';

export const REVIEWED_AT = '2026-11-19';
export const ROWS: Row[] = [
  // Vehicles
  { id: 'lib2-motorcycle', pack: P.racing, file: 'vehicle-motorcycle.glb', subjects: ['motorcycle'], category: 'vehicle-land', height: 1.2 },
  { id: 'lib2-truck-red', pack: P.racing, file: 'vehicle-truck-red.glb', subjects: ['truck'], category: 'vehicle-land', height: 2.6 },
  { id: 'lib2-truck-green', pack: P.racing, file: 'vehicle-truck-green.glb', subjects: ['truck'], category: 'vehicle-land', height: 2.6 },
  { id: 'lib2-truck-yellow', pack: P.racing, file: 'vehicle-truck-yellow.glb', subjects: ['truck'], category: 'vehicle-land', height: 2.6 },
  // Roads and tracks
  { id: 'lib2-road-junction', pack: P.city, file: 'road_junction.gltf', subjects: ['road junction tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-road-tsplit', pack: P.city, file: 'road_tsplit.gltf', subjects: ['road t junction tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-road-crossing', pack: P.city, file: 'road_straight_crossing.gltf', subjects: ['road crossing tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-road-curve', pack: P.city, file: 'road_corner_curved.gltf', subjects: ['curved road tile'], category: 'terrain', height: 0.1 },
  { id: 'lib2-track-straight', pack: P.racing, file: 'track-straight.glb', subjects: ['race track straight tile'], category: 'terrain', height: 0.5 },
  { id: 'lib2-track-corner', pack: P.racing, file: 'track-corner.glb', subjects: ['race track corner tile'], category: 'terrain', height: 0.5 },
  { id: 'lib2-track-finish', pack: P.racing, file: 'track-finish.glb', subjects: ['race finish line'], category: 'terrain', height: 3 },
  // Characters (animated enemies)
  ...(['Warrior', 'Minion', 'Mage', 'Rogue'] as const).map((n): Row => ({ id: `lib2-skeleton-${n.toLowerCase()}`, pack: P.skeletons, file: `Characters/gltf/Skeleton_${n}.glb`, subjects: ['skeleton'], category: 'character', height: 1.8, clips: { walk: 'Walking_A', run: 'Running_A', idle: 'Idle' } })),
  // Weapons and gear
  { id: 'lib2-axe', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Axe.gltf', subjects: ['axe'], category: 'weapon', height: 0.8 },
  { id: 'lib2-crossbow', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Crossbow.gltf', subjects: ['crossbow'], category: 'weapon', height: 0.4 },
  { id: 'lib2-blade', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Blade.gltf', subjects: ['sword'], category: 'weapon', height: 1.0 },
  { id: 'lib2-shield', pack: P.skeletons, file: 'Assets/gltf/Skeleton_Shield_Large_A.gltf', subjects: ['shield'], category: 'weapon', height: 0.9 },
  { id: 'lib2-blaster', pack: P.fps, file: 'blaster.glb', subjects: ['blaster'], category: 'weapon', height: 0.3 },
  { id: 'lib2-blaster-repeater', pack: P.fps, file: 'blaster-repeater.glb', subjects: ['blaster'], category: 'weapon', height: 0.35 },
  // Pickups and markers
  { id: 'lib2-coin', pack: P.platformer, file: 'coin.glb', subjects: ['coin'], category: 'collectible', height: 0.5 },
  { id: 'lib2-coin-block', pack: P.platformer, file: 'block-coin.glb', subjects: ['coin block'], category: 'collectible', height: 1 },
  { id: 'lib2-coin-gold', pack: P.proto, file: 'Coin_A.gltf', subjects: ['coin'], category: 'collectible', height: 0.5 },
  { id: 'lib2-flag', pack: P.platformer, file: 'flag.glb', subjects: ['flag'], category: 'collectible', height: 1.6 },
  { id: 'lib2-flying-enemy', pack: P.fps, file: 'enemy-flying.glb', subjects: ['flying enemy'], category: 'character', height: 1 },
  // Furniture
  { id: 'lib2-bed', pack: P.furniture, file: 'bed_double_A.gltf', subjects: ['bed'], category: 'interior', height: 0.9 },
  { id: 'lib2-sofa', pack: P.furniture, file: 'couch.gltf', subjects: ['sofa'], category: 'interior', height: 0.9 },
  { id: 'lib2-armchair', pack: P.furniture, file: 'armchair.gltf', subjects: ['armchair'], category: 'interior', height: 0.9 },
  { id: 'lib2-chair', pack: P.furniture, file: 'chair_A.gltf', subjects: ['chair'], category: 'interior', height: 0.9 },
  { id: 'lib2-stool', pack: P.furniture, file: 'chair_stool.gltf', subjects: ['stool'], category: 'interior', height: 0.6 },
  { id: 'lib2-table', pack: P.furniture, file: 'table_medium.gltf', subjects: ['table'], category: 'interior', height: 0.75 },
  { id: 'lib2-lamp', pack: P.furniture, file: 'lamp_standing.gltf', subjects: ['lamp'], category: 'interior', height: 1.6 },
  { id: 'lib2-cabinet', pack: P.furniture, file: 'cabinet_medium.gltf', subjects: ['cabinet'], category: 'interior', height: 1 },
  { id: 'lib2-shelf', pack: P.furniture, file: 'shelf_A_big.gltf', subjects: ['shelf'], category: 'interior', height: 1.9 },
  { id: 'lib2-cactus', pack: P.furniture, file: 'cactus_medium_A.gltf', subjects: ['cactus'], category: 'vegetation', height: 1.5 },
  // Buildings (medieval village)
  { id: 'lib2-castle', pack: P.medieval, file: 'buildings/blue/building_castle_blue.gltf', subjects: ['castle'], category: 'building', height: 14 },
  { id: 'lib2-market', pack: P.medieval, file: 'buildings/red/building_market_red.gltf', subjects: ['market'], category: 'building', height: 5 },
  { id: 'lib2-tavern', pack: P.medieval, file: 'buildings/yellow/building_tavern_yellow.gltf', subjects: ['tavern'], category: 'building', height: 7 },
  { id: 'lib2-church', pack: P.medieval, file: 'buildings/green/building_church_green.gltf', subjects: ['church'], category: 'building', height: 11 },
  { id: 'lib2-watermill', pack: P.medieval, file: 'buildings/blue/building_watermill_blue.gltf', subjects: ['watermill'], category: 'building', height: 7 },
  { id: 'lib2-tower', pack: P.medieval, file: 'buildings/red/building_tower_A_red.gltf', subjects: ['tower'], category: 'building', height: 10 },
  { id: 'lib2-barracks', pack: P.medieval, file: 'buildings/green/building_barracks_green.gltf', subjects: ['barracks'], category: 'building', height: 6 },
  { id: 'lib2-bridge', pack: P.medieval, file: 'buildings/neutral/building_bridge_A.gltf', subjects: ['bridge'], category: 'building', height: 3 },
  // Nature and fences
  { id: 'lib2-mountain-b', pack: P.medieval, file: 'decoration/nature/mountain_B_grass_trees.gltf', subjects: ['mountain'], category: 'terrain', height: 30 },
  { id: 'lib2-hill-single', pack: P.medieval, file: 'decoration/nature/hill_single_A.gltf', subjects: ['hill'], category: 'terrain', height: 6 },
  { id: 'lib2-forest-grove', pack: P.medieval, file: 'decoration/nature/trees_A_large.gltf', subjects: ['forest grove'], category: 'vegetation', height: 8 },
  { id: 'lib2-fence', pack: P.medieval, file: 'buildings/neutral/fence_wood_straight.gltf', subjects: ['fence'], category: 'street-prop', height: 1.2 },
  { id: 'lib2-bench', pack: P.city, file: 'bench.gltf', subjects: ['bench'], category: 'street-prop', height: 0.9 },
  { id: 'lib2-dustbin', pack: P.city, file: 'trash_A.gltf', subjects: ['dustbin'], category: 'street-prop', height: 1 },
];
