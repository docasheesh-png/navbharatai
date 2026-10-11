// THE ONE VERTEX CLIENT (Q-769, admin 2026-10-11: move the Vertex rungs onto `@google/genai` with `vertexai: true`).
//
// Three places called Vertex, each through `@google-cloud/vertexai`: the router's Vertex rung, the vision chain and
// Doctor AI's multimodal fallback. That SDK's own README says it was "deprecated as of June 24, 2025 and will be
// removed on June 24, 2026" — so every Vertex call here rested on an SDK past its end of life. They now share this
// one client of the SDK the rest of the platform already uses for Gemini.
//
// 🔒 AUTH IS UNCHANGED, ON PURPOSE. An explicit `project` + `location` makes `@google/genai` use the service
// account (Application Default Credentials), exactly as the old SDK did — and it then ignores a `GEMINI_API_KEY`
// or `GOOGLE_API_KEY` in the environment (checked in the SDK's constructor), so a key set for the Gemini rung can
// never silently turn this rung into a second Gemini-API rung. Same env names, same default region.
//
// ⚠️ WHAT AN ABORT DOES HERE, SAID EXACTLY (the reason Q-769 was opened turned out to be half wrong). This SDK
// takes `config.abortSignal`, and it closes the connection at once — the turn ends and no more is read. But its
// own documentation says: "AbortSignal is a client-only operation. Using it to cancel an operation will not cancel
// the request in the service. You will still be charged usage for any applicable operations." So on Google, an
// abandoned request may still be billed by Google for what it generated. That is Google's limit, not ours, and no
// client can change it.
import { GoogleGenAI } from '@google/genai';

/** The Google Cloud project Vertex runs in, or null when none is configured. */
export function vertexProjectId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = (env.GOOGLE_CLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT_ID || '').trim();
  return id || null;
}

/** The region — the same variable and default the old SDK's callers read. */
export function vertexLocation(env: NodeJS.ProcessEnv = process.env): string {
  return (env.GOOGLE_CLOUD_REGION || '').trim() || 'us-central1';
}

/** The options the client is built with. PURE — tested, so the auth path cannot drift. */
export function vertexClientOptions(env: NodeJS.ProcessEnv = process.env): { vertexai: true; project: string; location: string } | null {
  const project = vertexProjectId(env);
  return project ? { vertexai: true, project, location: vertexLocation(env) } : null;
}

let cached: { key: string; client: GoogleGenAI } | null = null;

/** The shared Vertex client, or null when no project is configured. Re-made if the project or region changes. */
export function vertexGenAI(env: NodeJS.ProcessEnv = process.env): GoogleGenAI | null {
  const opts = vertexClientOptions(env);
  if (!opts) return null;
  const key = `${opts.project}|${opts.location}`;
  if (!cached || cached.key !== key) cached = { key, client: new GoogleGenAI(opts) };
  return cached.client;
}

/** TEST ONLY. */
export function _resetVertexClient(): void {
  cached = null;
}
