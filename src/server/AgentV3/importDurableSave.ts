// AN IMPORT'S DURABLE SAVE RUNS BESIDE THE TURN, NOT IN FRONT OF IT (build d62bf22d, 2026-10-17).
//
// 🔴 WHAT HAPPENED. A 175-file GitHub import (Mitrify) was landed in the sandbox in seconds, then the turn
// WAITED for the durable copy: four `DEADLINE_EXCEEDED` after 60 s each, 1 of 175 files confirmed, and ~89 s
// of the turn's 97 s TIME_TO_FIRST_CALL spent there. The user's project was already in the workspace and
// working; the model could have started answering a minute and a half earlier.
//
// 🔑 THE RULE. The save is started when the import lands and the turn goes on; the route waits for it once,
// bounded, before the report is written (`settleImportDurableSave`), so the report says what really
// happened — saved, partial (named), failed, or still saving when the turn ended. The honest user message
// for a save that did not complete (autopsy d0b2fcd6, Q-735) is unchanged, only emitted when it is known.
// The merge itself retries what it could not confirm in smaller batches (WorkspaceFileStore.mergeIntoStore).

import type { MergeResult } from './WorkspaceFileStore';

export interface ImportDurableRecord {
  phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; detail?: string; autoResolved: boolean;
}

export interface ImportDurableSaveOptions {
  save: () => Promise<MergeResult>;
  /** How many files the import handed to the store. */
  total: number;
  record?: (r: ImportDurableRecord) => void;
  narrate: (text: string) => void;
  now?: () => number;
}

/** The user's sentence for a save that did not complete. Kept word for word from the foreground version. */
export function importNotDurableNarration(unconfirmed: number, total: number): string {
  return `⚠️ Your project is here and working in this session, but ${unconfirmed} of its ${total} files could not be saved permanently yet. Keep this chat open; if it restarts, import the project again.`;
}

/** Start the save; resolves (never rejects) with what the store did, after recording and narrating it. */
export function startImportDurableSave(o: ImportDurableSaveOptions): Promise<MergeResult> {
  const now = o.now ?? Date.now;
  const t0 = now();
  return (async () => {
    const durable: MergeResult = await o.save().catch((e) => ({ status: 'failed' as const, indexed: 0, unconfirmed: [] as string[], error: String(e) }));
    const secs = Math.round((now() - t0) / 1000);
    try {
      if (durable.status === 'failed' || durable.status === 'partial') {
        // A save that threw before it could name anything left EVERY file unconfirmed.
        const unconfirmed = durable.status === 'failed' && durable.unconfirmed.length === 0 ? o.total : durable.unconfirmed.length;
        o.record?.({
          phase: 'build', severity: 'warning', code: 'IMPORT_NOT_DURABLE', autoResolved: false,
          message: `The imported project is in the workspace, but the durable copy holds ${durable.indexed} of ${o.total} file(s) — ${unconfirmed} could not be confirmed saved (background save, ${secs}s, retried in smaller batches).`,
          detail: `${durable.status}${durable.error ? ` · ${durable.error}` : ''} · unconfirmed: ${durable.unconfirmed.slice(0, 20).join(', ')}`,
        });
        o.narrate(importNotDurableNarration(unconfirmed, o.total));
      } else if (durable.status === 'saved') {
        o.record?.({
          phase: 'build', severity: 'info', code: 'IMPORT_DURABLE_SAVED', autoResolved: true,
          message: `The imported project's durable copy holds all ${durable.indexed} file(s) — saved in the background in ${secs}s, while the turn went on.`,
        });
      }
    } catch { /* reporting is best-effort; the result is still returned */ }
    return durable;
  })();
}

/**
 * Wait for every import save this turn started, at most `budgetMs`, so the report carries the outcome. A save
 * still running is SAID to be running — never reported as saved, never as failed. Never throws.
 */
export async function settleImportDurableSave(
  saves: ReadonlyArray<Promise<unknown>>,
  budgetMs: number,
  record?: (r: ImportDurableRecord) => void,
): Promise<'none' | 'settled' | 'pending'> {
  if (!saves || saves.length === 0) return 'none';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    Promise.allSettled(saves).then(() => 'settled' as const),
    new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), Math.max(0, budgetMs)); }),
  ]);
  if (timer) clearTimeout(timer);
  if (outcome === 'pending') {
    try {
      record?.({
        phase: 'build', severity: 'warning', code: 'IMPORT_DURABLE_PENDING', autoResolved: false,
        message: `The imported project's durable save was still running when this turn ended (waited ${Math.round(budgetMs / 1000)}s) — its outcome is not in this report. The project is in the live workspace.`,
      });
    } catch { /* best-effort */ }
  }
  return outcome;
}

/** How long the end of a turn waits for an import's background save before saying it is still running. */
export const IMPORT_DURABLE_SETTLE_MS = 90_000;
