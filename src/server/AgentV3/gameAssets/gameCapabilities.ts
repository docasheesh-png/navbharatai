/**
 * THE UNIVERSAL INTENT PICKER FOR GAMES (admin 2026-11-21: "words par nahi intention par build hona chahiye … agar user kahe
 * 'mujhe in characters ko khud change karne ka option do' ya 'character ko edit ka option do' to kya hoga? … ek universal
 * intent picker banao, jo user ki sabhi language me user ki intension ko samjhe aur user ko real me jo chahiye woh banaye").
 *
 * WHY NOT A SEPARATE INTENT-CLASSIFIER CALL. The builder IS a language model: it already understands Hindi, Hinglish, Tamil
 * and the rest. What it lacked was the map — capabilities were described by the WORDS that trigger them ("character
 * customize karne ki screen"), the recipe list showed one 110-character line each, and two capabilities that sound alike
 * (the builder changing a character now vs. giving players a control to change it themselves) were not told apart. A
 * second model call per turn would add seconds and cost to do the same reading again. So the picker is this: every
 * capability described by the OUTCOME the user wants, the near-twins contrasted, and one rule for the rest — build what
 * they mean; never refuse, never fake; ask one short question only when two outcomes would differ for real.
 * Sent with the library menu on every 3D game turn (new game and every later change). PURE.
 */
export interface GameCapability {
  id: string;
  /** What the user WANTS to happen, in plain words — never a list of trigger phrases. */
  outcome: string;
  /** The exact way to deliver it. */
  use: string;
  /** Example phrasings across languages, to show the range of words one meaning takes — illustrations, not triggers. */
  saidAs: readonly string[];
}

export const GAME_CAPABILITIES: readonly GameCapability[] = Object.freeze([
  {
    id: 'player-customizer',
    outcome: 'the people PLAYING the game (often the user themself) get a control INSIDE the game to change how characters look — colours, parts, size, pose — and keep their choice',
    use: "run_recipe { name: 'generate_character_customizer' }, then wire its button and labels in the user's language",
    saidAs: ['let me change the characters myself', 'character ko edit ka option do', 'mujhe in characters ko khud change karne ka option do', 'avatar banane wali screen', 'players should pick their outfit', 'கதாபாத்திரத்தை நானே மாற்ற ஒரு வசதி'],
  },
  {
    id: 'builder-changes-a-model',
    outcome: 'the user wants a character or object changed NOW, the way they describe it — a colour, size, turn, a part hidden, another animation, a swap',
    use: "edit ONLY src/game/three/assetCustomizations.ts for a library or own model; author_object { customise, target } for a Forge object",
    saidAs: ['make the hero blue', 'character ka rang neela karo', 'ghoda thoda bada karo', 'hide the helmet'],
  },
  {
    id: 'library-models',
    outcome: 'a ready 3D person, animal, vehicle, building, weapon or prop — anything that should look real rather than blocky',
    use: 'add_library_models { models } with subjects from [GAME_LIBRARY_MENU]',
    saidAs: ['add a cow', 'gaon mein ghar aur kuan', 'a city with cars', 'शिकारी और धनुष'],
  },
  {
    id: 'surface-textures',
    outcome: 'ground, walls, roofs or floors that look like grass, brick, tile or wood instead of a flat colour',
    use: 'add_library_models { textures: [{ surface, variant }] }',
    saidAs: ['make the ground grass', 'deewar eent ki ho', 'wooden floor'],
  },
  {
    id: 'missing-object',
    outcome: 'something neither the library nor the kit has (a particular creature, vehicle or look)',
    use: 'author_object to make it now, AND tell the user where to get a real model free and how to attach it (the guide in this menu)',
    saidAs: ['add a dragon', 'ek tuk-tuk chahiye', 'my school bus with our logo'],
  },
  {
    id: 'own-models',
    outcome: "the user's OWN 3D files (a model they made or downloaded) placed and used in their game",
    use: 'they attach .glb / .gltf / .obj / .fbx or a zip in NavBharatAI Pro; it arrives as [USER MODELS ADDED] — wire each as that note says',
    saidAs: ['use my model', 'mera character daalo', 'I downloaded a car, put it in'],
  },
]);

/** The picker as the builder reads it. PURE. */
export function gameCapabilityMenu(capabilities: readonly GameCapability[] = GAME_CAPABILITIES): string {
  return '[WHAT THE USER MEANS → WHAT TO DO]\n'
    + 'Read the user\'s MEANING, in whatever language and words they use — the examples only show how differently one meaning is said; they are '
    + 'not triggers. Map it to the outcome below that it means and deliver that. Two outcomes that sound alike differ by WHO changes the thing and WHEN: '
    + 'the user asking for a change now (builder-changes-a-model) is not the user asking for a control the players use (player-customizer). '
    + 'If the request matches none of these, build what they mean anyway with the recipes and code — never refuse it, never fake it. Ask ONE short '
    + 'question only when two outcomes would give the user really different things and the words cannot decide.\n'
    + capabilities.map(c => `- ${c.id}: ${c.outcome} → ${c.use}. Said as: ${c.saidAs.map(s => `"${s}"`).join(', ')}`).join('\n');
}
