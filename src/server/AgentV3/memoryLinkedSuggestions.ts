// 💡 SUGGESTIONS, LINKED TO THE APP'S OWN MEMORY (admin 2026-08-20: "suggesting 💡 ko us app memory
// (jo app ban rahi hai) se link karo").
//
// WHAT WAS MISSING. The bulb's ideas came from `nextBuildSuggestions`, which reads the app's FILES and
// nothing else — so every suggestion was inferred from what the app IS. The one thing it never read was
// the app's memory of what the USER ASKED FOR. A user who wrote "and add a leaderboard" in turn 3, on a
// build where the leaderboard never got made, was offered "add a dark mode" — a guess of ours, while
// their own unmet words sat in the workspace's episode log unread.
//
// WHAT THIS ADDS. The user's past requests are read from WorkspaceMemory and checked against what was
// actually built; anything they asked for that is genuinely NOT there becomes the FIRST suggestion, in
// their own words. Their own unfinished ask outranks any idea we could invent.
//
// TWO HONESTY RULES, both load-bearing:
//   1. Detection is `analyzeRequirementCoverage` — the SAME analyser the build's own coverage gate uses.
//      A second copy here would eventually disagree with the build report about what the app contains,
//      and then one of the two would be lying to the user.
//   2. THE CLAIM MATCHES THE EVIDENCE, per suggestion. The analyser reports two grades of absence, and
//      they are NOT the same fact:
//        • `confirmedMissing` — the feature has a code fingerprint (`evidence`) and the file BODIES were
//          searched for it and it is not there. That is a checked fact, and it is said plainly.
//        • the rest of `missing` — no page, component or route is NAMED for it. True as far as it goes,
//          but a chat built inline inside App.tsx would land here too.
//      Only FIVE features in the coverage table carry an `evidence` pattern, so using `confirmedMissing`
//      alone would mean this feature almost never fired — shipped, and dead. So both grades are offered
//      and the WORDING carries the difference: an unconfirmed one says it could not be found and invites
//      the user to ignore it if it is already there. A suggestion the user reviews can afford to be
//      unsure; it may not afford to sound sure when it is not.
//
// PURE: no I/O, no clock, no model — the caller supplies the requests, the graph and the sources. Never
// throws, and returns [] whenever it cannot say something true.

import { analyzeRequirementCoverage } from './RequirementCoverage';
import type { ProjectGraph } from './WorkspaceMemory';
import type { NextSuggestion } from './nextBuildSuggestions';

/** How many unmet asks the bulb may show at once — the rest of the list still needs room. */
export const MAX_MEMORY_SUGGESTIONS = 3;

/** A label like "leaderboard" → a stable, collision-free suggestion id. */
function memoryId(label: string): string {
  return `asked-${label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * The label as a person would say it.
 *
 * The coverage table names features with every synonym it matches — 'login / authentication',
 * 'chat / messaging', 'analytics / reports / charts'. Those read as a regex, not as a sentence:
 * "Finish the chat / messaging" is not something anyone would write. The first alternative is always
 * the plain word, so the title and the prompt use that and the id keeps the full label for uniqueness.
 */
function shortLabel(label: string): string {
  return String(label || '').split('/')[0].trim() || String(label || '').trim();
}

/**
 * Suggestions built from what the user ASKED FOR but does not have.
 *
 * `requests` are the user's own past request texts, oldest→newest (WorkspaceMemory.recentRequests).
 * They are analysed NEWEST FIRST, because the most recent ask is the one still on the user's mind.
 */
export function memoryLinkedSuggestions(input: {
  requests: ReadonlyArray<string>;
  graph: ProjectGraph;
  sources?: ReadonlyArray<{ path: string; content: string }>;
  max?: number;
}): NextSuggestion[] {
  const max = Math.max(1, input.max ?? MAX_MEMORY_SUGGESTIONS);
  const requests = (Array.isArray(input.requests) ? input.requests : [])
    .map((r) => String(r || '').trim())
    .filter(Boolean);
  if (requests.length === 0) return [];

  const out: NextSuggestion[] = [];
  const seen = new Set<string>();

  // Newest request first — the freshest unmet ask is the most useful "what next".
  for (const request of [...requests].reverse()) {
    let missing: string[] = [];
    let confirmed: string[] = [];
    try {
      // The SAME analyser the build's coverage gate runs (see the honesty rules above).
      const report = analyzeRequirementCoverage(request, input.graph, input.sources);
      missing = report.missing;
      confirmed = report.confirmedMissing;
    } catch {
      continue; // a request we cannot analyse simply contributes nothing
    }
    // The checked-fact ones first: they are the suggestions we can stand behind without a caveat.
    const ordered = [...missing].sort((a, b) => Number(confirmed.includes(b)) - Number(confirmed.includes(a)));
    for (const label of ordered) {
      const clean = String(label || '').trim();
      if (!clean) continue;
      const id = memoryId(clean);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const spoken = shortLabel(clean);
      const isConfirmed = confirmed.includes(clean);
      out.push({
        id,
        title: `Finish the ${spoken}`,
        // Says WHY it is being offered — this is the user's own ask, not an idea we invented — and
        // states exactly how sure we are that it is missing.
        detail: isConfirmed
          ? 'You asked for this earlier and it is not in the app yet.'
          : `You asked for this earlier and I could not find a ${spoken} in the app — ignore this if it is already there.`,
        prompt: `Add the ${spoken} I asked for earlier — I could not find it in the app. Build it fully and wire it to the existing screens.`,
        // 'domain' rather than 'enhancement': this is specific to THIS app's requirements, not universal polish.
        kind: 'domain',
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/**
 * The bulb's final list: the user's unmet asks FIRST, then the file-derived ideas.
 *
 * Deduped by id AND by title, because the same feature can arrive from both sides (they were derived
 * independently) and showing it twice would make the bulb look broken. The memory entry wins — it is
 * grounded in the user's own words rather than in our inference.
 */
export function mergeSuggestions(
  memory: ReadonlyArray<NextSuggestion>,
  derived: ReadonlyArray<NextSuggestion>,
  max: number,
): NextSuggestion[] {
  const out: NextSuggestion[] = [];
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const s of [...memory, ...derived]) {
    if (!s || !s.id) continue;
    const t = String(s.title || '').toLowerCase().trim();
    if (ids.has(s.id) || (t && titles.has(t))) continue;
    ids.add(s.id);
    if (t) titles.add(t);
    out.push(s);
    if (out.length >= Math.max(1, max)) break;
  }
  return out;
}
