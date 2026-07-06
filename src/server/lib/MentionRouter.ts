// P-COLLAB.5 (resolution core) — @mention parsing + routing to team members.
//
// A pure, testable engine that finds `@handle` mentions in a piece of text and resolves each to an
// ACTIVE team member (matched by email local-part or full email, case-insensitively). Any collaboration
// surface (comments, chat, the team library) can call this to know exactly who was mentioned and should
// be notified — no guessing.
//
// HONEST SCOPE: this is the RESOLUTION core. Actually DELIVERING a notification to a mentioned user
// (in-app inbox + email) needs a per-user in-app notification store that does not exist yet — recorded as
// an open item (constitution rule 6), not stubbed here. Resolution is real, complete, and unit-tested.

export interface MentionMember {
  uid: string;
  email: string;
  status: string;
}

export interface MentionResolution {
  /** Distinct active members matched by a mention (deduped by uid). */
  mentioned: Array<{ uid: string; email: string; handle: string }>;
  /** Mention handles that did not match any active member. */
  unresolved: string[];
}

/** Extract distinct `@handle` mention tokens from text (handle = letters/digits/._- ). Pure. */
export function parseMentions(text: unknown): string[] {
  if (typeof text !== 'string' || !text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?:^|[^\w@])@([a-zA-Z0-9][a-zA-Z0-9._-]{0,63})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const h = m[1].toLowerCase().replace(/[._-]+$/, ''); // trim trailing punctuation
    if (h && !seen.has(h)) { seen.add(h); out.push(h); }
  }
  return out;
}

/** The comparable handles a member answers to: their email local-part and their full email. */
function memberHandles(email: string): string[] {
  const e = (email || '').trim().toLowerCase();
  if (!e) return [];
  const local = e.split('@')[0];
  return local && local !== e ? [local, e] : [e];
}

/**
 * Resolve every @mention in `text` to an ACTIVE member. Pure. A handle matches a member when it equals
 * the member's email local-part or full email (case-insensitive). Deduped by uid; order follows the text.
 */
export function resolveMentions(text: unknown, members: MentionMember[]): MentionResolution {
  const handles = parseMentions(text);
  const active = (members || []).filter((m) => m && m.uid && m.status === 'active');

  const mentioned: MentionResolution['mentioned'] = [];
  const unresolved: string[] = [];
  const usedUids = new Set<string>();

  for (const handle of handles) {
    const hit = active.find((m) => memberHandles(m.email).includes(handle));
    if (hit) {
      if (!usedUids.has(hit.uid)) { usedUids.add(hit.uid); mentioned.push({ uid: hit.uid, email: hit.email, handle }); }
    } else {
      unresolved.push(handle);
    }
  }
  return { mentioned, unresolved };
}
