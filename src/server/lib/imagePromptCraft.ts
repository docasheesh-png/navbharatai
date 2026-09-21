/**
 * WHAT A GOOD IMAGE PROMPT LOOKS LIKE — the difference between a usable image and a wasted one.
 *
 * ADMIN REQUEST 2026-08-14: make AI Image Gen dramatically better.
 *
 * The honest diagnosis first: the model was never the ceiling. The prompt was. Everything a user
 * typed went to the image model almost unchanged —
 *
 *     "App Icon — coffee shop"  +  "Style: minimalist, clean."  +  "Aspect ratio 1:1."
 *
 * — which is roughly what a person types into a free image site. The model then guesses at
 * composition, framing, margins and background, and guesses differently every time. That is why AI
 * images look amateur: not weak models, but prompts with no art direction in them.
 *
 * 🔑 THE INSIGHT THIS MODULE IS BUILT ON: the user already told us the one thing that matters most —
 * WHAT THE IMAGE IS FOR. An app icon, a website banner and an avatar are three completely different
 * professional briefs, and each has rules a designer would apply without being asked:
 *   • an icon must read at 48×48, so it needs ONE bold shape, a safe margin, and no fine detail;
 *   • a banner needs the subject off-centre with real empty space, or the headline lands on a face;
 *   • an avatar must survive a CIRCULAR crop, which is a framing decision made before the shot.
 * None of that was being said to the model. Now it is, per purpose, on every single image — and it
 * costs nothing: same model, same call, same price.
 *
 * 🔒 THE USER'S OWN WORDS ALWAYS WIN. This adds direction; it never overrides intent. If somebody
 * writes "dark moody logo" and the Minimal chip is selected, we do not stack "clean white background"
 * on top of "dark" and hand the model a contradiction — the chip yields. Nor is a word repeated that
 * the user already wrote. An enhancer that argues with the request produces worse images than no
 * enhancer at all.
 *
 * ⚠️ AND IT IS HONEST ABOUT TEXT. Image models cannot spell. A user asking for a logo "with the name
 * SHARMA CAFE" will get plausible-looking gibberish, every time, on every model. Rather than quietly
 * shipping that, the text is kept as short as possible AND the user is told — because a warning they
 * can act on beats a beautiful image with a misspelled shop name on it.
 */

export type ImagePurpose =
  | 'icon' | 'logo' | 'banner' | 'avatar' | 'background'
  | 'illustration' | 'screenshot' | 'thumbnail' | 'general';

export interface CraftInput {
  /** What the user typed (may already contain the type label — see detectPurpose). */
  prompt: string;
  /** The style chip id: minimal | vibrant | dark | gradient | flat | 3d. */
  style?: string;
  /** The size id: square | wide | portrait | icon. */
  size?: string;
  /** The selected image type label, when the client sends it as a real field. */
  type?: string;
}

export interface CraftedPrompt {
  /** The full prompt to send to the image model. */
  prompt: string;
  /** What the model must avoid. Providers that support it get this separately. */
  negative: string;
  /** Honest, user-facing notes — shown, never hidden. */
  notes: string[];
  purpose: ImagePurpose;
}

/** Longest prompt any provider here accepts. */
const MAX_PROMPT_CHARS = 2_000;

/**
 * Art direction per purpose — the part a designer would apply without being asked.
 *
 * Each line is a real constraint with a reason, not decoration: `safe margin` because icons get
 * rounded-cornered by the OS, `off-centre` because a headline goes in the gap, `circular crop`
 * because that is how every avatar is displayed.
 */
const PURPOSE_DIRECTION: Record<Exclude<ImagePurpose, 'general'>, string> = {
  icon:
    'Design as an APP ICON: one single bold centred subject, thick simple silhouette, generous safe '
    + 'margin so nothing is clipped when the corners are rounded, flat solid or simple background, '
    + 'instantly recognisable when shrunk to 48×48 pixels, no fine detail, no scene, no text',
  logo:
    'Design as a LOGO MARK: flat vector style, clean geometry, high contrast, balanced negative space, '
    + 'still readable when printed in a single colour and when very small, centred on a plain background, '
    + 'no photorealism, no heavy shadows, no busy detail',
  banner:
    'Design as a WIDE WEBSITE BANNER: cinematic wide composition, the main subject placed off-centre to '
    + 'one side, a generous uncluttered area of low detail left empty for a headline to be placed later, '
    + 'clear depth between foreground and background, no text of any kind rendered in the image',
  avatar:
    'Design as an AVATAR: head-and-shoulders framing, subject centred and facing forward, soft simple '
    + 'uncluttered background, even flattering light, composed so nothing important is lost when cropped '
    + 'into a CIRCLE',
  background:
    'Design as a BACKGROUND: no dominant focal subject, even low-contrast tones, subtle texture or pattern, '
    + 'detail spread evenly so text placed on top stays readable everywhere, edges that continue naturally, '
    + 'nothing that competes for attention',
  illustration:
    'Design as an ILLUSTRATION: one clear focal subject, cohesive limited palette, consistent line weight '
    + 'and shading, deliberate composition with breathing room, polished finished artwork',
  screenshot:
    'Design as a clean UI MOCKUP: realistic interface layout on an aligned grid, consistent spacing and '
    + 'padding, clear visual hierarchy, believable components and proportions, crisp edges',
  thumbnail:
    'Design as a THUMBNAIL: one bold subject filling the frame, strong colour contrast, high clarity, '
    + 'composed to still read clearly at a small size in a crowded list',
};

/** What ruins each kind of image — added to the universal negatives below. */
const PURPOSE_NEGATIVE: Record<Exclude<ImagePurpose, 'general'>, string> = {
  icon: 'photographic background, complex scene, small details, thin lines, text, multiple subjects',
  logo: 'photorealistic, 3D render, gradients that muddy at small size, drop shadow, clutter, mockup frame',
  banner: 'text, headline, letters, centred subject blocking the copy space, tight crop',
  avatar: 'full body, busy background, harsh shadows, subject off to the edge, cropped forehead',
  background: 'central subject, high contrast focal point, text, harsh detail, vignette',
  illustration: 'inconsistent style, muddy colours, unfinished sketch lines',
  screenshot: 'lorem ipsum gibberish, misaligned elements, unrealistic proportions, blurry text',
  thumbnail: 'tiny details, low contrast, empty margins, cluttered composition',
};

/**
 * The universal tells of an AI image.
 *
 * Every one of these is a thing a viewer notices immediately and reads as "made by a machine" —
 * which is exactly the gap this whole module exists to close.
 */
const BASE_NEGATIVE =
  'garbled text, misspelled words, random letters, gibberish writing, watermark, signature, stock-photo '
  + 'logo, extra fingers, deformed hands, extra limbs, disfigured face, blurry, out of focus, low resolution, '
  + 'jpeg artifacts, oversaturated, harsh flash, cluttered composition, awkward crop, visible border frame';

/** Style chip → the words it contributes, and the words it CONFLICTS with. */
const STYLE_DIRECTION: Record<string, { add: string; conflicts: string[] }> = {
  minimal: { add: 'minimalist, clean, generous white space, simple shapes, restrained palette', conflicts: ['dark', 'moody', 'neon', 'busy', 'detailed', 'ornate', 'vibrant', 'colorful', 'colourful'] },
  vibrant: { add: 'vivid saturated colours, high contrast, energetic, bold', conflicts: ['minimal', 'muted', 'pastel', 'monochrome', 'subtle', 'dark'] },
  dark: { add: 'dark background, moody low-key lighting, rich shadows, restrained neon accents', conflicts: ['bright', 'white background', 'light', 'airy', 'pastel', 'minimal'] },
  gradient: { add: 'smooth colour gradient, soft blended tones, modern', conflicts: ['flat', 'single colour', 'monochrome'] },
  flat: { add: 'flat 2D vector style, solid fills, no shadows, clean edges', conflicts: ['3d', 'realistic', 'photorealistic', 'depth', 'shadow', 'gradient'] },
  '3d': { add: '3D render, soft studio lighting, subtle depth of field, physically believable materials', conflicts: ['flat', '2d', 'vector', 'line art'] },
  /**
   * PHOTO — the style that did not exist, and whose absence WAS the complaint (admin 2026-08-16:
   * "is type ki photo generate kar raha hai … realistic image banane ke liye jo kuch ho sake karo",
   * with a soft isometric 3D blob attached).
   *
   * 🔒 THE ROOT CAUSE WAS NOT THE PROMPT WORDING, IT WAS THAT REALISM WAS UNREACHABLE. The six style
   * chips were minimal / vibrant / dark / gradient / flat / 3d — not one of them asks for a
   * PHOTOGRAPH. The image the admin sent is exactly what `3d` is specified to produce ("3D render,
   * isometric, depth, shadows"), so the engine did as it was told; the user simply had no way to ask
   * for anything else.
   *
   * The direction is CAMERA language rather than adjectives, because that is what actually moves a
   * diffusion model toward realism: a focal length implies a perspective, an aperture implies depth of
   * field, and a light source implies shadow behaviour. "realistic, high quality, 4k" — the words most
   * people reach for — are nearly inert by comparison, and "4k" in particular is a resolution claim
   * the prompt cannot deliver.
   */
  photo: {
    add: 'photograph, shot on a full-frame camera with a 50mm lens at f/2, natural light, shallow depth of field, sharp focus on the subject, true-to-life colour, fine surface detail and texture',
    conflicts: ['flat', 'vector', 'cartoon', 'illustration', 'drawing', 'anime', 'painting', 'render', 'isometric', 'minimal'],
  },
  /**
   * CINEMATIC — the second thing that did not exist, and whose absence was the second half of the
   * admin's 2026-09-21 report ("kya yeh aur behatar realistic, CINEMATIC nahi ban sakti?").
   *
   * 🔑 IT IS NOT "PHOTO, BUT MORE". A photograph and a film still are different crafts, and the
   * difference is the LIGHT, not the adjective: `photo` above is documentary — 50mm, natural light,
   * true-to-life colour, the look of a good camera pointed at a real thing. A film still is
   * deliberately lit and deliberately graded: a wide anamorphic lens, a strong key against a dark
   * fill, atmosphere in the air, a colour grade, and grain. Merging the two would give a muddle
   * that is neither, which is exactly what `styleConflictsWithPrompt` exists to prevent elsewhere.
   *
   * Same discipline as `photo`: camera and lighting language, never the inert words ("epic", "4k",
   * "masterpiece") that people reach for and that move a diffusion model almost not at all.
   */
  cinematic: {
    add: 'cinematic film still, anamorphic wide lens, shallow depth of field, dramatic directional key light with deep falloff, atmospheric haze and volumetric light, rich cinematic colour grading, fine film grain, high dynamic range, composed like a frame from a feature film',
    conflicts: ['flat', 'vector', 'cartoon', 'illustration', 'drawing', 'anime', 'painting', 'isometric', 'minimal', 'bright', 'white background'],
  },
};

/**
 * Negatives that only make sense for a PHOTO request — the styles a realism prompt keeps drifting into.
 * Kept separate from the per-purpose negatives because "no illustration" is nonsense on an icon brief
 * and actively harmful on a logo one.
 */
const PHOTO_NEGATIVE = 'illustration, cartoon, anime, 3d render, cgi, painting, drawing, sketch, plastic-looking, over-smoothed skin, waxy texture, over-smoothed, low detail';

/** What ruins a FILM STILL specifically — flat light is the tell that it was never lit at all. */
const CINEMATIC_NEGATIVE = 'flat even lighting, on-camera flash, amateur snapshot, webcam quality, washed-out colour, cluttered background';

/** The two chips that ask for a real camera rather than artwork. */
const REALISM_STYLES = new Set(['photo', 'cinematic']);

/**
 * The user asked for a real photograph IN THEIR OWN WORDS, regardless of which chip is set.
 *
 * ⚠️ DELIBERATELY NARROW. A bare "photo" is not enough — "logo for a photography studio" is a LOGO
 * brief that happens to mention photography, and treating it as a realism request would hand a
 * photographer a snapshot instead of a mark. So the phrases here are ones that describe the IMAGE
 * ("photo of", "realistic", "cinematic"), never ones that merely name a subject.
 *
 * PURE.
 */
export function realismInWords(prompt: string): boolean {
  const p = String(prompt ?? '').toLowerCase();
  return /\b(?:photo-?realistic|realistic|cinematic|lifelike|real life|real-life)\b/.test(p)
    || /\b(?:photo|photograph|picture|portrait|shot|still)\s+of\b/.test(p)
    || /\b(?:real|actual|asli)\s+(?:photo|photograph|picture|image)\b/.test(p)
    || /\bphoto\s*jaisi\b|\basli\s+jaisi\b/.test(p);
}

/**
 * Purposes whose art direction CONTRADICTS a photograph, word for word.
 *
 * 🔴 THIS IS THE DEFECT THE ADMIN REPORTED, AND IT IS OUR PROMPT'S FAULT RATHER THAN THE ENGINE'S.
 * `PURPOSE_DIRECTION.logo` says "flat vector style … **no photorealism**" and
 * `PURPOSE_NEGATIVE.logo` lists "photorealistic" among the things to avoid. The free picker's
 * image-type chip is COMPULSORY and defaults to "Modern app logo", so every untouched screen was
 * commanding a flat vector cartoon — and a user who then chose the Realistic style got BOTH
 * "photograph, 50mm lens" and "no photorealism" in one prompt, where the negative wins. Realism was
 * unreachable in practice, the same way it was unreachable before the `photo` chip existed at all.
 *
 * `banner`, `avatar`, `background` and `thumbnail` are NOT here: their direction is about framing
 * and composition, which a photograph obeys perfectly well.
 */
const PHOTO_HOSTILE_PURPOSES = new Set<ImagePurpose>(['icon', 'logo', 'screenshot', 'illustration']);

/** Size id → the ratio the model understands. */
const SIZE_RATIO: Record<string, string> = { square: '1:1', wide: '16:9', portrait: '3:4', icon: '1:1' };

/** Type label (or the user's own words) → purpose. Order matters: the most specific match wins. */
const PURPOSE_PATTERNS: Array<[RegExp, ImagePurpose]> = [
  [/\bapp icon\b|\bicon\b|\bfavicon\b/i, 'icon'],
  [/\blogo\b|\bwordmark\b|\bbrand mark\b/i, 'logo'],
  [/\bbanner\b|\bhero image\b|\bcover\b|\bheader image\b|\bog image\b/i, 'banner'],
  [/\bavatar\b|\bprofile (?:pic|picture|photo)\b|\bheadshot\b/i, 'avatar'],
  [/\bbackground\b|\bwallpaper\b|\bbackdrop\b/i, 'background'],
  [/\bui screenshot\b|\bscreenshot\b|\bmockup\b|\bui design\b/i, 'screenshot'],
  [/\bthumbnail\b|\bthumb\b/i, 'thumbnail'],
  [/\billustration\b|\bartwork\b|\bdrawing\b|\bscene\b/i, 'illustration'],
];

/**
 * Work out what the image is FOR.
 *
 * Reads the explicit type first, then falls back to the user's own words — because the client has
 * historically mashed the type into the prompt string ("App Icon — coffee shop") rather than sending
 * it as a field, and a user who simply types "logo for my cafe" deserves the same direction as one
 * who tapped the chip.
 */
export function detectPurpose(type: string | undefined, prompt: string): ImagePurpose {
  for (const [re, purpose] of PURPOSE_PATTERNS) if (re.test(String(type ?? ''))) return purpose;
  for (const [re, purpose] of PURPOSE_PATTERNS) if (re.test(String(prompt ?? ''))) return purpose;
  return 'general';
}

/** Normalised words of a prompt, for "did the user already say this?" checks. */
function words(s: string): Set<string> {
  return new Set(String(s ?? '').toLowerCase().match(/[a-z]+/g) ?? []);
}

/**
 * Does the user's own wording contradict the selected style chip?
 *
 * When it does, the chip is DROPPED rather than merged. Handing a model "dark background" and "clean
 * white background" in one breath produces a muddle that satisfies neither, and the user's typed
 * intent is the stronger signal of the two — they wrote it, they did not merely leave a chip on.
 */
export function styleConflictsWithPrompt(style: string | undefined, prompt: string): boolean {
  const spec = STYLE_DIRECTION[String(style ?? '')];
  if (!spec) return false;
  const w = words(prompt);
  return spec.conflicts.some((c) => c.split(' ').every((part) => w.has(part)));
}

/** Keep only the direction words the user has not already written — no stuffing, no repetition. */
function freshTerms(direction: string, prompt: string): string {
  const w = words(prompt);
  const kept = direction.split(',').map((t) => t.trim()).filter((term) => {
    const parts = term.toLowerCase().match(/[a-z]+/g) ?? [];
    return parts.length === 0 || !parts.every((p) => w.has(p));
  });
  return kept.join(', ');
}

/**
 * Text the user wants rendered INSIDE the image.
 *
 * Matches a quoted string, or a "with the name/word/text X" phrasing — the two ways people actually
 * ask. Returns '' when there is none.
 */
export function requestedText(prompt: string): string {
  const quoted = String(prompt ?? '').match(/["“'']([^"”'']{1,40})["”'']/);
  if (quoted) return quoted[1].trim();
  const named = String(prompt ?? '').match(/\b(?:name|word|words|text|title|says?|saying|writing|likha)\s+(?:is\s+)?([A-Za-z0-9][A-Za-z0-9 &.'-]{0,30})/i);
  return named ? named[1].trim() : '';
}

/**
 * Build the finished brief.
 *
 * Order is deliberate — subject first, then purpose direction, then style, then ratio. Image models
 * weight the opening of a prompt most heavily, so the user's actual subject must lead; direction that
 * arrived before it would compete with the thing they asked for.
 */
export function craftImagePrompt(input: CraftInput): CraftedPrompt {
  const base = String(input.prompt ?? '').trim().slice(0, MAX_PROMPT_CHARS);
  const purpose = detectPurpose(input.type, base);
  const notes: string[] = [];
  const parts: string[] = [];

  if (base) parts.push(base);

  // ── DOES THIS REQUEST ASK FOR A REAL PHOTOGRAPH? ────────────────────────────────────────────
  // Decided BEFORE the purpose direction is written, because it can cancel it. Two ways to ask:
  // tap the Realistic or Cinematic chip, or simply write it ("a realistic photo of a Delhi
  // street"). The second matters most — the image-type chip is compulsory and most people never
  // change it, so their typed words are the only signal of what they actually wanted.
  const styleSpec = STYLE_DIRECTION[String(input.style ?? '')];
  const styleDropped = !!styleSpec && styleConflictsWithPrompt(input.style, base);
  const realismChip = !!styleSpec && !styleDropped && REALISM_STYLES.has(String(input.style));
  const realism = realismChip || realismInWords(base);

  // 🔴 THE USER'S EXPLICIT ASK BEATS A CHIP THEY NEVER TOUCHED. This module already states that
  // principle, in `styleConflictsWithPrompt`'s own words — "the user's typed intent is the stronger
  // signal of the two — they wrote it, they did not merely leave a chip on" — and applied it to
  // exactly half the problem: the STYLE chip. The TYPE chip, which is the one that defaults to
  // "Modern app logo" and injects "no photorealism", was never subject to it. Same rule, both
  // halves. A photo-hostile purpose now stands down when a photograph was genuinely asked for.
  //
  // 🔴 AND WHEN THEY CONTRADICT, THE PURPOSE WINS — a prompt may never carry both. Before
  // 2026-09-21 it carried both routinely: `PURPOSE_DIRECTION.logo` says "flat vector style … **no
  // photorealism**" and `PURPOSE_NEGATIVE.logo` lists "photorealistic" to avoid, so the Realistic
  // chip produced "photograph, 50mm lens at f/2" and "no photorealism" in one breath, where the
  // negative wins. Realism was unreachable in practice — the same way it was unreachable before the
  // `photo` chip existed at all.
  //
  // ⚠️ THE PURPOSE WINS *BECAUSE THE TYPE CHIP IS NOW A DELIBERATE CHOICE.* Its default used to be
  // "Modern app logo", which made every untouched screen command a flat vector cartoon — that is
  // the bug the admin reported, and it is fixed by the picker's new neutral "Photograph" default,
  // not by this rule. With a neutral default, a photo-hostile type is one somebody picked on
  // purpose, and so is a purpose they typed themselves ("a coffee shop LOGO"). Either way a flat
  // mark is what works at small sizes, so the style chip is the one that stands down.
  const realismLoses = realism && PHOTO_HOSTILE_PURPOSES.has(purpose);
  if (purpose !== 'general') parts.push(PURPOSE_DIRECTION[purpose] + '.');
  if (realismLoses) {
    // Never silent: they tapped that chip and the reply says which way the conflict went, and how
    // to get the other answer.
    notes.push('This is a logo/icon brief, so the realistic-photo style was not applied — a flat mark is what stays readable at small sizes. Set the Image type to "Photograph" if you wanted a real photo.');
  }

  // Whether the PHOTO negatives belong. Tracked rather than inferred from `input.style`, because a
  // chip that CONFLICTED with the user's wording was dropped — and adding "no illustration"
  // negatives to a prompt we never sent photo direction to would fight the user's own words, which
  // is the one thing this module refuses to do. Words alone DO count: somebody who wrote
  // "realistic" is served by them exactly as somebody who tapped the chip is.
  const photoApplied = realism && !realismLoses;
  if (styleSpec) {
    if (styleDropped || (realismChip && realismLoses)) {
      // Silent would be wrong: the user tapped that chip and is entitled to know it was set aside.
      // `realismLoses` has already said so in its own words, so this does not say it twice.
      if (!realismLoses) notes.push('Your own wording took priority over the selected style — they asked for opposite things.');
    } else {
      const fresh = freshTerms(styleSpec.add, base);
      if (fresh) parts.push(`Style: ${fresh}.`);
    }
  }

  const ratio = SIZE_RATIO[String(input.size ?? '')];
  if (ratio) parts.push(`Aspect ratio ${ratio}.`);

  // Quality floor, stated once. Cheap in tokens and it lifts every image.
  parts.push('Professionally composed, sharp, coherent lighting, clean edges, production quality.');

  const wantedText = requestedText(base);
  if (wantedText) {
    // Never pretend this works. Every image model mangles words; saying so is the honest thing, and a
    // user who knows can shorten the text or add it themselves afterwards.
    parts.push(`If any text appears it must read exactly "${wantedText}", spelled correctly, in a clean legible typeface.`);
    // ⚠️ THIS NOTE NOW NAMES A BUTTON THAT EXISTS (2026-09-21). It used to end "adding the text
    // yourself afterwards" with nowhere to do it, which made honest advice read as an apology. The
    // "Add text" editor is that afterwards: typed text is drawn by the device's font engine, so it
    // is spelled right every time — and it is the ONLY way to get Devanagari, which no image model
    // renders reliably at any price. Keep the two in step: if the button is ever renamed, this
    // sentence sends users looking for a control that is not there.
    notes.push(`Image engines are unreliable at spelling — check that "${wantedText}" came out right, and keep it short. For text that must be exact (a shop name, a phone number, anything in Hindi), press "Add text" on the finished image and type it — that text is always spelled correctly.`);
  }

  const negative = [
    BASE_NEGATIVE,
    purpose !== 'general' ? PURPOSE_NEGATIVE[purpose] : '',
    // Realism drifts toward illustration unless it is told not to — see PHOTO_NEGATIVE.
    photoApplied ? PHOTO_NEGATIVE : '',
    photoApplied && realismChip && String(input.style) === 'cinematic' ? CINEMATIC_NEGATIVE : '',
  ]
    .filter(Boolean)
    .join(', ');

  return {
    prompt: parts.join(' ').slice(0, MAX_PROMPT_CHARS),
    negative,
    notes,
    purpose,
  };
}

/**
 * Providers that take only ONE string get the negatives appended.
 *
 * Phrased as "Avoid:" rather than a bare list, because a raw list of unwanted words in a positive
 * prompt is read by some models as a request FOR them — the classic way a negative prompt backfires.
 */
export function withInlineNegative(crafted: CraftedPrompt): string {
  if (!crafted.negative) return crafted.prompt;
  return `${crafted.prompt} Avoid: ${crafted.negative}.`.slice(0, MAX_PROMPT_CHARS);
}
