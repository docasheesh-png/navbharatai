import { History, X } from 'lucide-react';
import { VersionTimeline } from '../versions/VersionTimeline';
import {
  VERSION_UNDO_NO_WORKSPACE,
  VERSION_UNDO_PICKER_INTRO,
  VERSION_UNDO_PICKER_INTRO_EN,
} from '../../lib/versionUndoIntent';

/**
 * In-Pro version picker after undo / pehle wala / reverse intent.
 *
 * Reuses `VersionTimeline` (same restore points + same `/api/agentv3/restore-version` as History /
 * Time Machine). Nothing restores until the user taps Restore on a chosen version.
 */
export function VersionUndoCard(props: {
  historyKey: string;
  workspaceId?: string | null;
  userId?: string | null;
  email?: string | null;
  onRestored: (files: Record<string, string>, message: string) => void;
  onDismiss: () => void;
  refreshKey?: unknown;
}) {
  const { historyKey, workspaceId, userId, email, onRestored, onDismiss, refreshKey } = props;
  const hasApp = !!(workspaceId && historyKey);

  return (
    <div
      className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] overflow-hidden"
      data-testid="version-undo-card"
      role="region"
      aria-label="Choose a version to restore"
    >
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-1.5">
        <History className="w-4 h-4 text-success shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-body font-medium leading-snug">{VERSION_UNDO_PICKER_INTRO}</p>
          <p className="text-[11px] text-muted mt-0.5 leading-snug">{VERSION_UNDO_PICKER_INTRO_EN}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-lg text-faint hover:text-body hover:bg-raised"
          aria-label="Dismiss version picker"
          title="Cancel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {!hasApp ? (
        <p className="px-3 pb-3 text-xs text-muted leading-relaxed">{VERSION_UNDO_NO_WORKSPACE}</p>
      ) : (
        <div className="max-h-[min(420px,55vh)] overflow-y-auto border-t border-emerald-500/20">
          <VersionTimeline
            historyKey={historyKey}
            workspaceId={workspaceId || undefined}
            userId={userId}
            email={email}
            dense
            oneTapRestore
            refreshKey={refreshKey}
            onRestored={(files) => {
              onRestored(files, 'App us version par wapas aa gayi ✓ Preview refresh ho raha hai. Pehle wala app pehle save ho chuka hai — zarurat ho to wapas aage ja sakte ho.');
            }}
          />
        </div>
      )}
    </div>
  );
}
