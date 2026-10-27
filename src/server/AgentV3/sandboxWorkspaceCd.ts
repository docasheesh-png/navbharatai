// AgentV3 — rewrite a model `cd /workspace` to the real sandbox root.
//
// 🔴 AUTOPSY 7c3115a8 ("Make a game", 2026-10-20). During preview repair the model ran
//   $ cd /workspace && grep -r "from.*meta" src/game …
// and the shell answered `/bin/bash: line 1: cd: /workspace: No such file or directory`.
// Every sandbox command already starts with cwd = `/home/user/workspace` (see
// SANDBOX_WORKSPACE_ROOT). The model invented `/workspace` from common Docker layouts; that
// path does not exist here, so a repair that only needed a grep burned a turn and left the
// missing-export console error unaddressed.
//
// 🔑 THE CLASS: a wrong absolute project root the model types into `cd`, when the platform
// already knows the only correct one. Same shape as `fixNodeModulesTypo` — correct before
// the shell, tell the agent, never invent a different directory.
//
// Precision-first: only a `cd` whose target is exactly `/workspace` (optional trailing slash,
// optional quotes). `/workspace/src/…`, URLs, and other roots are left alone.
// Kill switch: AGENTV3_SANDBOX_CD_REWRITE=off.

import { SANDBOX_WORKSPACE_ROOT } from '../lib/workspacePath';

const CD_WORKSPACE = /\bcd(\s+)(["']?)\/workspace\/?\2(?=\s|$|;|&&|\|\||\n)/gi;

export function sandboxCdRewriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SANDBOX_CD_REWRITE ?? '').trim().toLowerCase() !== 'off';
}

/** Rewrite `cd /workspace` → `cd <SANDBOX_WORKSPACE_ROOT>`. PURE. */
export function fixSandboxWorkspaceCd(command: string, env: NodeJS.ProcessEnv = process.env): { command: string; fixed: boolean } {
  const raw = String(command ?? '');
  if (!sandboxCdRewriteEnabled(env) || !raw) return { command: raw, fixed: false };
  const out = raw.replace(CD_WORKSPACE, (_m, ws: string, q: string) => `cd${ws}${q}${SANDBOX_WORKSPACE_ROOT}${q}`);
  return { command: out, fixed: out !== raw };
}
