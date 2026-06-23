// AgentV3 — consensus tool (Layer 49: Collective Intelligence).
//
// Beyond a single viewpoint: the Architect can convene a PANEL of independent
// expert perspectives on a hard design decision and act on their synthesized
// verdict. The same question is put to a DIFFERENT AI model (the non-Claude free
// router) three times, each under a distinct reviewer persona — correctness,
// security, and UX/maintainability — so the answer reflects multiple expert
// lenses, not one.
//
// Like SecondOpinion, this module imports nothing from `../routes` (strangler-
// fig isolation): it reuses the same minimal OpinionRouter port, and the
// composition root adapts the real AIRouter to it. The function NEVER throws —
// a single failing perspective is skipped, and total failure returns a clear,
// honest message so the build is never blocked.

import type { OpinionRouter } from './SecondOpinion';

/** One expert lens on the question, plus which provider produced it. */
export interface Perspective {
  hat: string;
  text: string;
  provider: string;
}

/** Convene a panel on a hard decision and return their synthesized verdict. */
export type Consensus = (question: string) => Promise<string>;

/** Per-perspective text cap, to keep any single voice from dominating. */
const PERSPECTIVE_CHAR_CAP = 600;
/** Overall block cap, so the synthesized result stays bounded for the model. */
const BLOCK_CHAR_CAP = 2500;

/** The three independent reviewer personas the panel consults. */
const PANEL_HATS: ReadonlyArray<{ hat: string; system: string }> = [
  {
    hat: 'Correctness',
    system: [
      'You are a senior correctness and robustness reviewer from a DIFFERENT AI',
      'model than the one that produced the work. Judge the decision purely on',
      'correctness, edge cases, failure modes and robustness. Be specific and',
      'concise — name the exact risk, not generalities. If it is sound, say so',
      'plainly rather than inventing concerns.',
    ].join('\n'),
  },
  {
    hat: 'Security',
    system: [
      'You are a senior security reviewer from a DIFFERENT AI model than the one',
      'that produced the work. Judge the decision purely on security: auth,',
      'secrets, injection, data exposure and unsafe dependencies. Be specific and',
      'concise — name the exact risk, not generalities. If it is safe, say so',
      'plainly rather than inventing concerns.',
    ].join('\n'),
  },
  {
    hat: 'UX/Maintainability',
    system: [
      'You are a senior product, UX and maintainability reviewer from a DIFFERENT',
      'AI model than the one that produced the work. Judge the decision on user',
      'value, clarity, simplicity and long-term maintainability. Be specific and',
      'concise — name the exact concern, not generalities. If it is well-judged,',
      'say so plainly rather than inventing concerns.',
    ].join('\n'),
  },
];

/**
 * Synthesize the gathered perspectives into a single readable verdict block.
 * PURE and deterministic — no I/O. Each perspective text is trimmed to a cap and
 * the whole block is bounded so it stays a compact tool result. With no
 * perspectives it returns an honest "unavailable" line.
 */
export function synthesizeConsensus(question: string, perspectives: Perspective[]): string {
  if (perspectives.length === 0) {
    return 'Consensus unavailable: no perspectives could be gathered.';
  }
  const head = `Consensus panel on: ${question}`;
  const bodies = perspectives.map((p) => {
    const text = p.text.trim().slice(0, PERSPECTIVE_CHAR_CAP);
    return `[${p.hat} · via ${p.provider}]\n${text}`;
  });
  const note = `Panel note: ${perspectives.length} perspective(s) gathered.`;
  const block = [head, ...bodies, note].join('\n\n');
  return block.length > BLOCK_CHAR_CAP ? block.slice(0, BLOCK_CHAR_CAP) : block;
}

/**
 * Build a consensus function bound to a non-Claude router. The returned function
 * puts the same question to each panel persona in turn, collecting the successful
 * answers. A single persona failing does NOT abort the others — it is skipped.
 * The function never throws: on total failure it returns a "Consensus
 * unavailable: <reason>" string so the Architect can continue without it.
 */
export function makeConsensus(router: OpinionRouter): Consensus {
  return async (question: string): Promise<string> => {
    try {
      const collected: Perspective[] = [];
      for (const { hat, system } of PANEL_HATS) {
        try {
          const { response } = await router.route(question, system);
          collected.push({ hat, text: response.content, provider: response.provider });
        } catch {
          // A single panellist failing must not abort the panel — skip it.
        }
      }
      return synthesizeConsensus(question, collected);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return `Consensus unavailable: ${reason}`;
    }
  };
}
