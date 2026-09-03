// Account & data deletion — the PUBLIC page Google Play requires.
//
// WHY IT IS SEPARATE FROM THE FIVE LEGAL DOCUMENTS: Play's requirement for an app that lets people
// create an account is a URL that (1) names the app, (2) prominently gives the STEPS to request
// deletion, and (3) says what is deleted, what is kept, and for how long. That is a short, practical
// instruction page — the five-document registry requires 4,000+ characters each, and padding this to
// reach that bar would make the one page whose whole job is to be quickly actionable harder to act on.
//
// ⚠️ EVERY CLAIM HERE IS CODE-ANCHORED. The "what is deleted" list is written from the verified
// registry in DataRetentionManager.ts (USER_SCOPED_COLLECTIONS) plus what the admin removes by hand
// on an emailed request; the 30-day window and the payment/tax carve-out match Section 6 of the
// Privacy Policy. If either changes, this page changes with it — a deletion page that overstates what
// is erased is worse than no page, because people rely on it and stop asking.

export const ACCOUNT_DELETION_TITLE = 'Delete your NavBharatAI account';
export const ACCOUNT_DELETION_UPDATED = '3 September 2026';

export const ACCOUNT_DELETION = `# Delete your NavBharatAI account

**Last updated: ${ACCOUNT_DELETION_UPDATED}**

This page explains how to ask us to delete your **NavBharatAI** account (Android app package \`com.navbharat.ai\`, and the website navbharatai.com) and the data associated with it.

---

## How to request deletion

**Email us from the address you signed up with:**

**info@navbharatai.com**

Use the subject line:

> **Delete my account**

In the message, please include:

1. The **email address or phone number** you use to sign in to NavBharatAI.
2. A sentence confirming you want the account deleted — for example, *"Please permanently delete my NavBharatAI account and my data."*

Sending it from your own registered address is how we confirm the request is really yours. If you cannot email from that address, tell us and we will ask you for another way to confirm — we will not delete an account on an unverified request, because that would let someone else erase your work.

**We acknowledge every request within 72 hours** and complete it within the timeline below.

---

## What is deleted

When your deletion request is completed, we remove:

- your **account record and profile** (name, email address, phone number, profile picture);
- your **chat history** across every NavBharatAI assistant;
- your **projects and built apps**, including their files and any archives you uploaded;
- your **build history and diagnostics** tied to your account;
- your **wallet, token balance and usage records**;
- any **API keys and credentials** you stored in the secrets vault;
- your **saved sessions and preferences**;
- your **connection to GitHub**, if you had connected one. (This removes NavBharatAI's access. It does **not** delete anything in your own GitHub account — that stays yours.)

**Your unused token balance is not refundable on deletion.** Deleting the account ends access to it, so please spend or withdraw value first if that matters to you.

---

## What is kept, and why

- **Payment, invoice and tax records.** Indian tax and accounting law requires businesses to keep records of money received. We keep the order identifier, the amount, the date and the payment status — not your card number, UPI PIN or banking credentials, which we never receive. These are retained for the period required by applicable law and are not used for anything else.
- **Anonymous, non-identifying records.** Technical logs and the platform's error-pattern learning contain no account identifier and cannot be traced back to you, so there is nothing personal in them to delete.
- **Apps you published to the Nav App Store.** If you published an app publicly and want it taken down as well, say so in your email and we will remove the listing and its files. Tell us explicitly — we do not remove a published app unless you ask, in case other people depend on it.

---

## How long it takes

Personal data is deleted or irreversibly anonymised **within 30 days** of a confirmed request. The payment and tax records described above are the only exception.

Backups are cycled on their own schedule, so a copy of already-deleted data may persist in an encrypted backup for a short additional period before it is overwritten. It is not restored to the live service and is not used for anything.

---

## Questions

Email **info@navbharatai.com**. The same address is our grievance contact for the purposes of the Digital Personal Data Protection Act, 2023.

For the full picture of what we collect and why, see our [Privacy Policy](https://navbharatai.com/privacy).
`;
