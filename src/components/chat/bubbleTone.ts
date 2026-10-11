// Shared chat-bubble tones (chat-UI unification, step 1).
//
// NavBharatAI has two chat surfaces: the IDE chat (`ide/AIChat.tsx`) and the Pro builder
// (`agentv3/AgentV3Panel.tsx`). They grew separately, so the same idea ("this is the user's message",
// "this is the assistant's reply") was spelled out by hand in each. This module is the ONE place those
// colour/surface classes live, so the two UIs can converge piece by piece without a big-bang rewrite.
//
// PRESENTATIONAL ONLY: class-name strings, no state, no streaming logic. Shapes (corner, padding,
// width) stay with each UI for now; only the tone is shared. Values are exactly what both UIs used
// before this module existed, so adopting it is pixel-identical.

/** The user's own message: filled with the theme accent token (was hard-coded bg-indigo-600 until 2026-10). */
export const USER_BUBBLE_TONE = 'bg-accent text-on-accent';

/** An assistant reply on a card surface. */
export const ASSISTANT_BUBBLE_TONE = 'bg-card text-body';
