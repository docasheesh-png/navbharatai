// Combining a screenshot-derived prompt with what the user actually typed.
//
// ROOT CAUSE (admin 2026-07-28): the Screenshot → App flow sent ONLY the prompt derived from the
// image and silently discarded the composer text. So "make this page but in Hindi" lost "but in
// Hindi" — the single most likely thing someone adds to a screenshot, and the part that carries
// their actual intent. The image describes WHAT it looks like; the typed line says what to do
// DIFFERENTLY, so dropping it inverts the value of the two inputs.
//
// The user's words go LAST and are labelled as taking priority, because a model reading a long
// generated description followed by one short human instruction should treat the human as the
// override. PURE + tested.

/** Merge the image-derived prompt with the user's typed text (either may be empty). */
export function combineScreenshotPrompt(imagePrompt: string, typed: string): string {
  const image = (imagePrompt || '').trim();
  const user = (typed || '').trim();
  if (!user) return image;
  if (!image) return user;
  return `${image}\n\nAdditional instructions from the user (these take priority):\n${user}`;
}
