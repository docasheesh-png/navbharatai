// AgentV3 — A SECOND index.html IN public/ SHADOWS A VITE APP'S REAL ENTRY (autopsy 876afca9, 2026-09-30).
//
// 🔴 WHAT HAPPENED. "Create a calculation app": the fast lane's file plan listed `public/index.html —
// Static HTML file for Vite dev server serving` beside the real root `index.html`. Vite copies `public/`
// verbatim and serves it at the site root, so the dev server answered the app's module request with
// HTML and the browser refused it ("The script has an unsupported MIME type ('text/html')"). The first
// repair pass called it transient and changed nothing; a second, runtime-error pass found the file and
// deleted it — two repair passes and a stale preview copy for a file nobody needed.
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
