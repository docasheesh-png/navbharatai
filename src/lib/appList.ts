// THE USER'S APPS, for the "which app are these keys for?" picker (admin 2026-08-17).
//
// The vault gained an app dimension so that a key saved for one app stops being written into every
// other app's `.env`. The picker that exposes that needs a list of the user's apps, and BOTH doors onto
// the vault need the same list — Settings → Secrets & API Keys and Pro v5's own Keys & Secrets sheet.
// One helper, so the two cannot disagree about what the user's apps are called.
//
// The source is the v5 conversation list, because that is what a NavBharatAI "app" actually is: a
// workspace with a title the user recognises. There is no separate app registry to read, and inventing
// one would be a second list to keep in step with this one.
//
// HONEST DEGRADATION: an account without v5 access gets a 404 here, and a network failure gets nothing.
// Both return an empty list rather than throwing, and an empty list simply hides the picker — a screen
// that cannot name the user's apps must not block them from saving a key.

import { authHeaders } from './authedFetch';

/** One app the user can scope a key to. */
export interface AppChoice {
  /** The workspace id stored on the key. */
  id: string;
  /** What the user calls this app. */
  title: string;
}

/** Bounded so a long history cannot turn a settings screen into a thousand-row dropdown. */
export const MAX_APP_CHOICES = 30;

/**
 * De-duplicate by workspace, keep the first (most recent) title, drop untitled/idless rows.
 *
 * One workspace can appear more than once in a conversation list, and a picker that lists the same app
 * three times is a picker the user stops trusting. PURE, so the shaping is tested without the network.
 */
export function toAppChoices(
  rows: ReadonlyArray<{ workspaceId?: string | null; title?: string | null }> | null | undefined,
): AppChoice[] {
  const out: AppChoice[] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = String(r?.workspaceId ?? '').trim();
    if (!id || seen.has(id)) continue;
    const title = String(r?.title ?? '').trim();
    // An untitled workspace is real but unnameable — showing it as a blank row would be worse than
    // leaving it out, because the user cannot tell which app they would be choosing.
    if (!title) continue;
    seen.add(id);
    out.push({ id, title });
    if (out.length >= MAX_APP_CHOICES) break;
  }
  return out;
}

/**
 * The signed-in user's apps, newest first. Never throws — an empty list hides the picker.
 */
export async function listApps(): Promise<AppChoice[]> {
  try {
    const res = await fetch('/api/agentv3/conversations', { headers: await authHeaders() });
    if (!res.ok) return []; // 404 for an account without v5 access — not an error worth surfacing here
    const body = await res.json();
    return toAppChoices(body?.conversations);
  } catch {
    return [];
  }
}
