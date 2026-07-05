import type { AIRouter } from '../AI/Router/AIRouter';
import { extractFirstJsonSlice } from '../lib/extractJson';

export interface PlanStep {
  description: string;
  focusHint: string;
}

function extractJson(text: string): string {
  // Balanced, string-aware extraction (shared) — a naive indexOf/lastIndexOf slice mis-grabbed a
  // bracket from trailing prose and silently failed the parse. '' on no match → the caller's
  // JSON.parse throws → its try/catch returns the fallback (unchanged behavior).
  return extractFirstJsonSlice(text, 'object') ?? '';
}

/**
 * Phase 7 — standalone planning agent. Makes a single AI call with an architect-
 * focused prompt and returns a structured list of plan steps for the orchestrator.
 *
 * Returns [] for conversational turns (no plan needed).
 * Returns a single fallback step on any parse or router failure so a planning
 * error NEVER blocks the build.
 */
export class PlannerAgent {
  constructor(private router: AIRouter) {}

  async plan(
    instruction: string,
    fileTree?: string,
    signal?: AbortSignal,
  ): Promise<PlanStep[]> {
    const fallback: PlanStep[] = [
      { description: instruction.slice(0, 80), focusHint: 'complete the task end-to-end' },
    ];

    try {
      const systemPrompt =
        'You are a senior software architect producing a concise build plan.\n' +
        'Given a user request, decide if it is a CODING task (build/create/modify/fix software) ' +
        'or CONVERSATIONAL (greeting, question, advice, planning discussion).\n' +
        'Respond with ONE JSON object, no markdown fences:\n' +
        '- Conversational: {"conversational": true}\n' +
        '- Coding: {"steps": [{"description": "short label ≤ 80 chars", "focusHint": "what to focus on ≤ 100 chars"}]}\n' +
        '  3–8 ordered steps. Cover: scaffold project → install deps → implement core → styling → testing/verification.\n' +
        '  Keep each step focused on ONE concern. No vague steps like "set up everything".';

      const fileBlock = fileTree
        ? `\n\nWorkspace files already present:\n${fileTree}`
        : '';

      const prompt = `User request:\n${instruction}${fileBlock}\n\nReturn the JSON now.`;

      const { response, telemetry } = await this.router.route(prompt, systemPrompt);
      if (signal?.aborted || !telemetry.success) return fallback;

      const parsed = JSON.parse(extractJson(response.content));
      if (parsed.conversational === true) return [];
      if (!Array.isArray(parsed.steps)) return fallback;

      const steps: PlanStep[] = (parsed.steps as unknown[])
        .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
        .filter(s => typeof s.description === 'string' && (s.description as string).trim())
        .map(s => ({
          description: (s.description as string).trim().slice(0, 80),
          focusHint:
            typeof s.focusHint === 'string' && (s.focusHint as string).trim()
              ? (s.focusHint as string).trim().slice(0, 100)
              : (s.description as string).trim().slice(0, 100),
        }))
        .slice(0, 8);

      return steps.length > 0 ? steps : fallback;
    } catch {
      return fallback;
    }
  }
}
