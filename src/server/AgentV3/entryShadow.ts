// AgentV3 — A SECOND index.html IN public/ SHADOWS A VITE APP'S REAL ENTRY (autopsy 876afca9, 2026-09-30).
//
// 🔴 WHAT HAPPENED. "Create a calculation app": the fast lane's file plan listed `public/index.html —
// Static HTML file for Vite dev server serving` beside the real root `index.html`. The browser then reported
// "The script has an unsupported MIME type ('text/html')". The first repair pass reloaded `/`, saw it clean,
// called the error transient and changed nothing; a second, runtime-error pass found the file and deleted
// it — two repair passes and a stale preview copy for a file nobody needed.
//
// 📏 MEASURED (Vite 8, 2026-09-30), so nobody has to re-derive it: the dev server serves the ROOT
// index.html for `/` and for unknown paths, but `/index.html` itself returns the public/ copy AS-IS —
// untransformed, without Vite's client. So the defect depends on which URL was opened, which is exactly why
// a reload of `/` looked clean. The production build is NOT affected: `dist/index.html` is the built root
// entry. The honest cost is a dev path that serves the wrong page, and a repair pass that cannot see why.
//
// 🔑 THE CLASS. In a Vite project the entry is the ROOT `index.html`; `public/` is for static assets only.
// Create React App is the opposite (its template IS `public/index.html`), which is why this is keyed on
// the framework and never applied to CRA. Two doors, one rule: the fast lane drops the file from its plan,
// and the full builder is told at write time while the file is still open.
//
// PURE. `AGENTV3_ENTRY_SHADOW=off` turns both halves off with no deploy.

/** Kill switch — `off` lets the plan keep `public/index.html` and silences the write note. Default ON. */
export function entryShadowGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_ENTRY_SHADOW ?? '').trim().toLowerCase() !== 'off';
}

/** Is this framework one whose entry is the ROOT index.html (Vite and the stacks built on it)? */
export function entryIsRootIndexHtml(framework: string | undefined): boolean {
  const fw = String(framework ?? '').toLowerCase();
  if (!fw || /\bcra\b|create-react-app|react-scripts/.test(fw)) return false;
  return /vite|svelte|solid|preact|vanilla-ts|vue/.test(fw);
}

/** Would this path shadow the real entry of a root-index framework? */
export function isShadowingEntryPath(path: string, framework: string | undefined): boolean {
  if (!entryIsRootIndexHtml(framework)) return false;
  return /^\.?\/?public\/index\.html?$/i.test(String(path ?? '').trim());
}

/** Drop shadowing entries from a file plan. Returns what was kept and what was dropped. */
export function dropShadowingEntries<T extends { path: string }>(planned: readonly T[], framework: string | undefined): { kept: T[]; dropped: string[] } {
  if (!entryShadowGuardEnabled()) return { kept: [...planned], dropped: [] };
  const dropped = planned.filter((f) => isShadowingEntryPath(f.path, framework)).map((f) => f.path);
  if (dropped.length === 0) return { kept: [...planned], dropped };
  return { kept: planned.filter((f) => !isShadowingEntryPath(f.path, framework)), dropped };
}

/** The note the full builder is handed when it writes such a file. '' when the path is fine. */
export function entryShadowNote(path: string, framework: string | undefined): string {
  if (!entryShadowGuardEnabled() || !isShadowingEntryPath(path, framework)) return '';
  return `\n\n⚠️ ${path}: in this project the page entry is the ROOT index.html. Vite serves public/ as-is at the site root, so this copy shadows the real entry and the app's scripts come back as text/html ("unsupported MIME type"). Delete ${path} and put any change in the root index.html instead.`;
}

/**
 * The shadowing entries in a project, read from its FILE LIST alone (no framework string needed, so a
 * repair pass can ask it of any workspace). A root `index.html` plus a Vite config is a root-entry
 * project; CRA has no root `index.html`, so it can never match. PURE.
 */
export function shadowingEntriesInProject(paths: readonly string[]): string[] {
  const norm = paths.map((p) => String(p ?? '').replace(/^\.?\//, ''));
  const set = new Set(norm);
  if (!set.has('index.html')) return [];
  if (!norm.some((p) => /^vite\.config\.(?:js|ts|mjs|mts|cjs|cts)$/.test(p))) return [];
  return norm.filter((p) => /^public\/index\.html?$/i.test(p));
}

/**
 * The diagnosis handed to a repair pass (the preview verify loop and the runtime auto-fix) when the
 * project carries a shadowing entry — '' otherwise. The first repair in autopsy 876afca9 could not see
 * the cause and called it transient; the platform already knew it. PURE.
 */
export function entryShadowRepairHint(paths: readonly string[]): string {
  if (!entryShadowGuardEnabled()) return '';
  const found = shadowingEntriesInProject(paths);
  if (found.length === 0) return '';
  return `KNOWN CAUSE, found by the platform before this repair: ${found.join(', ')} shadows the app's real entry (the ROOT index.html). The dev server returns it as-is for /index.html, so the error depends on which URL was opened and a reload of "/" can look clean — that does NOT make it transient. Delete ${found.join(', ')} (move anything it needs into the root index.html), then reload and re-check.\n\n---\n\n`;
}
