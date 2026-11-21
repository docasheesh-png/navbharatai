/**
 * WHEN NEITHER THE LIBRARY NOR CODE CAN GIVE THE USER WHAT THEY ASKED FOR (admin 2026-11-20: "agar navbharatai ko lage
 * user kuch aisa mang raha hai, jo na library me hai, na navbharatai bana sakta hai, to navbharatai user ko bataye module
 * kaha se download honge, aur navbharatai me kaise upload honge … puri jaan laga ke help kare").
 *
 * Before this the builder had two answers: a library model, or a code-built stand-in. A user who asked for a specific
 * creature, a real vehicle or a character with a particular look got a stand-in and no way forward. This is the third
 * answer, said once, plainly: where free models are, how to pick the right file, and exactly how to bring it in — the
 * upload path (userModels.ts) then puts it into their game. PURE text; no network, no claim that a model exists there.
 */

/** Free model sources a user can use without paying. Names and home pages only; the user searches there themselves. */
export const FREE_MODEL_SOURCES: readonly { name: string; url: string; good: string; licence: string }[] = Object.freeze([
  { name: 'Quaternius', url: 'https://quaternius.com', good: 'low-poly characters, animals, vehicles, weapons, buildings, many animated', licence: 'CC0 — free, no credit needed' },
  { name: 'Kenney', url: 'https://kenney.nl/assets', good: 'game kits: cars, city, nature, space, furniture, props', licence: 'CC0 — free, no credit needed' },
  { name: 'KayKit', url: 'https://kaylousberg.itch.io', good: 'cartoon characters with animations, dungeons, fantasy props', licence: 'free packs are CC0' },
  { name: 'Poly Pizza', url: 'https://poly.pizza', good: 'thousands of small models, one search box for everything', licence: 'each model says CC0 or CC-BY' },
  { name: 'Poly Haven', url: 'https://polyhaven.com/models', good: 'realistic objects, plants and rocks', licence: 'CC0 — free, no credit needed' },
  { name: 'Sketchfab', url: 'https://sketchfab.com', good: 'the largest choice; tick "Downloadable" and pick a free licence', licence: 'check each model: CC0, or CC-BY (then credit the author in the game)' },
]);

/**
 * What the builder tells the user, in their language, when the thing they asked for is not in the library and a code-built
 * version would not be what they meant. It names the object back to them, so the advice is about THEIR request.
 */
export function ownModelGuide(asked: readonly string[]): string {
  const what = asked.filter(Boolean).slice(0, 6).map(a => JSON.stringify(a)).join(', ') || 'this object';
  return `[WHEN THE LIBRARY HAS NO ${what.toUpperCase()}] Do not stop at a stand-in the user did not ask for. Build the closest working version from code so `
    + `the game runs, AND tell the user plainly, in their language, how to get the real thing in a few minutes:\n`
    + `1. Where (free): ${FREE_MODEL_SOURCES.map(s => `${s.name} (${s.url}) — ${s.good}; ${s.licence}`).join(' · ')}.\n`
    + `2. Which file: search for ${what}; prefer .glb (one file). .gltf with its files, .obj with its .mtl, .fbx or one .zip of them also work. `
    + `Under 8 MB and 200,000 triangles; for an animated character, pick one whose page lists its animations (walk, run…).\n`
    + `3. How to bring it in: NavBharatAI Pro → paperclip → Choose file → the downloaded file (or the whole .zip) → send with where it goes, e.g. `
    + `"use this as the player". NavBharatAI checks it, puts it into the game, and it can then be recoloured, resized or animated in plain words.\n`
    + `4. Licence: CC0 needs nothing; CC-BY needs the author's name in the game's credits — offer to add it. Never suggest paid, ripped or "free download" copies of models from commercial games or films.`;
}
