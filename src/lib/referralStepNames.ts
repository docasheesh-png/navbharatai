// The four step names, shared by the client and the server.
//
// A SEPARATE, DEPENDENCY-FREE FILE on purpose: `src/server/lib/referralRewards.ts` owns the money
// rules and must never be imported into the browser bundle — it reads `process.env`, and pulling a
// server module into the client is how a bundle grows a Node shim or, worse, how a money rule ends
// up evaluated where a user can reach it. The client needs only the NAMES, so the names live here
// and both sides import them.
//
// 🔒 `tests/referralStepNamesAgree.test.ts` asserts these are exactly the server's ALL_STEPS, in the
// same order. Two hand-kept lists that can drift is the defect this repo has already paid for more
// than once (four copies of safeRelPath; retired model ids in five files); one shared list plus a
// test that they agree is the cheapest honest version when a true shared module is not possible.

export type RewardStep = 'referral-code' | 'email' | 'mobile' | 'github';

/** The admin's own order: code, email, mobile, github. */
export const STEP_ORDER: readonly RewardStep[] = ['referral-code', 'email', 'mobile', 'github'];
