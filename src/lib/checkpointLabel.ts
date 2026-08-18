// B5 — the PURE rules for naming a checkpoint, shared by the server store and the client panel.
//
// It lives in src/lib (not in CheckpointStore) because the client cannot import that module — it pulls
// firebase-admin. Two copies of "what counts as a name" would drift the moment one side changed its cap,
// and the visible symptom would be a name the UI shows and the server silently truncates. One
// implementation, imported by both (root-cause rule 2).

/** Longest name we store. Long enough to be a real sentence, short enough to render in one line. */
export const CHECKPOINT_LABEL_MAX = 80;

/**
 * Normalise a user-supplied checkpoint name. Collapses whitespace (a pasted multi-line string must not
 * break the list layout), trims, and caps. Returns '' for anything unusable — and '' MEANS "no label",
 * which is also how a label is cleared, so no separate delete path is needed. Pure.
 */
export function normalizeCheckpointLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, CHECKPOINT_LABEL_MAX);
}

/**
 * What to SHOW for a checkpoint: the user's name if they gave one, else the commit message, else the
 * short sha. Never empty — an unnamed, message-less checkpoint still has to be identifiable in a list,
 * which is the whole complaint B5 answers ("14 unnamed checkpoints are unusable"). Pure.
 */
export function checkpointDisplayName(cp: { label?: string; message?: string; sha?: string } | null | undefined): string {
  if (!cp) return '';
  const label = normalizeCheckpointLabel(cp.label);
  if (label) return label;
  const message = typeof cp.message === 'string' ? cp.message.trim() : '';
  if (message) return message;
  const sha = typeof cp.sha === 'string' ? cp.sha.slice(0, 7) : '';
  return sha || 'checkpoint';
}
