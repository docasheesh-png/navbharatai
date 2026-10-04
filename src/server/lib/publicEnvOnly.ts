// A PHONE APP'S REPOSITORY CARRIES ONLY THE ENV VALUES THE APP PUBLISHES ANYWAY (security checklist,
// 2026-10-04).
//
// The phone build pushes the app's workspace files to the user's own GitHub repository, and a `.env`
// was pushed whole — including server-only secrets the model had written there (a database password, a
// payment secret key). In a static app it was worse: the file landed at `www/.env` and was packaged
// INTO the APK, readable on every phone that installed it.
//
// A phone app is the front end only. The values its bundler bakes in are the client-public ones
// (`VITE_…`, `NEXT_PUBLIC_…`, …) — they end up inside the shipped app whatever we do, so keeping them
// in the repository changes nothing. Every other line is a server value the phone build never reads,
// so it is left out. A static app has no bundler at all: its `.env` is read by nothing and is dropped.
//
// PURE.

import { isLiveEnvFilePath } from '../../lib/envFile';

/** Prefixes whose values a front-end bundler publishes inside the built app. */
const CLIENT_PUBLIC_PREFIX = /^(?:VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|GATSBY_|PUBLIC_)/;

/** A live dotenv file at any depth (`.env`, `apps/web/.env.production`), never a committed template. */
export function isLiveEnvFile(path: string): boolean {
  return isLiveEnvFilePath(path);
}

export interface PublicEnvResult {
  /** The file with only client-public assignments (and comments/blank lines) kept. */
  content: string;
  /** Names of the assignments that were removed — names only, never values. */
  removed: string[];
}

/** Keep the client-public assignments of a dotenv file; drop every other assignment. */
export function publicEnvOnly(content: string): PublicEnvResult {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of String(content ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/.exec(line);
    if (!m) { kept.push(line); continue; }           // comment, blank or unparseable: carries no value
    if (CLIENT_PUBLIC_PREFIX.test(m[1])) kept.push(line);
    else removed.push(m[1]);
  }
  return { content: kept.join('\n'), removed };
}

/** True when nothing but comments and blank lines is left. */
export function hasNoAssignments(content: string): boolean {
  return !String(content ?? '').split(/\r?\n/).some((l) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/.test(l));
}
