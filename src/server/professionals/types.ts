/**
 * Shared "Professional AI" framework — types.
 *
 * A professional (Teacher, Lawyer, CA, Astrologer, …) is defined by a small
 * config: persona/system prompt + an optional grounded knowledge base + a
 * disclaimer. One generic engine + one route serve all of them, so adding a new
 * professional is a config, not a new subsystem.
 */

export interface KnowledgeCard {
  id: string;
  topic: string;
  keywords: string[];
  content: string;
  source: string;
}

export interface ProfessionalConfig {
  /** Stable id, also the ViewType (e.g. 'teacher_ai'). */
  id: string;
  /** Display name (e.g. 'Teacher AI'). */
  name: string;
  /** Persona + behaviour system prompt. */
  systemPrompt: string;
  /** Optional grounded domain knowledge (retrieved per query, cited). */
  knowledge?: KnowledgeCard[];
  /** Short honest disclaimer appended to the persona. */
  disclaimer?: string;
}
