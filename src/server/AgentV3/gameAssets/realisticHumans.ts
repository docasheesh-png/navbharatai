import type { ReviewedAsset } from './providers';

// Only CC0 output assets from this pinned revision are used: body, clips, garments and hair.
const revision = '852e48f316b90a0937234886630e4fb4cdfd1f78';
const source = 'https://github.com/kblood/CharacterCreator/tree/' + revision + '/output';
const evidence = 'https://github.com/kblood/CharacterCreator/blob/' + revision + '/LICENSE-NOTES.md';
const looks = [
  { name: 'architect', bytes: 4743152, sha256: '2c8652132d4629e2fe92fb0a5e03deed1c1e97f15c25c96bb02129895b1e187f' },
  { name: 'courier', bytes: 4548004, sha256: '56e14c69e48eb78153fc0f7a5aa3b1f5fd051c7cfac76805b01cde0fe2ab001d' },
  { name: 'explorer', bytes: 4545940, sha256: '8384a36dd1c3f7ecf145a2b416ccd4e2742c8f54beb8008cbaf8e5ab82a9c991' },
  { name: 'field medic', bytes: 4378852, sha256: '2506fd9a00df7f57a382761df450b9cebafa8eed2f73ce245b21e316ae6853ee' },
  { name: 'mechanic', bytes: 4327488, sha256: 'c437d98c505e6a057ada7531bf403b543894d30df104212df92816e3b9379ac1' },
  { name: 'ranger', bytes: 4432604, sha256: '7204b6552f4e39ca82cdfa69e68b407cdc2e69737aa71ac1e0a35a979230e9f0' },
  { name: 'trail guide', bytes: 4432616, sha256: 'aba69ec52e33e75b70cee4ff1e391e3ceab6bc0a068af24a25e03f44085f298c' },
];
const animations = ['fall', 'idle', 'idle_breathe', 'idle_fidget', 'idle_look', 'jump', 'land', 'run', 'strafe_left', 'strafe_right', 'walk', 'walk_back'];
export const REALISTIC_HUMANS: readonly ReviewedAsset[] = looks.map(({name, bytes, sha256}) => ({
  id: 'realistic-' + name.replaceAll(' ', '-'), revision, provider: 'github', packaged: true,
  subjects: ['realistic ' + name], libraryCategory: 'character', bytes, sha256, height: 1.75, yaw: 0,
  sourceUrl: source, downloadUrl: source, downloadOrigins: ['https://github.com'], animations,
  animationRoles: { idle: 'idle', walk: 'walk', run: 'run', jump: 'jump', land: 'land' },
  review: { reviewer: 'NavBharatAI asset admission', evidenceRevision: revision, freeDownload: true },
  license: { spdx: 'CC0-1.0', author: 'MakeHuman Community and Kasper Olesen', evidenceUrl: evidence, reviewedAt: '2026-11-25',
    attribution: 'CC0 body, idle and locomotion clips, morphs, garments and hair. Assembled outfits, fitted to shared skeleton, retained selected morphs and resized textures.',
    commercial: true, redistributeInGame: true, redistributeSource: true },
}));
