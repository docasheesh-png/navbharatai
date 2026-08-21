// The terminal panel's TAB RULES, as pure functions.
//
// WHY THEY LIVE OUTSIDE THE COMPONENT: v5.0's Terminal now opens on a pinned, read-only build log and
// only creates a shell when the user asks (admin 2026-08-21). That "only when asked" is a MONEY rule —
// every shell holds a real VM and spends the user's daily allowance — so it must be a test, not an
// intention buried in a click handler. The repo renders components to static markup in tests, which
// cannot exercise a click; extracting the decisions is how they become checkable at all.

/** One user-opened terminal. The pinned tab is deliberately NOT one of these. */
export interface TerminalSession { id: string; label: string }

/** The pinned tab's id. Never a shell id — nothing ever opens a PTY for it. */
export const PINNED_ID = '__pinned__';

/**
 * How many shells to open on mount.
 *
 * ZERO when a pinned tab exists: the user came to read the build log, and opening a shell they did
 * not ask for would start spending their 30 free minutes on their behalf. One otherwise (Code
 * Studio's terminal IS the surface — an empty panel there would be a dead screen).
 */
export function initialShellCount(hasPinnedTab: boolean): number {
  return hasPinnedTab ? 0 : 1;
}

/** Which tab holds focus on mount: the pinned log when there is one, else the first shell. */
export function initialActiveId(hasPinnedTab: boolean, firstShellId: string): string {
  return hasPinnedTab ? PINNED_ID : firstShellId;
}

/** The pinned tab is NavBharatAI's own record — the user closes their shells, not our log. */
export function isClosableTab(id: string): boolean {
  return id !== PINNED_ID;
}

export interface AfterCloseResult {
  /** The sessions that remain. */
  next: TerminalSession[];
  /** Which tab should now hold focus, or '' when the panel is going away. */
  nextActiveId: string;
  /** True only when there is genuinely nothing left to show. */
  closePanel: boolean;
}

/**
 * What happens when a shell is closed.
 *
 * The case worth pinning: closing the LAST shell must NOT close the surface when a pinned tab exists.
 * In v5.0 the Terminal is a tab the user opened deliberately; yanking them out of it because they
 * finished with a shell would be the surface deciding to leave on their behalf. Code Studio, whose
 * panel IS the terminal, still closes — there really is nothing behind it. PURE.
 */
export function afterCloseTab(
  sessions: readonly TerminalSession[],
  closingId: string,
  activeId: string,
  hasPinnedTab: boolean,
): AfterCloseResult {
  const next = sessions.filter((s) => s.id !== closingId);
  if (next.length === 0) {
    if (hasPinnedTab) return { next, nextActiveId: PINNED_ID, closePanel: false };
    return { next: [...sessions], nextActiveId: activeId, closePanel: true };
  }
  const nextActiveId = closingId === activeId ? next[next.length - 1].id : activeId;
  return { next, nextActiveId, closePanel: false };
}
