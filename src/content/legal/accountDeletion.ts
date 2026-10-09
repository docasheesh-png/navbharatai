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
export const ACCOUNT_DELETION_UPDATED = '5 October 2026';

export const ACCOUNT_DELETION = `# Delete your NavBharatAI account

**Last updated: ${ACCOUNT_DELETION_UPDATED}**

This page explains how to ask us to delete your **NavBharatAI** account (Android app package \`com.navbharat.ai\`, and the website navbharatai.com) and the data associated with it.

---

## The fastest way: delete it yourself, in the app

Open **Settings**, scroll to the bottom to the red **Danger zone**, and choose **Delete account**. You will be asked to type the word *delete* to confirm — a single accidental tap can never delete an account. Deletion runs immediately and you are signed out.

---

## Or ask us to do it

If you cannot reach the app — or you would rather we handled it — **email us from the address you signed up with:**

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
- your **projects and built apps**, including their files and any archives you uploaded, the review comments left on them, and the list of things the builder asked you to do for them;
- your **build history and diagnostics** tied to your account, including the reports of past builds, **every saved version of every app you could have restored**, and the record of which instructions each build ran with;
- your **notifications and devices** — the mentions sent to you inside NavBharatAI, and the push-notification address of each phone you signed in on;
- your **wallet, token balance and usage records**;
- any **API keys and credentials** you stored in the secrets vault;
- your **NavBharatAI API keys** — every developer key you made at Home → Other AI → Developer Tools, and
  the daily usage counted against each one. A key that was still in use stops working the moment it is
  deleted, and the same key can never be used again;
- your **chat bots** — every bot you connected, together with the token and app secret NavBharatAI held
  for it, so the bot stops answering, **and the conversations each bot had with the people who messaged
  it**. (This removes NavBharatAI's copy of those credentials. The bot's own account on the messaging
  platform stays yours, and you can delete it there.)
- the **addresses NavBharatAI posted your build events to** — the webhook URLs you added, so nothing is
  ever sent to them again;
- your **architecture decisions and tech-debt notes** — what the builder recorded about the stack each of
  your projects chose, and the list of rough edges it was keeping track of;
- your **App Lock PIN** — the 4-digit PIN that locks parts of NavBharatAI, including that vault;
- your **saved connected services** — the MCP services you saved on your account to reuse across apps
  (this removes NavBharatAI's saved copy of the address and key; it does **not** touch anything in the
  service's own account, which stays yours);
- your **gift-code purchase tally** — the running count of how many gift codes you bought on a given
  day. (The codes themselves are **not** deleted: once you have given a code to somebody, it is theirs
  to redeem, and a payment record is one of the things we are required to keep — see below.);
- your **App Mart likes, dislikes and comments** — every 👍 and 👎 you gave, every comment and reply you wrote, your App Mart notifications, the list of people you blocked, the creators you follow and the people who follow you, the profile photo you uploaded, and the link between your public creator code and your account (so your App Mart profile stops opening). Other people's replies to your comments are not theirs to lose, but they can no longer be reached once your comment is gone;
- your **rating of NavBharatAI** — the stars and the note you gave after one of your apps went live, and any "Not now" pause on that question;
- your **cross-device workspace** — the copy of your chat sessions and your last built app that we
  keep so they follow you from one device to another;
- your **chat and voice memory** — what each NavBharatAI assistant remembered about you to keep a
  conversation going, the voice-chat turns, what a professional assistant had noted about you, and every
  build conversation you had with the builder;
- your **builder settings and the record of what the builder learned from you** — your saved
  preferences, the lessons it kept, the mistakes ledger it used so it would not repeat itself, and the
  diagnostics report of your own last build;
- your **daily usage counters** — terminal seconds, tool and picture calls, the AI usage rows behind
  your spend, your free-build credit, and the balance warnings we had already sent you;
- the **record of which screens and actions you used** — the product-usage rows we keep to see where
  people get stuck. They are deleted after 30 days anyway; closing your account removes yours now;
- your **professional pass**, if you had one, and which admin notices you had already read;
- the **files you uploaded** — .zip archives and spreadsheets you gave to a build;
- your **share links** — a page you shared stops opening;
- your **instantly-hosted apps** — an app you published with instant hosting stops being served;
- your **referral record** — your own code and the claims against it. (A payout already recorded under
  somebody else's referral is their record, and is kept — see below.);
- your **connected domains** — NavBharatAI's record of a domain you pointed at one of your apps, and
  the uptime history we kept for it. (This removes OUR record. It does **not** change anything at your
  domain registrar or your own host, which are not ours to touch — remove the DNS records there if you
  want the name completely free.)
- the **engineering notes the builder kept for you** — the design decisions it recorded for each
  project and the list of rough edges it was tracking in your code;
- the **AI identity of each app you published** — the record of which of your apps may use
  NavBharatAI's AI, and as you;
- **everything the builder kept about each app** — its plan and roadmap, its build state, the trail of
  decisions it took, the caches it reused between builds, the software bill of materials for each
  build, the app's own site settings, the note of which App Mart app it was remixed from,
  and the outside services it was wired to talk to together with the keys we held for them;
- the **live preview and deployment of each app** — the sandbox it ran in and our record of where it
  was deployed;
- your **team, if you made one** — a team belongs to the account that created it, so it goes with
  yours: the list of its members (their names and email addresses are removed with it) and the shared
  library it held. Your own member record is also removed from every other team you had joined;
- your **saved sessions and preferences**;
- your **connection to GitHub**, if you had connected one. (This removes NavBharatAI's access. It does **not** delete anything in your own GitHub account — that stays yours.)
- your **connection to Supabase**, if you had connected one, and our record of which sleeping-database reminders we already sent you. (This removes NavBharatAI's copy of the access. It does **not** delete your Supabase projects or anything in them — they stay in your own Supabase account; to revoke the access fully, also remove the NavBharatAI app in your Supabase account settings.)

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
