// Attachment size guard (Fix 36a — "zip upload band ho gayi", 2026-07-07). A large zip base64-inflates
// ×1.33 inside the JSON build request; past the platform's request-body limit (Cloud Run: 32 MB) the
// request DIES BEFORE the server ever sees it — the client just saw the stall banner ("build stopped
// responding") with no honest reason, which read as "zip upload is broken". These limits keep the
// encoded request safely under the platform cap, and the guard REFUSES oversized sends with a clear,
// actionable message instead of a silent death.

/** Shared client/server ceiling: 15 MB raw, within both parser and request limits. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** Max combined raw bytes across all attachments in one message. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 22 * 1024 * 1024;

export interface AttachmentSizeVerdict {
  ok: boolean;
  /** Honest, actionable reason when ok=false. */
  reason?: string;
}

/** Check attachment sizes BEFORE encoding/sending. Pure. */
export function checkAttachmentSizes(files: ReadonlyArray<{ name: string; size: number }>): AttachmentSizeVerdict {
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  for (const f of files) {
    if (f.size > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        reason: `"${f.name}" is ${mb(f.size)} MB — larger than the ${mb(MAX_ATTACHMENT_BYTES)} MB upload limit, so the request cannot reach the server. Shrink the zip (remove node_modules/dist/build folders) or import the project from a GitHub URL instead (⚙️ → Import Repo).`,
      };
    }
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: `The attached files total ${mb(total)} MB — over the ${mb(MAX_TOTAL_ATTACHMENT_BYTES)} MB combined upload limit. Send them one at a time, shrink the zips (remove node_modules/dist), or import from a GitHub URL (⚙️ → Import Repo).`,
    };
  }
  return { ok: true };
}

/** Stage new attachments without silently dropping files or exceeding the send-time caps. */
export function stageAttachmentFiles<T extends { name: string; size: number }>(
  current: readonly T[],
  incoming: readonly T[],
  maxFiles = 8,
): { accepted: T[]; rejected: Array<{ file: T; reason: string }> } {
  const accepted: T[] = [];
  const rejected: Array<{ file: T; reason: string }> = [];
  for (const file of incoming) {
    if (current.length + accepted.length >= maxFiles) {
      rejected.push({ file, reason: `"${file.name}" was not attached: at most ${maxFiles} files can be sent at once. Remove a file or send these separately.` });
      continue;
    }
    const verdict = checkAttachmentSizes([...current, ...accepted, file]);
    if (!verdict.ok) {
      rejected.push({ file, reason: verdict.reason || `"${file.name}" could not be attached.` });
      continue;
    }
    accepted.push(file);
  }
  return { accepted, rejected };
}

