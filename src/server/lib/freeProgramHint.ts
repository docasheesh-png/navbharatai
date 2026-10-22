// THE FREE PROGRAM'S LAST-KNOWN STATE, in a module with NO imports.
//
// `freeProgram.ts` talks to Firestore (and therefore to firebase-admin). The app-knowledge injector is imported by
// frontend tests, so it must not drag that in — the frontend typecheck would then see firebase-admin's server types.
// The store writes its latest answer here; readers that only need the last-known answer, synchronously, read it here.
//
// Before anything has been read the hint is PAUSED (the fail-safe), except under a unit-test run where there is no
// database and the existing suites exercise the live behaviour.

let hint: boolean | null = null;

export function setFreeProgramPausedHint(paused: boolean | null): void { hint = paused; }

export function freeProgramPausedHint(): boolean { return hint ?? !process.env.VITEST; }
