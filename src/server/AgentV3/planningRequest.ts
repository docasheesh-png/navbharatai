// AgentV3 — THE REQUEST AS THE BUILDER WILL READ IT, for everything that sizes and plans it first.
//
// 🔴 WHY (autopsy e725e002, 2026-09-29). The user's message was the four words-and-a-path
// `mkdir src`. The builder — handed that message PLUS what gives it meaning (an attached file and/or
// the requests made earlier in this workspace) — built a 35-file e-commerce site: catalogue, search,
// cart, checkout with a demo payment, accounts, saved addresses, orders. Every judge that runs BEFORE
// the builder read `mkdir src` alone:
//   • the complexity score said 5 (the score of "hi") → the build opened on the cheapest rung;
//   • the ETA promised 2–4 minutes → it took 17.6 (6.1× the midpoint);
//   • the fast lane planned SEVEN files for "the main page" of a generic app, spent 267 s writing
//     them, and handed the builder boilerplate for an app nobody had asked for.
// The builder was right and every sizer was wrong, because they were not reading the same request.
//
// The class, named so it is recognised again: a judge that READS LESS THAN THE WORKER IT JUDGES.
// The fix is not to make each judge smarter; it is to give all of them the text the builder acts on,
// from ONE function, so the list of places that see the whole request cannot drift one reader at a
// time. PURE — the caller passes in what it already holds.
//
// 🔒 What goes in, and why each part is bounded:
//   • the user's own message, always, first, unchanged — nothing here can hide it;
//   • attached-file text (already extracted, redacted and fenced by the caller), because the file IS
//     this turn's request — capped, so a 200-page PDF cannot turn a sizing heuristic into a stall;
//   • the earlier requests of this workspace, ONLY while no user app exists yet. On a fresh workspace
//     the earlier turns are the spec being built (the builder already receives them as project
//     context); on an existing app they describe work already done, and adding them to "make the
//     button blue" would size a colour change as the whole app.
// Kill switch: AGENTV3_PLANNING_CONTEXT=off returns the message alone — the pre-change behaviour.

/** Kill switch. Default ON. */
export function planningContextEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PLANNING_CONTEXT ?? '').trim().toLowerCase() !== 'off';
}

/** Longest slice of attached-file text a sizer or planner is given. */
export const PLANNING_ATTACHMENT_MAX = 12_000;
/** Longest slice of each earlier request. */
export const PLANNING_EARLIER_REQUEST_MAX = 4_000;
/** How many earlier requests are carried — the most recent ones. */
export const PLANNING_EARLIER_REQUESTS = 3;

export type PlanningSource = 'attachment' | 'earlier-requests';

export interface PlanningRequestInput {
  /** The user's message for this turn. */
  prompt: string;
  /** Text extracted from files attached to THIS turn ('' when none). */
  attachmentText?: string | null;
  /** This workspace's earlier requests, oldest → newest (as `WorkspaceMemory.recentRequests()` returns them). */
  recentRequests?: readonly string[] | null;
  /** Does the workspace already hold a user app? Earlier requests are added only when it does not. */
  userAppExists: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface PlanningRequest {
  /** The text every sizer and planner reads. Equals `prompt` when nothing was added. */
  text: string;
  /** What was added beyond the message — empty when `text === prompt`. For the build report. */
  sources: PlanningSource[];
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}\n[… cut at ${max} characters]`;
}

/**
 * The request as the builder will read it. PURE.
 *
 * `recentRequests` from `WorkspaceMemory.recentRequests()` is oldest-first and kept in that order (the
 * last one is the most recent). The current message may or may not already be among them, so it is
 * dropped wherever it appears rather than assumed to be last.
 */
export function planningRequest(input: PlanningRequestInput): PlanningRequest {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  if (!planningContextEnabled(input.env)) return { text: prompt, sources: [] };

  const parts: string[] = [prompt];
  const sources: PlanningSource[] = [];

  const attachment = typeof input.attachmentText === 'string' ? input.attachmentText.trim() : '';
  if (attachment) {
    parts.push(`[The user attached file(s) with this message. Their content describes what to build:]\n${clip(attachment, PLANNING_ATTACHMENT_MAX)}`);
    sources.push('attachment');
  }

  if (!input.userAppExists && Array.isArray(input.recentRequests)) {
    const own = prompt.trim();
    const earlier = input.recentRequests
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0 && r.trim() !== own)
      .slice(-PLANNING_EARLIER_REQUESTS);
    if (earlier.length > 0) {
      parts.push([
        '[Earlier in this conversation — no app has been built yet, so these describe the app being asked for:]',
        ...earlier.map((r) => `- ${clip(r, PLANNING_EARLIER_REQUEST_MAX)}`),
      ].join('\n'));
      sources.push('earlier-requests');
    }
  }

  return { text: parts.join('\n\n'), sources };
}

/** The admin line for `PLANNING_CONTEXT`. PURE. */
export function planningContextNote(req: PlanningRequest, promptChars: number): string {
  const what = req.sources.map((s) => (s === 'attachment' ? 'the attached file(s)' : 'the earlier requests in this conversation')).join(' and ');
  return `Sized and planned from the message plus ${what} (${req.text.length} characters read, the message itself is ${promptChars}) — the same request the builder receives, so the complexity score, the ETA and the fast lane's file plan describe the app actually being built.`;
}
