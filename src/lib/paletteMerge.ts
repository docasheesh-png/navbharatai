// Turning an AI-generated brand palette into the Design System's own colour tokens.
//
// WHY THIS EXISTS. `/api/design/palette` has been live for a while — real AI, real auth gate, real
// wallet billing — and NOTHING in the client ever called it. `DesignAdvisor`'s `aiPalette` is imported
// by exactly one file, the route itself. Meanwhile the Design System screen has a Colors tab where the
// only way to choose a palette is to open a colour picker and guess, one swatch at a time.
//
// So this is the same shape as the Render deploy (#2174): a real capability with no door. The door
// belongs on the screen that already exists, not on a new one — a second "design" surface would just
// make the user wonder which of the two is the real one.
//
// The mapping is separated from the component because it is where the decisions live, and every one of
// them is a judgement about someone's existing work:
//   • an AI colour must never overwrite a token the user cannot get back;
//   • a malformed colour must never reach the tokens at all;
//   • an unknown name from the model is kept, not dropped, if it is a valid colour.
// PURE — no I/O, no React.

export interface ColorToken {
  name: string;
  value: string;
  description: string;
}

/** A `#RGB` or `#RRGGBB` hex, the only thing a colour input and a CSS variable both accept. PURE. */
export function isHexColor(value: unknown): boolean {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** Normalise `#abc` → `#aabbcc`, lowercase. Junk returns null rather than a half-fixed string. PURE. */
export function normalizeHex(value: unknown): string | null {
  if (!isHexColor(value)) return null;
  const hex = String(value).trim().toLowerCase();
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex;
}

export interface PaletteMergeResult {
  tokens: ColorToken[];
  /** Token names whose value the palette actually changed. */
  updated: string[];
  /** Names the model returned that were not valid colours — reported, never silently dropped. */
  rejected: string[];
  /** Names the model returned that the design system did not already have. */
  added: string[];
}

/**
 * Merge an AI palette into the existing colour tokens.
 *
 * MATCHING IS BY NAME, CASE-INSENSITIVELY, and the existing token's `description` is KEPT — the user
 * (or a previous build) wrote that, and a colour suggestion is not a reason to lose it. A name the
 * system does not have is ADDED rather than discarded: a model that returns `surface` for a brand that
 * needs one is being useful, and dropping it would silently ignore half the answer.
 *
 * A value that is not a valid hex colour is REJECTED and named. Writing it into a token would put a
 * broken value into a `--color-*` CSS variable and into the user's real app on the next save, where it
 * would fail silently — a colour that does not parse simply renders as nothing. PURE.
 */
export function mergePalette(current: ColorToken[], palette: Record<string, unknown> | null | undefined): PaletteMergeResult {
  const existing = Array.isArray(current) ? current : [];
  const entries = Object.entries(palette || {});
  if (entries.length === 0) return { tokens: existing, updated: [], rejected: [], added: [] };

  const updated: string[] = [];
  const rejected: string[] = [];
  const added: string[] = [];
  const byName = new Map(existing.map((t, i) => [String(t.name || '').toLowerCase(), i]));
  const tokens = existing.map((t) => ({ ...t }));

  for (const [rawName, rawValue] of entries) {
    const name = String(rawName || '').trim();
    if (!name) continue;
    const hex = normalizeHex(rawValue);
    if (!hex) { rejected.push(name); continue; }

    const at = byName.get(name.toLowerCase());
    if (at === undefined) {
      tokens.push({ name, value: hex, description: 'Suggested for your brand' });
      added.push(name);
      continue;
    }
    if (normalizeHex(tokens[at].value) === hex) continue; // no change — do not claim one
    tokens[at] = { ...tokens[at], value: hex };            // description deliberately preserved
    updated.push(tokens[at].name);
  }

  return { tokens, updated, rejected, added };
}

/**
 * One honest sentence about what the palette did.
 *
 * It reports the REJECTED count too. A silent partial application is how a user ends up believing the
 * feature works while two of their colours never changed. PURE.
 */
export function paletteSummary(r: PaletteMergeResult): string {
  const changed = r.updated.length + r.added.length;
  if (changed === 0 && r.rejected.length === 0) return 'Those colours already match your palette — nothing to change.';
  if (changed === 0) return 'No usable colours came back this time. Try describing your brand a little differently.';
  const parts = [`Updated ${changed} colour${changed === 1 ? '' : 's'}`];
  if (r.added.length) parts.push(`(${r.added.length} new)`);
  if (r.rejected.length) parts.push(`— ${r.rejected.length} could not be read and were left alone`);
  return `${parts.join(' ')}. Nothing is saved to your app until you use the Export tab.`;
}
