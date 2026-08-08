// NavBharatAI — song-writing craft (admin 2026-08-08).
//
// THE ASK: "agar koi user gaana likhwaye to user ke man ke mutabik realistic gane likhe — emotions,
// joy, aur rhythm itni acchi ho ki log madhosh ho jaye."
//
// WHY A CRAFT SPEC AND NOT "write a beautiful song": a general model asked for Hindi lyrics reaches
// for the same handful of rhymes every time (pyaar/bahaar, dil/manzil, chaand/raat, aankhein/sapne)
// and states feelings instead of showing them ("mera dil toot gaya"). The result rhymes, scans badly,
// and moves nobody — it reads like a greeting card. What separates lyrics people actually feel is
// craft that can be stated precisely: ONE concrete image per line, a repeatable syllable count so it
// is singable, a real mukhda/antara shape, and the discipline of showing a situation rather than
// naming an emotion. That is what this directive encodes.
//
// COST DISCIPLINE: this block is injected ONLY when the user is actually asking for a song
// (`isSongRequest`), so every other conversation costs exactly what it costs today.
//
// PURE — no I/O, fully unit-tested.

/**
 * Words that signal "write me a song/lyrics" across the languages NavBharatAI's users actually type
 * in: English, Hindi (Devanagari + romanized), Urdu-ish, and the common regional words. Kept as whole
 * tokens so "songwriter" or a passing mention of "singer" does not trigger the block.
 */
const SONG_WORDS = [
  // English
  'song', 'songs', 'lyric', 'lyrics', 'verse', 'chorus', 'anthem', 'ballad', 'rap', 'jingle',
  // Hindi / Urdu — Devanagari
  'गाना', 'गाने', 'गीत', 'गीतों', 'बोल', 'कविता', 'शायरी', 'ग़ज़ल', 'गजल', 'भजन', 'लोरी', 'मुखड़ा', 'अंतरा',
  // Romanized Hindi / Urdu
  'gaana', 'gana', 'gaane', 'geet', 'git', 'nazm', 'ghazal', 'gazal', 'shayari', 'sher',
  'bhajan', 'lori', 'lullaby', 'qawwali', 'kawwali', 'mukhda', 'antara', 'antra',
  // Regional
  'paatu', 'padal', 'haadu', 'gaan', 'gaanam', 'geetham', 'kavita',
];

/** A verb that means "make/write one" — guards against merely TALKING about songs. */
const WRITE_WORDS = [
  'write', 'compose', 'create', 'make', 'give', 'need', 'want', 'suggest', 'generate',
  'likh', 'likho', 'likhna', 'likhkar', 'likhwa', 'bana', 'banao', 'banaa', 'sunao', 'chahiye', 'chahiye',
  'लिख', 'लिखो', 'लिखना', 'बना', 'बनाओ', 'चाहिए', 'सुनाओ', 'सुना',
];

/**
 * Normalize for matching: lowercase, punctuation → spaces.
 *
 * `\p{M}` (combining marks) is ESSENTIAL, not decoration: Devanagari vowel signs — the matras in
 * गाना, लिखो, लोरी — are category Mn, NOT letters. A `[^\p{L}\p{N}]` class silently shreds every
 * Hindi word into consonant fragments ("गाना" → "ग न"), so Devanagari requests would never match.
 * Any tokenizer in this India-first app must keep marks with their letters.
 */
function tokens(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Is the user asking us to WRITE a song? Requires a song word AND a writing verb (or a bare song word
 * in a short message like "gaana likh do" / "ek geet"), so "I listened to a song yesterday" does not
 * trigger it. PURE.
 */
export function isSongRequest(text: string): boolean {
  const t = tokens(text);
  if (t.length === 0) return false;
  const set = new Set(t);
  const hasSongWord = SONG_WORDS.some((w) => set.has(w));
  if (!hasSongWord) return false;
  const hasWriteVerb = WRITE_WORDS.some((w) => set.has(w));
  // A short message centred on a song word ("ek gaana", "lyrics please") is a request; a long
  // paragraph that merely mentions a song is not, unless it also carries a writing verb.
  return hasWriteVerb || t.length <= 8;
}

/**
 * The craft directive. Written as CONCRETE, checkable rules — a model can obey "one physical image
 * per line" and "keep the syllable count of a line steady within a stanza"; it cannot obey "be
 * moving". Deliberately does NOT ask the user clarifying questions: the platform's standing rule is a
 * real answer over an interrogation, so the model infers the occasion and fills gaps itself.
 */
export const SONGCRAFT_DIRECTIVE = `SONGWRITING (the user asked for a song — this is a craft brief, follow it):

WRITE THE SONG. Do not ask clarifying questions first, do not explain your process, do not lecture
about songwriting. If a detail is missing (occasion, name, the person), CHOOSE something warm and
believable and write. Offer at the very end, in one short line, to change anything.

MATCH THE USER'S MIND:
• Language + script exactly as they used (Hindi in Devanagari, Hinglish in Latin, English in English,
  a regional language in its own script). Never translate their request into a language they did not use.
• Match the KIND they asked for: filmy romantic, sad/breakup, dosti, maa/papa, bhajan/devotional,
  desh-bhakti, lori, rap, wedding/haldi, birthday, item/dance, sufi, kids' rhyme.
• Match the mood word they used. "Khushi wala" must sound bright and fast; "dard bhara" must sound slow.

STRUCTURE (a real singable shape, labelled):
• Mukhda (hook, 2–4 lines) → Antara 1 (4–6 lines) → Mukhda → Antara 2 (4–6 lines) → Mukhda.
• The mukhda is the line people remember — make it the simplest, most repeatable line in the song.
• Label each part on its own line: [Mukhda] / [Antara 1] / [Antara 2].

RHYTHM (this is what makes it feel like a song and not a paragraph):
• Keep the syllable count of the lines within a stanza close to each other (±2), so it can be sung to
  a steady beat. Read each line in your head as a beat before you keep it.
• Rhyme the line ENDINGS in a consistent pattern (AABB or ABAB) — and hold the same pattern in both antaras.
• Prefer short, singable words over long literary ones. If a line cannot be sung out loud in one
  breath, it is too long.

EMOTION (show, never announce):
• ONE concrete physical image per line — a thing you could photograph. "Teri chai ka aadha bhara cup"
  moves people; "mera dil toot gaya" does not. Objects, places, weather, food, time of day, small
  gestures, sounds.
• Reach the feeling THROUGH the image. Never write the name of the emotion (khushi, gham, pyaar,
  dard) where an image would do the work.
• Ground it in real Indian life — the details a person recognises: barish, chhat, station, tiffin,
  scooter, mandir ki ghanti, maa ki awaaz, gali ka mod, Diwali ki roshni.
• Joy songs need MOVEMENT (dancing, running, festival, drums); sad songs need STILLNESS (an empty
  chair, a phone that does not ring, cold tea).

FORBIDDEN (these are what make lyrics sound machine-written):
• The worn-out rhyme pairs: pyaar/bahaar, dil/manzil, chaand/raat, aansu/aansu, sapne/apne,
  zindagi/bandagi. If a rhyme feels automatic, find a fresher one.
• Generic filler lines that could belong to any song ("tum ho mere paas", "dil kehta hai").
• English words dropped into a pure-Hindi song unless the user's own style used them.
• Explaining the song after writing it, or adding a meaning/analysis section unless asked.

FINISH: after the song, ONE short line offering to change the mood, length or language. Nothing more.`;

/**
 * The block to append to a chat system prompt for THIS message — '' when no song was asked for, so a
 * normal conversation's prompt stays byte-identical (and costs the same). PURE.
 */
export function songcraftFor(message: string): string {
  return isSongRequest(message) ? `\n\n${SONGCRAFT_DIRECTIVE}` : '';
}
