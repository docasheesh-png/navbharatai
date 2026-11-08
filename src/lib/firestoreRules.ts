/**
 * Firestore security rules for a user's OWN Firebase project (owner 2026-10-30: "firebase rules likh
 * kar copy paste karwana — jo adha adhura hai usko pura karo, end user ke liye simple").
 *
 * Connecting Firebase used to stop at the keys: the app got built, but the user's Firestore was left
 * either in "test mode" (open to the whole internet, and auto-locked after 30 days — the app then
 * breaks silently) or "locked mode" (every read fails). Neither is a finished setup. This module is
 * the missing last step: a SAFE default rule set the user copies in one tap, plus a direct deep link
 * to the exact Console page where it is pasted.
 *
 * Why copy instead of auto-deploy: deploying rules needs admin access to the user's Google project
 * (a service-account key or OAuth with full Firebase scope). Holding that would be a liability far
 * bigger than one paste. One Copy + one Publish is the honest, safe minimum.
 *
 * PURE and dependency-free — shared by the settings screen and the tests.
 */

/**
 * Safe defaults:
 *  - users/{uid}/**      → only that signed-in user can read/write (profiles, carts, private data)
 *  - public/**           → anyone can read; only signed-in users can write (catalogues, posts)
 *  - everything else     → denied (nothing is open to the internet by accident)
 */
export const SECURE_FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function isOwner(uid) { return signedIn() && request.auth.uid == uid; }

    // Each user's own private data: users/{uid} and everything under it.
    match /users/{uid}/{document=**} {
      allow read, write: if isOwner(uid);
    }

    // Data everyone may see (products, posts, menu). Only signed-in users can change it.
    match /public/{document=**} {
      allow read: if true;
      allow write: if signedIn();
    }

    // Anything else stays locked — nothing is accidentally open to the internet.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{4,29}$/;

/** Deep link to the Rules tab of the user's project, or the Console home when the id looks wrong. */
export function firestoreRulesConsoleUrl(projectId: string | null | undefined): string {
  const id = String(projectId ?? '').trim().toLowerCase();
  return PROJECT_ID_RE.test(id)
    ? `https://console.firebase.google.com/project/${id}/firestore/rules`
    : 'https://console.firebase.google.com/';
}

/** Rules that leave the database open to everyone — the "test mode" trap. */
export function rulesAreWideOpen(rules: string): boolean {
  const s = String(rules ?? '').replace(/\s+/g, ' ');
  return /allow\s+read\s*,\s*write\s*(:\s*if\s+true\s*)?;/.test(s) || /request\.time\s*<\s*timestamp\.date/.test(s);
}

export interface RulesStep { en: string; hi: string }

/** Three steps, both languages, short enough for a phone screen. */
export const FIRESTORE_RULES_STEPS: RulesStep[] = [
  { en: 'Tap "Copy rules".', hi: '"Copy rules" दबाएँ।' },
  { en: 'Tap "Open Firebase Rules" → select all old text → paste.', hi: '"Open Firebase Rules" दबाएँ → पुराना सब हटाकर paste करें।' },
  { en: 'Tap "Publish". Done — your data is now safe.', hi: '"Publish" दबाएँ। बस — आपका data सुरक्षित है।' },
];
