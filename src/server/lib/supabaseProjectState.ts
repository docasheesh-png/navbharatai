// Is the user's Supabase database AWAKE? — and waking it when they ask (admin 2026-10-06).
//
// 🔴 THE GAP THIS CLOSES. Supabase pauses a FREE project after about a week without use. Every one-click
// database NavBharatAI creates is a free project in the user's own account, so the most common app we
// help build — a small site that gets a few visitors a month — is exactly the app whose database goes to
// sleep. When it does, the live site cannot load or save anything, and nothing in NavBharatAI noticed:
// no code read a project's status after the day it was created. `waitUntilReady` polled for
// ACTIVE_HEALTHY once, at creation; Database Studio showed Supabase's raw error; a build reused a paused
// database as if it were fine; and the owner learnt about it from a visitor, if at all.
//
// So this module answers one question everywhere it matters — "what state is this project in?" — and
// offers the one fix, Supabase's own restore call, which costs the user nothing on the free plan.
//
// 🔒 WAKING IS ALWAYS THE USER'S DECISION, NEVER AUTOMATIC. Waking a database every time Supabase pauses
// it would be a keep-alive in all but name: it defeats the pause Supabase applies on purpose, and the
// cost of Supabase deciding our OAuth app abuses the free plan would land on EVERY user's one-click
// database at once. We detect, we tell the owner, and one tap from them wakes it.
//
// `fetch` is injected, so every branch is unit-tested without a network.

import {
  SUPABASE_API, classifyStatus, supabaseReason, classifyProjectStatus, type ProvisionError, type ProjectState,
} from './supabaseProvision';

export { classifyProjectStatus, type ProjectState };

type Fetch = typeof globalThis.fetch;

/** The states in which an app that uses this database cannot work right now and the owner should hear it. */
export function stateNeedsOwner(state: ProjectState): boolean {
  return state === 'paused' || state === 'failed' || state === 'removed';
}

/** Only a paused project can be woken; asking Supabase to restore anything else is a request that cannot help. */
export function canWake(state: ProjectState): boolean {
  return state === 'paused';
}

/** One sentence for the owner about a database in this state. Empty for a healthy one. */
export function projectStateMessage(state: ProjectState, name?: string | null): string {
  const db = name && name.trim() ? `Your database "${name.trim()}"` : 'Your database';
  switch (state) {
    case 'paused':
      return `${db} is asleep. Supabase pauses a free project after about a week without use, so an app that uses it cannot load or save data right now. `
        + 'Your data is kept while it sleeps — wake it from Settings → App Settings → Database; it takes a few minutes.';
    case 'waking':
      return `${db} is waking up. This usually takes a few minutes — your app will load its data again once it is ready.`;
    case 'busy':
      return `${db} is being changed by Supabase right now (for example being paused or resized). Check again in a few minutes.`;
    case 'unhealthy':
      return `${db} is running, but Supabase reports it as unhealthy. If your app cannot load data, open the project in your Supabase dashboard.`;
    case 'failed':
      return `Supabase reports a problem with ${db.replace(/^Your/, 'your')} that NavBharatAI cannot fix from here. Open the project in your Supabase dashboard to see what happened.`;
    case 'removed':
      return `${db} no longer exists in your Supabase account, so an app that uses it cannot load or save data. Create or connect a database in Settings → App Settings → Database.`;
    default:
      return '';
  }
}

export interface ProjectStateResult {
  ok: true;
  state: ProjectState;
  /** Supabase's own status word, for the admin report. */
  status: string;
  /** The project's name as the user sees it in their Supabase dashboard. */
  name: string;
}

/** Read a project's current state. A project this grant cannot see is a failure, never a state. */
export async function getProjectState(
  token: string,
  projectRef: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<ProjectStateResult | ProvisionError> {
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${encodeURIComponent(projectRef)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'We could not reach Supabase to check your database. Please try again.' };
  }
  if (!res.ok) return classifyStatus(res.status, await res.text().catch(() => ''), 'read');
  const body = (await res.json().catch(() => null)) as { status?: unknown; name?: unknown } | null;
  const status = typeof body?.status === 'string' ? body.status : '';
  return { ok: true, state: classifyProjectStatus(status), status, name: typeof body?.name === 'string' ? body.name : '' };
}

/**
 * Ask Supabase to wake a paused project. Success means Supabase ACCEPTED the request — the project is
 * then `waking`, not ready, and the caller must say so rather than "your database is back".
 */
export async function restoreProject(
  token: string,
  projectRef: string,
  fetchImpl: Fetch = globalThis.fetch,
): Promise<{ ok: true } | ProvisionError> {
  let res: Response;
  try {
    res = await fetchImpl(`${SUPABASE_API}/v1/projects/${encodeURIComponent(projectRef)}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return { ok: false, failure: 'api-error', detail: String(e),
      message: 'We could not reach Supabase to wake your database. Please try again.' };
  }
  if (res.ok) return { ok: true };
  const body = await res.text().catch(() => '');
  // A refusal to wake is most often the free plan's limit on projects AWAKE at once — a user-fixable
  // situation in their own account, so it is named as that, with Supabase's own words beside it in
  // case the real reason is something else.
  if (res.status === 402 || (res.status === 400 && /limit|plan|quota/i.test(body))) {
    const reason = supabaseReason(body);
    return { ok: false, failure: 'plan-limit', detail: body.slice(0, 500) || undefined,
      message: 'Supabase would not wake this database — the free plan allows only 2 active projects at once. '
        + 'Pause or delete a project you are not using in Supabase, then try again.'
        + (reason ? ` (Supabase said: ${reason})` : '') };
  }
  return classifyStatus(res.status, body, 'read');
}
