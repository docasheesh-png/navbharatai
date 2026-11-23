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
  { name: 'Kenney', url: 'https://kenney.nl/assets', good: 'game kits: cars, city, nature, space, furniture, props, sounds and UI', licence: 'CC0 only' },
  { name: 'Quaternius', url: 'https://quaternius.com', good: 'low-poly characters, animals, vehicles and buildings, many animated', licence: 'CC0 only' },
  { name: 'Poly Pizza', url: 'https://poly.pizza', good: 'thousands of small models; download only the ones marked CC0', licence: 'CC0 only' },
  { name: 'KayKit', url: 'https://kaylousberg.itch.io', good: 'cartoon characters with animations, dungeons and fantasy props', licence: 'CC0 only — use the packs marked CC0' },
  { name: 'OpenGameArt', url: 'https://opengameart.org', good: 'models, textures and sounds; filter the search to CC0', licence: 'CC0 only' },
  { name: 'Poly Haven', url: 'https://polyhaven.com/models', good: 'realistic objects, plants, rocks and textures', licence: 'CC0 only' },
]);

/**
 * What the builder tells the user, in their language, when the thing they asked for is not in the library and a code-built
 * version would not be what they meant. It names the object back to them, so the advice is about THEIR request.
 */
export function ownModelGuide(asked: readonly string[]): string {
  const what = asked.filter(Boolean).slice(0, 6).map(a => JSON.stringify(a)).join(', ') || 'this object';
  return `[WHEN THE LIBRARY HAS NO ${what.toUpperCase()}] The library was checked first and does not have this. Build the closest working version from code so `
    + `the game runs — that stand-in must sit on the ground with standOnGround, the same rule as every other object — AND tell the user plainly, in their language, how to get the real thing in a few minutes:\n`
    + `1. Where (free, CC0 only): ${FREE_MODEL_SOURCES.map(s => `${s.name} (${s.url}) — ${s.good}`).join(' · ')}.\n`
    + `2. Which file: search for ${what}. A model: prefer .glb (one file); .gltf with its files, or one .zip of them, also work. A texture: .png. A sound: .ogg or .mp3. `
    + `Under 8 MB for a model and 4 MB for a picture or a sound. For an animated character, pick one whose page lists its animations (walk, run…).\n`
    + `3. How to bring it in: NavBharatAI Pro → paperclip → Choose file → the downloaded file (or the whole .zip) → send with where it goes, e.g. `
    + `"use this as the player". NavBharatAI checks the type and the size, puts a model in the game, a .png with the textures and an .ogg or .mp3 with the sounds.\n`
    + `4. Licence: CC0 only. Do not suggest a file that requires credit, a paid pack, or a ripped model from a commercial game or film.`;
}
