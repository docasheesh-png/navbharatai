// THE PRO BUILD DOOR, WHILE THE FREE PROGRAM IS PAUSED (admin 2026-10-22: "navbharatai pro ka free token system band karna hoga").
//
// An account that has never paid cannot start a NavBharatAI Pro build — whatever balance its wallet still holds from the
// gifts (hidden, not deleted; lib/freeProgram.ts). Refused with the same 402 shape as the other paid-only refusals, before
// the build route does anything: no lock is taken, no stream is opened, nothing needs giving back.
//
// 🔑 IT IS A MIDDLEWARE, NOT CODE INSIDE THE HANDLER, ON PURPOSE. The chat handler has a branch budget that only ever goes
// DOWN (tests/theChatHandlerHasHeadroom.test.ts, Q-979): the compiler gives up on a function that grows past its flow-analysis
// limit, and the first version of this gate — a block inside the handler — tripped that guard. The handler gains nothing.
//
// Mirrors `enforceNotBanned`: skipped under a unit-test run, and a genuinely anonymous caller is left to the route's own
// sign-in refusal (this gate is about accounts that exist). Free-list admins/testers are exempt. An unreadable wallet counts as
// never-paid — the pause fails SAFE, like everything else in the program.

import type { NextFunction, Request, Response } from 'express';
import { freeProgramPaused, FREE_TRIAL_ENDED_CODE, FREE_TRIAL_ENDED_MESSAGE } from './freeProgram';
import { verifyFirebaseToken, resolveGrantEmail } from './authMiddleware';
import { isAgentV3FreeUser, type GrantEmail } from '../AgentV3/featureFlag';
import { firestoreWalletReader } from '../AgentV3/WalletBalance';
import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';
import { getServerDb } from './serverDb';
import { audit } from './audit';

export interface FreeProgramGateDeps {
  paused(): Promise<boolean>;
  uid(req: Request): Promise<string | null>;
  email(uid: string): Promise<GrantEmail | null>;
  isFreeListed(uid: string, email: GrantEmail | null): boolean;
  wallet(uid: string): Promise<unknown>;
}

const defaultDeps: FreeProgramGateDeps = {
  paused: freeProgramPaused,
  uid: (req) => verifyFirebaseToken(req).catch(() => null),
  email: (uid) => resolveGrantEmail(uid).catch(() => null),
  isFreeListed: (uid, email) => isAgentV3FreeUser(uid, email),
  wallet: (uid) => firestoreWalletReader(getServerDb() as never)(uid).catch(() => null),
};

export function enforceFreeProgramPause(deps: FreeProgramGateDeps = defaultDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST && deps === defaultDeps) { next(); return; }
    try {
      if (!(await deps.paused())) { next(); return; }
      const uid = await deps.uid(req);
      if (!uid) { next(); return; }
      if (deps.isFreeListed(uid, await deps.email(uid))) { next(); return; }
      if (hasEverPaid((await deps.wallet(uid)) as never)) { next(); return; }
      audit('AGENTV3_FREE_PROGRAM_PAUSED_REFUSAL', { userId: uid }, 'info');
      res.status(402).json({ error: FREE_TRIAL_ENDED_MESSAGE, code: FREE_TRIAL_ENDED_CODE, balanceInr: 0, balanceTokens: 0 });
    } catch {
      next(); // a gate error must never take the build door down; the affordability gate still runs inside
    }
  };
}
