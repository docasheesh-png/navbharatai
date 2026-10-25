import { weakAdmissionCode, weakAdmissionReply, type WeakAdmission, type WeakScope } from './weakBuildAdmission';
import type { WeakScopeGuidanceCode } from '../../lib/weakScopeGuidance';

function scopeOf(admission: WeakAdmission | null | undefined): WeakScope | null {
  return admission == null ? null : admission.scope;
}

/** Terminal done+result for a plain-chat turn that may be Weak scope guidance. Keeps branches out of the chat handler (Q-979). */
export function weakScopeChatTerminal(input: {
  blocked: boolean;
  admission: WeakAdmission | null | undefined;
  reply: string;
  now: number;
}): {
  done: { type: 'done'; ok: boolean; summary: string; ts: number; code?: WeakScopeGuidanceCode };
  result: { type: 'result'; ok: boolean; summary: string; steps: number; billedUsd: number; billedInr: number; code?: WeakScopeGuidanceCode };
} {
  if (!input.blocked) {
    return {
      done: { type: 'done', ok: true, summary: input.reply, ts: input.now },
      result: { type: 'result', ok: true, summary: input.reply, steps: 0, billedUsd: 0, billedInr: 0 },
    };
  }
  const code = weakAdmissionCode(scopeOf(input.admission));
  return {
    done: { type: 'done', ok: false, summary: input.reply, ts: input.now, code },
    result: { type: 'result', ok: false, summary: input.reply, steps: 0, billedUsd: 0, billedInr: 0, code },
  };
}

/** Catch-path result when scope was already blocked — same codes, no Fix-with-AI framing. */
export function weakScopeCatchResult(admission: WeakAdmission | null | undefined): {
  type: 'result'; ok: false; summary: string; steps: 0; billedUsd: 0; billedInr: 0; code: WeakScopeGuidanceCode;
} {
  const scope = scopeOf(admission);
  return {
    type: 'result',
    ok: false,
    summary: weakAdmissionReply(scope),
    steps: 0,
    billedUsd: 0,
    billedInr: 0,
    code: weakAdmissionCode(scope),
  };
}
