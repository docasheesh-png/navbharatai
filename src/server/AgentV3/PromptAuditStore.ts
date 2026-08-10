// AgentV3 — Prompt Audit Trail (P-PE.6).
//
// Cost telemetry records tokens/cost per build, but NOT the exact prompt that produced a response.
// For prompt-engineering traceability ("which prompt version + intent + system-prompt head drove this
// build?") this store appends one durable audit record per build: prompt version, intent label, model,
// task type, outcome, and the first 200 chars of the composed system prompt.
//
// Collection: `promptAudits/{userId}` → subcollection `entries/{ts}` (one doc per build).
// Pattern mirrors WorkspaceFileStore: firebase-admin, VITEST-skip, best-effort, never throws.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

const COLLECTION = 'promptAudits';
/** Cap how much of the system prompt we store — head is enough to identify the variant; keeps docs small. */
const PROMPT_PREFIX_CHARS = 200;
/** Cap how many audit entries loadPromptAudits returns (newest first). */
const MAX_RETURN = 200;

export interface PromptAuditRecord {
  ts: number;
  promptVersion: string;
  intentLabel: string;
  model: string;
  taskType: string;
  ok: boolean;
  systemPromptPrefix: string;
}

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Pure: build a normalised audit record (clamps the prompt prefix, coerces types). Defensive. */
export function buildPromptAudit(input: {
  ts: number;
  promptVersion?: string;
  intentLabel?: string;
  model?: string;
  taskType?: string;
  ok?: boolean;
  systemPrompt?: string;
}): PromptAuditRecord {
  return {
    ts: typeof input.ts === 'number' && input.ts > 0 ? input.ts : Date.now(),
    promptVersion: typeof input.promptVersion === 'string' ? input.promptVersion : '',
    intentLabel: typeof input.intentLabel === 'string' ? input.intentLabel : 'unknown',
    model: typeof input.model === 'string' ? input.model : '',
    taskType: typeof input.taskType === 'string' ? input.taskType : 'unknown',
    ok: input.ok === true,
    systemPromptPrefix: typeof input.systemPrompt === 'string' ? input.systemPrompt.slice(0, PROMPT_PREFIX_CHARS) : '',
  };
}

/** Persist one prompt audit record for a user. Best-effort — never throws, never blocks a build. */
export async function savePromptAudit(userId: string | null | undefined, record: PromptAuditRecord): Promise<void> {
  const uid = typeof userId === 'string' && userId ? userId : 'anon';
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).doc(uid).collection('entries').doc(String(record.ts)).set(record, { merge: true });
  } catch {
    /* best-effort — a persist failure never affects the build */
  }
}

/** Load a user's most recent prompt audits (newest first). Never throws. */
export async function loadPromptAudits(userId: string, limit: number = MAX_RETURN): Promise<PromptAuditRecord[]> {
  if (!userId) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db
      .collection(COLLECTION)
      .doc(userId)
      .collection('entries')
      .orderBy('ts', 'desc')
      .limit(Math.max(1, Math.min(MAX_RETURN, limit)))
      .get();
    const out: PromptAuditRecord[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Partial<PromptAuditRecord> | undefined;
      if (data && typeof data.ts === 'number') {
        out.push(buildPromptAudit({
          ts: data.ts,
          promptVersion: data.promptVersion,
          intentLabel: data.intentLabel,
          model: data.model,
          taskType: data.taskType,
          ok: data.ok,
          systemPrompt: data.systemPromptPrefix,
        }));
      }
    }
    return out;
  } catch {
    return [];
  }
}
