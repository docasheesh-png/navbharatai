// WHAT AN `ai_usage_logs` ROW MAY LOOK LIKE ONCE IT LEAVES THE SERVER.
//
// 🔴 ROOT CAUSE (2026-09-14). `GET /api/wallet/:userId/logs` spread the WHOLE Firestore document into
// its response — `{ id: d.id, ...d.data() }` — on both its primary and its fallback query. Those
// documents carry `providerName` and `modelName` (see routes/chat.ts, which writes both), so every
// signed-in user's browser was handed the vendor and the model id of every AI call made for them.
//
// The billing screen never PAINTED those fields, which is exactly why it went unnoticed: the leak was
// in the payload, not the pixels. The White-Label Law is about what reaches the user — *"no admin-only
// diagnostic may ever be surfaced to an end user"* — and a JSON body in their own devtools is as
// surfaced as a rendered table.
//
// 🔒 ALLOW-LIST, NOT DENY-LIST, AND THAT IS THE WHOLE DESIGN. Deleting `providerName` and `modelName`
// would close today's leak and nothing else: the next field written into this collection — a routing
// note, a fallback reason, a rung id — ships to users by default and no test would fail. Naming what
// MAY leave inverts that, so a new field is private until someone decides otherwise.
//
// PURE. No I/O, no env, no Firestore types.

/** The fields a user's own client is allowed to see about one AI call made on their behalf. */
export interface UserSafeUsageLog {
  id: string;
  /** ISO timestamp, as written. */
  createdAt?: string;
  /** The user's own plan tier — theirs, not ours. */
  tier?: string;
  /** Did the call succeed? A user may know whether their own request worked. */
  ok?: boolean;
  /** Was the answer grounded in a live web lookup? A product behaviour, not a vendor. */
  grounded?: boolean;
  /**
   * Whether token usage was actually measured for this call. Carried through because "we do not know"
   * must stay distinguishable from zero on every surface that reads it — the same rule the money audit
   * fixed `estimated_provider_cost` for.
   */
  usageMeasured?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Fields that may cross the boundary. Everything else — `providerName`, `modelName`, `failureReason`,
 * `raced`, `latencyMs`, and anything added later — stays server-side.
 *
 * `latencyMs` and `raced` are withheld deliberately even though neither NAMES a vendor: `raced` says
 * that more than one model was asked, and a latency distribution is how someone infers which engine
 * served them. The law is that the user only ever sees NavBharatAI working, not a shape they can
 * reverse-engineer a routing decision from.
 */
/**
 * The keys that may cross the boundary, named so a test and a reader can both check the list against
 * the builder below. Everything else — `providerName`, `modelName`, `failureReason`, `raced`,
 * `latencyMs`, and anything added later — stays server-side.
 *
 * `latencyMs` and `raced` are withheld deliberately even though neither NAMES a vendor: `raced` says
 * that more than one model was asked, and a latency distribution is how someone infers which engine
 * served them. The law is that the user only ever sees NavBharatAI working, not a shape they can
 * reverse-engineer a routing decision from.
 */
export const USER_SAFE_USAGE_FIELDS = [
  'id', 'createdAt', 'tier', 'ok', 'grounded', 'usageMeasured', 'inputTokens', 'outputTokens',
] as const;

function s(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function b(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function n(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Reduce one raw usage document to what its own user may see.
 *
 * Built FIELD BY FIELD rather than by copying a filtered object, so the allow-list is enforced by the
 * type system itself: a field nobody wrote a line for cannot appear in the output, whatever the
 * document contains. Each value is also type-checked on the way through — a key holding an unexpected
 * shape (a Firestore Timestamp, a nested map) is dropped rather than serialised, because an allow-list
 * is defeated if an allowed key can smuggle an arbitrary payload through it.
 */
export function userSafeUsageLog(id: string, raw: unknown): UserSafeUsageLog {
  const out: UserSafeUsageLog = { id: String(id ?? '') };
  if (!raw || typeof raw !== 'object') return out;
  const doc = raw as Record<string, unknown>;

  const createdAt = s(doc.createdAt); if (createdAt !== undefined) out.createdAt = createdAt;
  const tier = s(doc.tier); if (tier !== undefined) out.tier = tier;
  const ok = b(doc.ok); if (ok !== undefined) out.ok = ok;
  const grounded = b(doc.grounded); if (grounded !== undefined) out.grounded = grounded;
  const measured = b(doc.usageMeasured); if (measured !== undefined) out.usageMeasured = measured;
  const inTok = n(doc.inputTokens); if (inTok !== undefined) out.inputTokens = inTok;
  const outTok = n(doc.outputTokens); if (outTok !== undefined) out.outputTokens = outTok;

  return out;
}
