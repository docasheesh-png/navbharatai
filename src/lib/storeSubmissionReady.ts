// WHY IS THE BUTTON GREY? (admin report 2026-08-17: "pura form fill kar diya fir bhi" publish nahi hota)
//
// The App Mart form disabled "Send for review" until every field met the server's rules, and then said
// NOTHING about which one had not. The admin's own screenshot is the whole bug: the form looks complete
// — every box has text in it, the consent is ticked — and two rules are quietly unmet:
//
//   • the long description was 19 characters where the server requires 30;
//   • the developer email was "aashishcpmt09", which is a username, not an email address.
//
// A disabled control with no stated reason is worse than a rejection. A rejection at least tells you
// what to change; this just sits there while the user re-reads a form that looks finished to them and
// concludes the feature is broken — which is exactly what happened.
//
// So the validation itself is NOT the problem and is not relaxed here: the server enforces the same
// rules (`validateSubmission`), so loosening the client would only move the silence to a 400. What was
// missing is the sentence. This module produces it.
//
// PURE — no React, so every message is unit-testable, and the same list can drive both the field hints
// and the summary under the button.

export interface StoreSubmissionForm {
  appName: string;
  shortDescription: string;
  description: string;
  developerName: string;
  developerEmail: string;
  acceptedTerms: boolean;
}

/** Which field a message belongs to, so the form can put it in the right place. */
export type StoreField = 'appName' | 'shortDescription' | 'description' | 'developerName' | 'developerEmail' | 'acceptedTerms';

export interface StoreFieldProblem {
  field: StoreField;
  /** Written for the user, and specific: what is wrong AND what would fix it. */
  message: string;
}

/** Mirrors the server's own limits. Kept here as named constants so a message can quote the real number. */
export const MIN_APP_NAME = 2;
export const MIN_SHORT_DESCRIPTION = 10;
export const MIN_DESCRIPTION = 30;
export const MIN_DEVELOPER_NAME = 2;

/** The same shape the server accepts. Deliberately simple — an address it cannot deliver to is the point. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/**
 * Everything still standing between this form and a submission, in form order.
 *
 * Returns an EMPTY array when the form is ready, so the caller can use `length === 0` as the enable
 * condition and never keep two rules in step. Every message names the actual number required and, where
 * a count is involved, how far along the user already is — "24 more characters" is actionable in a way
 * that "too short" is not. PURE.
 */
export function storeSubmissionProblems(form: StoreSubmissionForm): StoreFieldProblem[] {
  const out: StoreFieldProblem[] = [];
  const appName = String(form?.appName ?? '').trim();
  const shortDescription = String(form?.shortDescription ?? '').trim();
  const description = String(form?.description ?? '').trim();
  const developerName = String(form?.developerName ?? '').trim();
  const developerEmail = String(form?.developerEmail ?? '').trim();

  if (appName.length < MIN_APP_NAME) {
    out.push({ field: 'appName', message: `App name needs at least ${MIN_APP_NAME} characters.` });
  }
  if (shortDescription.length < MIN_SHORT_DESCRIPTION) {
    out.push({
      field: 'shortDescription',
      message: `The one-line description needs at least ${MIN_SHORT_DESCRIPTION} characters — ${MIN_SHORT_DESCRIPTION - shortDescription.length} more to go.`,
    });
  }
  if (description.length < MIN_DESCRIPTION) {
    out.push({
      field: 'description',
      message: `The full description needs at least ${MIN_DESCRIPTION} characters — ${MIN_DESCRIPTION - description.length} more to go. Tell people what your app does.`,
    });
  }
  if (developerName.length < MIN_DEVELOPER_NAME) {
    out.push({ field: 'developerName', message: `Your name needs at least ${MIN_DEVELOPER_NAME} characters.` });
  }
  if (!EMAIL_RE.test(developerEmail)) {
    // Named separately because the commonest mistake is a USERNAME, and "invalid email" does not tell
    // somebody who typed their handle what is actually expected of them.
    out.push({
      field: 'developerEmail',
      message: developerEmail
        ? 'That does not look like an email address — it needs an @ and a domain, like you@example.com.'
        : 'An email address is required, so the reviewer can reach you.',
    });
  }
  if (!form?.acceptedTerms) {
    out.push({ field: 'acceptedTerms', message: 'Tick the box to confirm you have the right to publish this app.' });
  }
  return out;
}

/** True when the submit would actually pass the server's checks. PURE. */
export function isStoreSubmissionReady(form: StoreSubmissionForm): boolean {
  return storeSubmissionProblems(form).length === 0;
}

/**
 * One line for under the button, so the reason is visible without hunting for a red field.
 *
 * Names the FIRST problem in full rather than listing all of them: a wall of complaints on a form the
 * user thinks is finished reads as rejection, while one specific next step reads as help. The count is
 * appended only when there is more to come, so nobody fixes one thing and is surprised twice. PURE.
 */
export function storeSubmissionBlockedReason(form: StoreSubmissionForm): string {
  const problems = storeSubmissionProblems(form);
  if (problems.length === 0) return '';
  const [first, ...rest] = problems;
  return rest.length === 0 ? first.message : `${first.message} (${rest.length} more to fix after this.)`;
}
