// A CUSTOMER'S OWN DETAILS NEVER GO INTO A LOG LINE WHOLE (Q-886).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// Three live sites printed a real person's details into the container log on the NORMAL path, not on an
// error branch:
//   · `routes/payment.ts` logged `Name: … Email: … Phone: …` on EVERY Cashfree order;
//   · the same file logged the WHOLE webhook body whenever an event carried no order id;
//   · `routes/auth.ts` logged a full phone number on every successful OTP gate check.
// Nothing was wrong with wanting those lines — an order that fails is diagnosed from them. What was
// wrong is that the diagnosis needs an IDENTIFIER, and the code printed an IDENTITY.
//
// ── WHY A MODULE AND NOT A CAREFUL EDIT AT EACH SITE ─────────────────────────────────────────────
// `phoneForLog` already existed (`phoneGate.ts`) and was already used — at ONE of the two places that
// log a phone. That is the shape of this bug class: a rule that has to be remembered at every log
// statement is a rule that will eventually be forgotten, and the forgetting is silent because a log
// line that says too much looks exactly like one that says enough. So the helpers live in one place,
// `tests/aCustomerIsNotIdentifiedInALog.test.ts` fails on a new raw-PII log line, and a reviewer no
// longer has to notice.
//
// ⚠️ SCOPE, stated so the next reader does not think it was missed: `maskPhone` has TWO DRIFTED COPIES
// in this repo — `src/lib/phoneNumber.ts` keeps the last FOUR digits, `src/server/lib/vaultPin.ts` the
// last TWO. Same name, different behaviour. That is a real defect of the fourth rule's duplicated-code
// class, but the vaultPin copy renders a string the USER reads ("we sent it to •••••••10"), so
// unifying them changes a user-facing message rather than a log line. It is recorded as its own queue
// row instead of being bundled into this one.
//
// PURE. No I/O, no clock. Every function is total: junk in gives a safe string out, never a throw,
// because a logging helper that can throw turns a diagnostic line into an outage.

import { phoneForLog } from './phoneGate';

export { phoneForLog };

/**
 * An email as a log may carry it: the first character, then the domain.
 *
 * `asheesh@gmail.com` → `a…@gmail.com`. Enough to recognise the account in a support conversation
 * ("the one ending @gmail.com, starting with a"), not enough to BE the address. The domain is kept
 * because it is the part that actually helps — a delivery failure is usually a property of the domain.
 *
 * An input with no `@` is not treated as an email at all: it is reduced to its first character, since
 * a value in an email field that is not an email is still something a person typed about themselves.
 */
export function emailForLog(raw: string | null | undefined): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s === '') return '(none)';
  const at = s.lastIndexOf('@');
  if (at <= 0) return `${s.slice(0, 1)}…`;
  const domain = s.slice(at + 1);
  return `${s.slice(0, 1)}…@${domain}`;
}

/**
 * A person's name as a log may carry it: its first character and the length.
 *
 * `Asheesh Rathore` → `A… (15)`. A name is never needed to diagnose anything — the user id is the
 * handle for that — so this exists only for the lines that genuinely want to distinguish "a name was
 * supplied" from "the field was empty", which is a real failure mode for a gateway that rejects blank
 * customer names.
 */
export function nameForLog(raw: string | null | undefined): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s === '') return '(none)';
  return `${s.slice(0, 1)}… (${s.length})`;
}

/**
 * The fields of a webhook body that are safe to log, as one short string.
 *
 * 🔴 REPLACES `console.warn('…', req.body)`. A gateway's webhook body carries the payer's name, email,
 * phone and the gateway's own reference ids; printing it whole was the single widest leak of the three,
 * and it fired exactly when something was already wrong — so the worst payloads were the ones most
 * likely to be printed. What a diagnosis actually needs is the SHAPE: which keys arrived, and the
 * event type. Values are never included, because the bug being diagnosed is always "which event is
 * this", never "what is this person's phone number".
 */
export function webhookShapeForLog(body: unknown): string {
  if (body === null || body === undefined) return 'body=(none)';
  if (typeof body !== 'object') return `body=(${typeof body})`;
  const keys = Object.keys(body as Record<string, unknown>).slice(0, 12).sort();
  const type = (body as Record<string, unknown>).type ?? (body as Record<string, unknown>).event;
  const typeStr = typeof type === 'string' && type !== '' ? ` type=${type.slice(0, 40)}` : '';
  return `body keys=[${keys.join(',')}]${typeStr}`;
}
