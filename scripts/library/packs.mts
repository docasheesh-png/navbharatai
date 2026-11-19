import type { ObjectCategory } from '../../src/server/lib/objectCatalogTypes';

export interface Pack { owner: string; repo: string; revision: string; provider: 'kaykit' | 'kenney'; spdx: 'CC0-1.0' | 'MIT'; author: string; attribution: string; licenseFile: string; root: string }
export const KAYKIT = (repo: string, revision: string, root: string): Pack => ({ owner: 'KayKit-Game-Assets', repo, revision, provider: 'kaykit', spdx: 'CC0-1.0', author: 'Kay Lousberg', attribution: 'KayKit by Kay Lousberg. CC0 1.0 Universal.', licenseFile: 'LICENSE.txt', root });
export const KENNEY = (repo: string, revision: string, year: number, licenseFile: string): Pack => ({ owner: 'KenneyNL', repo, revision, provider: 'kenney', spdx: 'MIT', author: 'Kenney', attribution: `Copyright (c) ${year} Kenney`, licenseFile, root: 'models' });
export const P = {
  city: KAYKIT('KayKit-City-Builder-Bits-1.0', '63976910ca04d16f0fc531b9c614244be8128713', 'addons/kaykit_city_builder_bits/Assets/gltf'),
  medieval: KAYKIT('KayKit-Medieval-Hexagon-Pack-1.0', '84fa4e91af6a88989be7c99e0891cede11f2ca38', 'addons/kaykit_medieval_hexagon_pack/Assets/gltf'),
  furniture: KAYKIT('KayKit-Furniture-Bits-1.0', '96d5930a8dbdb363409bbc2d3341718b00e17c9c', 'addons/kaykit_furniture_bits/Assets/gltf'),
  proto: KAYKIT('KayKit-Prototype-Bits-1.0', 'bb159596f4f5106b663741d002c8eb45c80c0f41', 'addons/kaykit_prototype_bits/Assets/gltf'),
  skeletons: KAYKIT('KayKit-Character-Pack-Skeletons-1.0', '15b62b9bad122f72926c10fb14d622c73819fa54', 'addons/kaykit_character_pack_skeletons'),
  restaurant: KAYKIT('KayKit-Restaurant-Bits-1.0', '153c8a7535b48237854cb54ff6890679f8c574d1', 'addons/kaykit_restaurant_bits/Assets/gltf'),
  halloween: KAYKIT('KayKit-Halloween-Bits-1.0', '6dc69bf6b2fa766a985754f35ec6a0324090e6c6', 'addons/kaykit_halloween_bits/Assets/gltf'),
  space: KAYKIT('KayKit-Space-Base-Bits-1.0', '6dfbcac9927d06283752c4defd4882cfe0d29666', 'addons/kaykit_space_base_bits/Assets/gltf'),
  kenneyCity: KENNEY('Starter-Kit-City-Builder', '4535092b740b378b700efd9df9e27a631815b84a', 2025, 'LICENSE.md'),
  racing: KENNEY('Starter-Kit-Racing', '2f2e5f2646dda89cb21d4e8539bab60c6e955dc8', 2023, 'LICENSE'),
  platformer: KENNEY('Starter-Kit-3D-Platformer', '3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0', 2023, 'LICENSE.md'),
  fps: KENNEY('Starter-Kit-FPS', '185fd2326d74a5cf858cffc616f87cf9696f9cc0', 2025, 'LICENSE.md'),
};
/** height = target bounding-box height in metres at runtime; tiles keep their thin native height. */
export interface Row { id: string; pack: Pack; file: string; subjects: string[]; category: ObjectCategory; height: number; clips?: { walk: string; run: string; idle: string } }
