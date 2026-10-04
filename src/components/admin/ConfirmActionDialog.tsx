// THE CONFIRMATION EVERY HIGH-IMPACT ADMIN ACTION PASSES THROUGH (admin panel audit, PR 1, 2026-10-04).
//
// Ban, token adjustment and "message every user" used to fire on a single press — the ban with a
// hard-coded reason, the broadcast with no preview. This dialog says what will happen, shows what will be
// sent, and keeps Confirm disabled until a required reason meets the SAME rule the server enforces
// (`readAdminReason`). The server still refuses on its own; this screen is not the security boundary.

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { readAdminReason, ADMIN_REASON_MAX, type ConfirmCopy } from '../../lib/adminActionReason';

export interface ConfirmActionDialogProps {
  copy: ConfirmCopy;
  /** What will be changed or sent — the preview. */
  children?: React.ReactNode;
  busy?: boolean;
  onCancel: () => void;
  /** Called with the trimmed reason ('' when the reason is optional and left empty). */
  onConfirm: (reason: string) => void;
}

export function ConfirmActionDialog({ copy, children, busy, onCancel, onConfirm }: ConfirmActionDialogProps): React.ReactElement {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { boxRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const read = readAdminReason(reason);
  const typed = reason.trim().length > 0;
  // An optional reason, once typed, must still be a real one — the server applies the same rule.
  const reasonOk = copy.reasonRequired ? read.ok : (!typed || read.ok);
  const canConfirm = reasonOk && !busy;
  const error = 'error' in read && (touched || typed) && (copy.reasonRequired || typed) ? read.error : null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-scrim p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title">
      <div className="w-full max-w-md bg-card border border-line rounded-2xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          {copy.danger && <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />}
          <h2 id="confirm-action-title" className="text-base font-black text-ink flex-1">{copy.title}</h2>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel" className="text-muted hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-body">{copy.consequence}</p>
        {children}
        <div className="space-y-1">
          <label htmlFor="confirm-action-reason" className="text-[11px] font-bold text-muted">
            {copy.reasonRequired ? 'Reason (required)' : 'Reason (optional)'}
          </label>
          <textarea
            id="confirm-action-reason"
            ref={boxRef}
            value={reason}
            maxLength={ADMIN_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={2}
            className="w-full bg-well border border-line rounded-xl px-3 py-2 text-sm text-ink outline-none focus:border-indigo-500/60"
          />
          {error && <p className="text-[11px] text-danger font-bold">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-xl bg-raised text-sm font-bold text-ink">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm('reason' in read ? read.reason : '')}
            className={`px-4 py-2 rounded-xl text-sm font-black text-on-accent disabled:opacity-40 ${copy.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {busy ? 'Working…' : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmActionDialog;
