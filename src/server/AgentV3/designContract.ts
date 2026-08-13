/**
 * DESIGN-TO-CODE CONTRACT (ROADMAP AP-8) — turn a screenshot into something the build can be HELD TO.
 *
 * The vision pipeline already existed: upload a design, and `describeVisionAttachments` writes a
 * paragraph about it into the build prompt. The paragraph is the problem. Prose is advice, and a
 * builder under pressure treats advice as optional — so a user who uploaded a five-section landing
 * page routinely got three of the sections, and nothing anywhere in the system noticed. The image was
 * "used"; the design was not delivered.
 *
 * The missing step is an INTERMEDIATE CONTRACT: a small typed structure between the picture and the
 * code, listing the screens, the sections in order, and the exact visible labels. It matters because
 * it is checkable. Prose can only be believed; a contract can be verified against the files that were
 * actually written, and the parts that are missing can be NAMED.
 *
 * 🔑 IT COSTS NO EXTRA MODEL CALL. The contract is requested in the SAME vision call that already
 * produces the description — one prompt asking for prose and then a fenced JSON block. A separate
 * structured pass would have doubled the vision cost of every screenshot upload to buy the same
 * information twice.
 *
 * 🔒 IT IS EVIDENCE, NEVER A GATE. A design contract that could FAIL a build would let a model's
 * misreading of a screenshot destroy a working app — the exact trade this repo refuses everywhere
 * else. Verification produces an honest report code and nothing more:
 *   • DESIGN_CONTRACT_MET      — every named section and label is present in the code.
 *   • DESIGN_CONTRACT_PARTIAL  — some are missing, and they are listed BY NAME so the next turn (or
 *                                the user) can ask for exactly those.
 *   • DESIGN_CONTRACT_ABSENT   — no contract was extracted; the image was still described as before.
 * The last one is the honest default rather than a silent success: a model that ignored the JSON
 * request must not read as "the design was matched".
 */

/** One screen the design describes. Most uploads are a single screen; a flow can be several. */
export interface DesignScreen {
  /** What this screen is, in the user's terms: "Landing page", "Checkout". */
  name: string;
  /** Sections top-to-bottom. ORDER IS THE CONTRACT — a page with the right parts in the wrong order is the wrong page. */
  sections: string[];
  /** Text visible in the image, verbatim: headings, button labels, nav items. The checkable part. */
  labels: string[];
}

export interface DesignContract {
  screens: DesignScreen[];
  /** Colours as written in the image analysis (hex where the model could tell). Advisory only. */
  palette: string[];
  /** 'mobile' | 'desktop' | 'responsive' — drives layout decisions, so worth carrying separately. */
  viewport: string;
}

/** Caps: a contract is a checklist, not a transcript. An unbounded one would swamp the build prompt. */
const MAX_SCREENS = 6;
const MAX_SECTIONS = 12;
const MAX_LABELS = 24;
const MAX_TEXT = 80;

/**
 * The extra instruction appended to the vision prompt so ONE call returns prose AND the contract.
 *
 * Deliberately explicit about "verbatim" and "top to bottom": those two properties are what make the
 * result verifiable later. A label the model paraphrased cannot be found in the code, and would be
 * reported as missing when it was really delivered — a false alarm is worse than no check at all.
 */
export const DESIGN_CONTRACT_INSTRUCTION = [
  '',
  'THEN, if this file is a UI design, screenshot, mockup or wireframe, append a fenced code block',
  'labelled `design-contract` containing ONLY JSON of this exact shape:',
  '```design-contract',
  '{"screens":[{"name":"Landing page","sections":["hero","features","pricing","footer"],',
  '"labels":["Get started","Pricing","Contact us"]}],"palette":["#0f172a","#22d3ee"],"viewport":"responsive"}',
  '```',
  'Rules: list sections TOP TO BOTTOM in the order they appear. Copy labels VERBATIM as shown in the',
  'image — do not paraphrase, translate or invent them. If the file is not a UI design, omit the block',
  'entirely rather than guessing.',
].join('\n');

/** Trim and bound one string; anything unusable becomes ''. */
function clean(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
}

function cleanList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = clean(item);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Pull the contract out of a vision description.
 *
 * Tolerant by design: models fence JSON inconsistently (```design-contract, plain ```, or nothing),
 * and a strict parser would throw away a perfectly good contract over a missing label. Any failure
 * yields null, which reads downstream as DESIGN_CONTRACT_ABSENT — never as an empty contract that
 * would then "verify" trivially and report success.
 */
export function parseDesignContract(text: string | null | undefined): DesignContract | null {
  const raw = String(text ?? '');
  if (!raw) return null;

  const candidates: string[] = [];
  for (const m of raw.matchAll(/```(?:design-contract|json)?\s*([\s\S]*?)```/g)) candidates.push(m[1]);
  // A model that dropped the fence but produced the object is still doing what was asked.
  const bare = raw.match(/\{\s*"screens"\s*:[\s\S]*\}/);
  if (bare) candidates.push(bare[0]);

  for (const candidate of candidates) {
    let parsed: unknown;
    try { parsed = JSON.parse(candidate.trim()); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.screens)) continue;

    const screens: DesignScreen[] = [];
    for (const s of obj.screens.slice(0, MAX_SCREENS)) {
      if (!s || typeof s !== 'object') continue;
      const sc = s as Record<string, unknown>;
      const name = clean(sc.name) || 'Screen';
      const sections = cleanList(sc.sections, MAX_SECTIONS);
      const labels = cleanList(sc.labels, MAX_LABELS);
      // A screen with neither sections nor labels says nothing and cannot be verified — drop it
      // rather than carry a row that would always "pass".
      if (sections.length === 0 && labels.length === 0) continue;
      screens.push({ name, sections, labels });
    }
    if (screens.length === 0) continue;

    return {
      screens,
      palette: cleanList(obj.palette, 8).filter((c) => /^#?[0-9a-z]/i.test(c)),
      viewport: clean(obj.viewport) || 'responsive',
    };
  }
  return null;
}

/** Remove the contract block from the prose, so the build prompt is not shown the same JSON twice. */
export function stripContractBlock(text: string): string {
  return String(text ?? '').replace(/```design-contract\s*[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The contract as instructions the builder must satisfy.
 *
 * Written as requirements rather than description ("Build these sections IN THIS ORDER") because the
 * whole point of the intermediate step is to stop a design from being treated as background colour.
 * The labels are quoted so they land in the code verbatim — which is also what makes the verification
 * below meaningful rather than fuzzy.
 */
export function contractToPromptBlock(contract: DesignContract | null): string {
  if (!contract || contract.screens.length === 0) return '';
  const lines: string[] = [
    'DESIGN CONTRACT (extracted from the uploaded design — build EXACTLY this):',
    `Viewport: ${contract.viewport}.`,
  ];
  if (contract.palette.length > 0) lines.push(`Palette: ${contract.palette.join(', ')}.`);
  for (const s of contract.screens) {
    lines.push(`Screen "${s.name}":`);
    if (s.sections.length > 0) lines.push(`  - Sections, IN THIS ORDER, top to bottom: ${s.sections.join(' → ')}.`);
    if (s.labels.length > 0) lines.push(`  - These exact texts must appear, verbatim: ${s.labels.map((l) => `"${l}"`).join(', ')}.`);
  }
  lines.push('Every section and every quoted text above is a requirement, not a suggestion.');
  return lines.join('\n');
}

export type DesignContractVerdict = 'DESIGN_CONTRACT_MET' | 'DESIGN_CONTRACT_PARTIAL' | 'DESIGN_CONTRACT_ABSENT';

export interface DesignContractCheck {
  verdict: DesignContractVerdict;
  /** Labels the contract required that appear nowhere in the code, by name. */
  missingLabels: string[];
  /** Sections with no recognisable trace in the code. */
  missingSections: string[];
  /** How many required items were found, for an honest ratio in the report. */
  found: number;
  total: number;
  summary: string;
}

/** Normalise for comparison: case and punctuation differ freely between a mockup and real markup. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Check the delivered code against the contract.
 *
 * ⚠️ SOURCE TEXT ONLY, and deliberately generous. This searches the concatenated source for each
 * required string; it does not parse JSX or render anything. That means it can be fooled by a label
 * sitting in a comment — and that is the RIGHT bias. A false "missing" would send the next turn to
 * rebuild a section that was already there, spending the user's money to damage working code, whereas
 * a false "present" merely fails to notice something. When in doubt, this stays quiet.
 *
 * Sections are matched loosely (a "hero" section may be a component, a class, an id or a comment)
 * because a section has no single canonical spelling in code. Labels are the strict half — they are
 * user-visible text and should appear as written.
 */
export function verifyDesignContract(
  contract: DesignContract | null,
  files: Record<string, string>,
): DesignContractCheck {
  if (!contract || contract.screens.length === 0) {
    return {
      verdict: 'DESIGN_CONTRACT_ABSENT',
      missingLabels: [], missingSections: [], found: 0, total: 0,
      summary: 'No design contract was extracted from the upload, so the design could not be checked.',
    };
  }

  // Only UI source is worth searching; a lockfile that happens to contain the word "pricing" would
  // make every check pass.
  const haystack = normalize(
    Object.entries(files)
      .filter(([p]) => /\.(tsx?|jsx?|vue|svelte|html|css|scss)$/i.test(p) && !/node_modules|package-lock|\.min\./i.test(p))
      .map(([, c]) => c)
      .join('\n'),
  );

  const missingLabels: string[] = [];
  const missingSections: string[] = [];
  let found = 0;
  let total = 0;

  for (const screen of contract.screens) {
    for (const label of screen.labels) {
      total += 1;
      const n = normalize(label);
      if (n && haystack.includes(n)) found += 1;
      else missingLabels.push(label);
    }
    for (const section of screen.sections) {
      total += 1;
      const n = normalize(section);
      // A section name is often one word inside a longer identifier ("HeroSection", "hero-wrap"),
      // which normalisation collapses to spaces — so match the word anywhere.
      if (n && haystack.includes(n)) found += 1;
      else missingSections.push(section);
    }
  }

  if (total === 0) {
    return {
      verdict: 'DESIGN_CONTRACT_ABSENT',
      missingLabels: [], missingSections: [], found: 0, total: 0,
      summary: 'The design contract listed nothing checkable.',
    };
  }

  const met = missingLabels.length === 0 && missingSections.length === 0;
  const parts: string[] = [];
  if (missingSections.length > 0) parts.push(`missing section(s): ${missingSections.join(', ')}`);
  if (missingLabels.length > 0) parts.push(`missing text: ${missingLabels.map((l) => `"${l}"`).join(', ')}`);

  return {
    verdict: met ? 'DESIGN_CONTRACT_MET' : 'DESIGN_CONTRACT_PARTIAL',
    missingLabels,
    missingSections,
    found,
    total,
    summary: met
      ? `The build matches the uploaded design: all ${total} required section(s) and text(s) are present.`
      : `The build matches ${found} of ${total} items from the uploaded design — ${parts.join('; ')}.`,
  };
}
