/** Library batch 3 (2026-11-19): food, kitchen, horror, sci-fi base and town pieces. Rebuild and re-admit after any change. */
import { P, type Row } from './packs.mts';

export const REVIEWED_AT = '2026-11-19';
export const ROWS: Row[] = [
  // Food (the food category had no models)
  { id: 'lib3-burger', pack: P.restaurant, file: 'food_burger.gltf', subjects: ['burger'], category: 'food', height: 0.15 },
  { id: 'lib3-dinner', pack: P.restaurant, file: 'food_dinner.gltf', subjects: ['meal'], category: 'food', height: 0.12 },
  { id: 'lib3-stew', pack: P.restaurant, file: 'food_stew.gltf', subjects: ['stew'], category: 'food', height: 0.15 },
  { id: 'lib3-tomato', pack: P.restaurant, file: 'food_ingredient_tomato.gltf', subjects: ['tomato'], category: 'food', height: 0.08 },
  { id: 'lib3-carrot', pack: P.restaurant, file: 'food_ingredient_carrot.gltf', subjects: ['carrot'], category: 'food', height: 0.2 },
  { id: 'lib3-potato', pack: P.restaurant, file: 'food_ingredient_potato.gltf', subjects: ['potato'], category: 'food', height: 0.08 },
  { id: 'lib3-onion', pack: P.restaurant, file: 'food_ingredient_onion.gltf', subjects: ['onion'], category: 'food', height: 0.08 },
  { id: 'lib3-cheese', pack: P.restaurant, file: 'food_ingredient_cheese.gltf', subjects: ['cheese'], category: 'food', height: 0.1 },
  { id: 'lib3-vegetable-crate', pack: P.restaurant, file: 'crate_tomatoes.gltf', subjects: ['vegetable crate'], category: 'container', height: 0.5 },
  // Kitchen
  { id: 'lib3-oven', pack: P.restaurant, file: 'oven.gltf', subjects: ['oven'], category: 'interior', height: 0.9 },
  { id: 'lib3-fridge', pack: P.restaurant, file: 'fridge_A.gltf', subjects: ['fridge'], category: 'interior', height: 1.8 },
  { id: 'lib3-stove', pack: P.restaurant, file: 'stove_multi.gltf', subjects: ['stove'], category: 'interior', height: 0.9 },
  { id: 'lib3-cooking-pot', pack: P.restaurant, file: 'pot_A.gltf', subjects: ['cooking pot'], category: 'interior', height: 0.25 },
  { id: 'lib3-frying-pan', pack: P.restaurant, file: 'pan_A.gltf', subjects: ['frying pan'], category: 'interior', height: 0.08 },
  { id: 'lib3-round-table', pack: P.restaurant, file: 'table_round_A.gltf', subjects: ['round table'], category: 'interior', height: 0.75 },
  { id: 'lib3-kitchen-counter', pack: P.restaurant, file: 'kitchencounter_straight_A.gltf', subjects: ['kitchen counter'], category: 'interior', height: 0.9 },
  // Horror / graveyard
  { id: 'lib3-pumpkin', pack: P.halloween, file: 'pumpkin_orange.gltf', subjects: ['pumpkin'], category: 'vegetation', height: 0.5 },
  { id: 'lib3-jack-o-lantern', pack: P.halloween, file: 'pumpkin_orange_jackolantern.gltf', subjects: ['jack o lantern'], category: 'vegetation', height: 0.5 },
  { id: 'lib3-gravestone', pack: P.halloween, file: 'gravestone.gltf', subjects: ['gravestone'], category: 'building', height: 1.2 },
  { id: 'lib3-grave', pack: P.halloween, file: 'grave_A.gltf', subjects: ['grave'], category: 'building', height: 1 },
  { id: 'lib3-coffin', pack: P.halloween, file: 'coffin.gltf', subjects: ['coffin'], category: 'container', height: 0.6 },
  { id: 'lib3-skull', pack: P.halloween, file: 'skull.gltf', subjects: ['skull'], category: 'collectible', height: 0.25 },
  { id: 'lib3-dead-tree', pack: P.halloween, file: 'tree_dead_large.gltf', subjects: ['dead tree'], category: 'vegetation', height: 6 },
  { id: 'lib3-pine-tree', pack: P.halloween, file: 'tree_pine_orange_large.gltf', subjects: ['autumn tree'], category: 'vegetation', height: 7 },
  { id: 'lib3-lantern', pack: P.halloween, file: 'lantern_standing.gltf', subjects: ['lantern'], category: 'street-prop', height: 1.6 },
  { id: 'lib3-crypt', pack: P.halloween, file: 'crypt.gltf', subjects: ['crypt'], category: 'building', height: 4 },
  { id: 'lib3-iron-fence', pack: P.halloween, file: 'fence.gltf', subjects: ['iron fence'], category: 'street-prop', height: 1.5 },
  { id: 'lib3-cemetery-gate', pack: P.halloween, file: 'arch_gate.gltf', subjects: ['cemetery gate'], category: 'building', height: 3.5 },
  // Sci-fi base
  { id: 'lib3-lander', pack: P.space, file: 'lander_A.gltf', subjects: ['lander'], category: 'vehicle-air', height: 4 },
  { id: 'lib3-space-rover', pack: P.space, file: 'spacetruck.gltf', subjects: ['space rover'], category: 'vehicle-land', height: 2 },
  { id: 'lib3-wind-turbine', pack: P.space, file: 'windturbine_tall.gltf', subjects: ['wind turbine'], category: 'building', height: 12 },
  { id: 'lib3-solar-panel', pack: P.space, file: 'solarpanel.gltf', subjects: ['solar panel'], category: 'street-prop', height: 1.5 },
  { id: 'lib3-space-base', pack: P.space, file: 'basemodule_A.gltf', subjects: ['space base'], category: 'building', height: 4 },
  { id: 'lib3-landing-pad', pack: P.space, file: 'landingpad_large.gltf', subjects: ['landing pad'], category: 'terrain', height: 0.4 },
  { id: 'lib3-cargo-container', pack: P.space, file: 'cargo_A.gltf', subjects: ['cargo container'], category: 'container', height: 1.5 },
  { id: 'lib3-drill-rig', pack: P.space, file: 'drill_structure.gltf', subjects: ['drill rig'], category: 'building', height: 6 },
  // Town (Kenney City Builder, MIT)
  { id: 'lib3-fountain', pack: P.kenneyCity, file: 'pavement-fountain.glb', subjects: ['fountain'], category: 'street-prop', height: 1.5 },
  { id: 'lib3-garage', pack: P.kenneyCity, file: 'building-garage.glb', subjects: ['garage'], category: 'building', height: 4 },
  { id: 'lib3-small-house-a', pack: P.kenneyCity, file: 'building-small-a.glb', subjects: ['house'], category: 'building', height: 6 },
  { id: 'lib3-small-house-b', pack: P.kenneyCity, file: 'building-small-b.glb', subjects: ['house'], category: 'building', height: 6 },
  // Medieval extras
  { id: 'lib3-blacksmith', pack: P.medieval, file: 'buildings/red/building_blacksmith_red.gltf', subjects: ['blacksmith'], category: 'building', height: 6 },
  { id: 'lib3-mine', pack: P.medieval, file: 'buildings/yellow/building_mine_yellow.gltf', subjects: ['mine entrance'], category: 'building', height: 5 },
  { id: 'lib3-archery-range', pack: P.medieval, file: 'buildings/blue/building_archeryrange_blue.gltf', subjects: ['archery range'], category: 'building', height: 5 },
  { id: 'lib3-lumbermill', pack: P.medieval, file: 'buildings/green/building_lumbermill_green.gltf', subjects: ['sawmill'], category: 'building', height: 6 },
  { id: 'lib3-pine-forest', pack: P.medieval, file: 'decoration/nature/trees_B_large.gltf', subjects: ['pine forest'], category: 'vegetation', height: 8 },
  { id: 'lib3-boulder', pack: P.medieval, file: 'decoration/nature/rock_single_E.gltf', subjects: ['boulder'], category: 'rock', height: 1.5 },
  { id: 'lib3-water-lily', pack: P.medieval, file: 'decoration/nature/waterlily_A.gltf', subjects: ['water lily'], category: 'vegetation', height: 0.1 },
  // Prototype pieces for obstacle courses
  { id: 'lib3-door', pack: P.proto, file: 'Door_A.gltf', subjects: ['door'], category: 'interior', height: 2.1 },
  { id: 'lib3-stairs', pack: P.proto, file: 'Primitive_Stairs.gltf', subjects: ['stairs'], category: 'building', height: 2 },
  { id: 'lib3-pallet', pack: P.proto, file: 'Pallet_Large.gltf', subjects: ['pallet'], category: 'container', height: 0.2 },
];
