/**
 * Go-live wiring: the few default-OFF feature flags the BROWSER needs to know, served by
 * GET /api/public-flags. Booleans only; a flag is not a secret. Separate from /api/public-config so
 * that contract (and its pinned key list) is untouched.
 */
import { envFlag } from './envFlag';
import { freeProgramPausedNow } from './freeProgram';

export interface PublicFlags {
  walletV2Ui: boolean;
  planModelPro: boolean;
  byoLifecycle: boolean;
  /** The free program is paused: the browser hides every reward / referral / free-token surface. */
  freeProgramPaused: boolean;
}

export function publicFlags(): PublicFlags {
  return {
    walletV2Ui: envFlag('WALLET_V2_UI'),
    planModelPro: envFlag('PLAN_MODEL_PRO'),
    byoLifecycle: envFlag('BYO_LIFECYCLE_V1'),
    freeProgramPaused: freeProgramPausedNow(),
  };
}
