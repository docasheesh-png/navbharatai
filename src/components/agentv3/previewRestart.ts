// "Restart the server" in the preview toolbar — the offer rule and what it SAYS. Pure.
//
// WHY IT EXISTS (ROADMAP §8B B3). The dev-server reboot has always existed, but only inside the
// "No live preview yet" empty state. A user whose preview URL still resolves while the server behind
// it has died — a blank page, a connection refused, an app stuck mid-boot — could not reach it, and
// the honest answer was "rebuild the whole app". The operation is unchanged (the same model-free
// hydrate → install → pre-kill → boot → verify); only its reachability is.
//
// The wording is here rather than inline because a restart takes 30–90 seconds and can FAIL, and the
// one thing that must never happen is a failed restart reading as a fixed one — the user would go on
// staring at the same broken preview believing it was repaired.

export interface RestartOffer {
  mode: string;
  /** The URL actually being shown, if any. */
  url: string;
  workspaceId: string;
}

/**
 * Offer the restart only where it can do something and where the user can tell it is needed: the
 * LIVE preview, showing a URL, for a real workspace. In the in-browser preview there is no server to
 * restart, and with no URL the empty state already offers it.
 */
export function canOfferRestart(o: RestartOffer): boolean {
  return o.mode === 'live' && !!o.url && !!o.workspaceId;
}

export interface RestartStatus {
  diagnosing: boolean;
  stage: { label: string; seconds: number } | null;
  result: { ok: boolean; reason: string } | null;
  /**
   * WHICH BUTTON the user pressed. The operation behind both is identical, but the words are not:
   * someone who pressed "Wake up" on a sleeping preview and then reads "Restarting the server" has to
   * work out for themselves that it is the same thing. Defaults to `restart`, which is what the
   * toolbar button says, so every existing caller keeps today's wording.
   */
  intent?: 'restart' | 'wake';
}

export interface RestartLine {
  kind: 'none' | 'progress' | 'ok' | 'failed';
  text: string;
  /** Seconds elapsed, shown only while running. */
  seconds: number;
}

/**
 * What the strip under the toolbar says.
 *
 * 🔒 THE HONESTY RULE, and the reason this is a function: a restart that did NOT work reports the
 * server's own reason, never a success line. `ok` comes from a boot that actually verified the port,
 * so it is the only thing allowed to produce the reassuring sentence. A result with `ok: false` and
 * an empty reason still reports FAILURE — silence is not evidence of success.
 */
export function restartStatusLine(s: RestartStatus): RestartLine {
  if (s.diagnosing) {
    const label = s.stage?.label?.trim();
    return {
      kind: 'progress',
      // Named as a RESTART, not a "diagnosis": the user pressed a button that says restart, and a
      // status line using a different word for the same action reads as something else happening.
      text: s.intent === 'wake'
        ? (label ? `Waking your preview — ${label}…` : 'Waking your preview…')
        : (label ? `Restarting the server — ${label}…` : 'Restarting the server…'),
      seconds: s.stage?.seconds ?? 0,
    };
  }
  if (!s.result) return { kind: 'none', text: '', seconds: 0 };
  if (s.result.ok) {
    return {
      kind: 'ok',
      text: s.intent === 'wake' ? 'Your preview is awake and your app is responding.' : 'The server restarted and your app is responding.',
      seconds: 0,
    };
  }
  return {
    kind: 'failed',
    text: s.result.reason?.trim()
      || 'The server did not come back up, and no reason was returned. Your files are safe — try again, or start a new build.',
    seconds: 0,
  };
}
