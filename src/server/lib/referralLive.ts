/**
 * Is the (app-only) referral ladder live right now?
 *
 * ADMIN 2026-10-30: referral is SPLIT from the Free Program pause. The pause still hides free Pro /
 * images / free-token surfaces, but the referral ladder follows only its own switch `REFERRAL_REWARDS`.
 * `REFERRAL_FOLLOWS_FREE_PAUSE=on` restores the old coupling (pause ⇒ referral off) without a deploy.
 */
import { referralRewardsEnabled } from './referralRewards';
import { freeProgramPausedNow } from './freeProgram';
import { parseEnvFlag } from './envFlag';

export function referralFollowsFreePause(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag((env.REFERRAL_FOLLOWS_FREE_PAUSE || '').trim().toLowerCase()) === true;
}

export function referralLiveNow(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!referralRewardsEnabled(env)) return false;
  return referralFollowsFreePause(env) ? !freeProgramPausedNow() : true;
}
