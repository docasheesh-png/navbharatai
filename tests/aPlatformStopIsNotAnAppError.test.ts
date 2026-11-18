// Autopsy 05eb30ba (2026-11-18): a build stopped by the user's wallet ended with our own sentence, the error banner
// offered "Fix with AI", and an 11.7-minute build ran on "Fix this error and continue building the app: Your
// balance is not enough for this build, please recharge!". The CLASS is every ending the platform writes for a
// build IT stopped — so this census walks every one of them, not the instance.
import { describe, expect, it } from 'vitest';
import { errorCanBeFixedByEditingTheApp } from '../src/lib/platformFixRequest';
import { isPlatformStopNotice } from '../src/lib/platformStopNotices';
import {
  ALL_ABORT_CAUSES, abortSummary, timedOutSummary, stalledModelSummary, type SeedState,
} from '../src/server/AgentV3/buildAbortCause';
import { BALANCE_RECHARGE_EN, BALANCE_RECHARGE_HI, balanceRechargeNotice } from '../src/server/AgentV3/balanceRechargeNotice';

const seeds: Array<SeedState | null> = [null, 'platform-template', 'kept-seed'];
const every: Array<{ what: string; text: string }> = [];
for (const cause of ALL_ABORT_CAUSES) {
  for (const builtSomething of [true, false]) {
    for (const seed of seeds) {
      for (const minutes of [undefined, 25]) {
        for (const providerFault of [false, true]) {
          every.push({ what: `${cause} built=${builtSomething} seed=${seed} min=${minutes} fault=${providerFault}`,
            text: abortSummary(cause, { builtSomething, seed, minutes, providerFault }) });
        }
      }
    }
  }
}
for (const builtSomething of [true, false]) {
  for (const seed of seeds) {
    for (const providerFault of [false, true]) {
      every.push({ what: `timedOut built=${builtSomething} seed=${seed} fault=${providerFault}`, text: timedOutSummary(25, { builtSomething, seed, providerFault }) });
    }
    every.push({ what: `stalled built=${builtSomething} seed=${seed}`, text: stalledModelSummary(4, { builtSomething, seed }) });
  }
}
every.push({ what: 'wallet EN', text: BALANCE_RECHARGE_EN }, { what: 'wallet HI', text: BALANCE_RECHARGE_HI },
  { what: 'wallet via notice()', text: balanceRechargeNotice('make a racing game') });

describe('a build the platform stopped is never offered "Fix with AI"', () => {
  it('the real report: the wallet stop of build 375b8d37', () => {
    const message = 'Your balance is not enough for this build, please recharge!';
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message })).toBe(false);
  });

  it.each(every)('census: $what', ({ text }) => {
    expect(isPlatformStopNotice(text)).toBe(true);
    expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message: text })).toBe(false);
  });

  it('a real app error out of the stream keeps the button', () => {
    for (const message of [
      "src/App.tsx(2,26): error TS2307: Cannot find module './game/ApexRace'",
      "The requested module '/src/game/Game.ts' does not provide an export named 'Game'",
      'Your app is built and saved, but 1 thing is still broken, so it is NOT ready to use yet',
    ]) expect(errorCanBeFixedByEditingTheApp({ beforeBuildStarted: false, message })).toBe(true);
  });

  it('a user quoting the notice mid-message is not the notice', () => {
    expect(isPlatformStopNotice('why did it say "Your balance is not enough for this build"?')).toBe(false);
  });
});
