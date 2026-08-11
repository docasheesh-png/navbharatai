import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  VOICE_TICK_MS, VOICE_MAX_CALL_SECONDS, unbilledSeconds, voiceSecondsCostInr,
  mayStartVoiceCall, shouldEndCallForBalance, voiceDebitRef, voiceChargeDescription,
} from '../src/server/sonic/voiceBilling';
import { VOICE_PAISE_PER_SECOND, resolveVoiceLang, voiceConsent } from '../src/lib/voiceChatBilling';

/**
 * ADMIN 2026-08-10: "ek voice chat ka option hai SDA (doctor ai) me — usko bhi paid service bana kar
 * sabhi me laga do. Jab koi user usko use kare to charge karenge. Jo ki user ko dikhega voice chat
 * icon par click karne se — user ki language me ek popup aaye."
 *
 * The rate (2 paise/sec) and the popup's words are proven in tests/chatComposerCore.test.ts. What is
 * proven HERE is the part that touches a real balance: when the meter starts, how it settles, when a
 * call is refused, and when one already running is ended rather than allowed to overdraw.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('what gets billed', () => {
  const t0 = 1_000_000;

  it('whole seconds only, and the remainder is carried to the next tick', () => {
    // Rounding UP at every tick would silently inflate a long call by a partial second each time.
    expect(unbilledSeconds(t0, t0 + 20_900, 0)).toBe(20);
    expect(unbilledSeconds(t0, t0 + 20_900, 20)).toBe(0);
    expect(unbilledSeconds(t0, t0 + 41_000, 20)).toBe(21);
  });

  it('a call that has not started, or a clock that jumps backwards, bills nothing', () => {
    expect(unbilledSeconds(t0, t0, 0)).toBe(0);
    expect(unbilledSeconds(t0, t0 - 5_000, 0)).toBe(0);   // never a negative "credit"
    expect(unbilledSeconds(t0, t0 + 500, 0)).toBe(0);      // under one second
    expect(unbilledSeconds(NaN, t0, 0)).toBe(0);
  });

  it('never bills past the hard ceiling, however long the socket stays open', () => {
    const far = t0 + (VOICE_MAX_CALL_SECONDS + 5_000) * 1000;
    expect(unbilledSeconds(t0, far, 0)).toBe(VOICE_MAX_CALL_SECONDS);
    expect(unbilledSeconds(t0, far, VOICE_MAX_CALL_SECONDS)).toBe(0);
  });

  it('costs exactly the confirmed rate', () => {
    expect(VOICE_PAISE_PER_SECOND).toBe(2);
    expect(voiceSecondsCostInr(60)).toBeCloseTo(1.2, 5);
    expect(voiceSecondsCostInr(1)).toBeCloseTo(0.02, 5);
    expect(voiceSecondsCostInr(0)).toBe(0);
  });

  it('settles often enough to cut off an abandoned call, rarely enough not to hammer the wallet', () => {
    expect(VOICE_TICK_MS).toBeGreaterThanOrEqual(10_000);
    expect(VOICE_TICK_MS).toBeLessThanOrEqual(30_000);
    // An hour of talking should be a few hundred writes, not thousands.
    expect((60 * 60 * 1000) / VOICE_TICK_MS).toBeLessThan(400);
  });
});

describe('who may call, and when a live call has to stop', () => {
  it('an empty balance is refused BEFORE the provider is dialled', () => {
    expect(mayStartVoiceCall(0, false)).toBe(false);
    expect(mayStartVoiceCall(-3, false)).toBe(false);
    expect(mayStartVoiceCall(5, false)).toBe(true);
  });

  it('an UNREADABLE balance is let through — fail-open, like every other gate', () => {
    // Denying a paying user their call over a Firestore blip is the worse error, and the meter still
    // records the debt honestly.
    expect(mayStartVoiceCall(null, false)).toBe(true);
    expect(shouldEndCallForBalance(null)).toBe(false);
  });

  it('the free list never pays', () => {
    expect(mayStartVoiceCall(0, true)).toBe(true);
  });

  it('running out mid-call ENDS it rather than letting it overdraw', () => {
    // A silent overdraft is discovered later as a number the user cannot explain; ending the call can
    // be explained while they are still listening.
    expect(shouldEndCallForBalance(0)).toBe(true);
    expect(shouldEndCallForBalance(-1)).toBe(true);
    expect(shouldEndCallForBalance(0.5)).toBe(false);
  });
});

describe('the ledger', () => {
  it('each tick is a distinct entry, and a RETRY of one tick collapses onto the same ref', () => {
    // An idempotent debit keyed to a repeated ref would silently drop the second charge and every
    // later one in a long call.
    expect(voiceDebitRef('c1', 20)).not.toBe(voiceDebitRef('c1', 40));
    expect(voiceDebitRef('c1', 20)).toBe(voiceDebitRef('c1', 20));
    expect(voiceDebitRef('c1', 20)).not.toBe(voiceDebitRef('c2', 20));
  });

  it('names NavBharatAI, never the vendor behind the voice', () => {
    const d = voiceChargeDescription(95);
    expect(d).toContain('NavBharatAI');
    expect(d).toMatch(/1m 35s/);
    expect(voiceChargeDescription(45)).toMatch(/45s/);
    expect(voiceChargeDescription(120)).toMatch(/2m/);
    expect(d).not.toMatch(/\b(sonic|nova|amazon|aws|bedrock)\b/i);
  });
});

describe('the popup speaks the user\'s own language', () => {
  it('Hindi and Hinglish both get the Hindi text', () => {
    // A Hinglish speaker reads Devanagari comfortably; showing them English would defeat the point.
    expect(resolveVoiceLang(() => 'hindi')).toBe('hi');
    expect(resolveVoiceLang(() => 'Hinglish')).toBe('hi');
    expect(resolveVoiceLang(() => 'english')).toBe('en');
    expect(resolveVoiceLang(() => null)).toBe('en');
    expect(resolveVoiceLang(() => { throw new Error('no storage'); })).toBe('en');
  });

  it('and it quotes the rate the wallet will really charge', () => {
    expect(voiceConsent('hi').body).toContain(String(VOICE_PAISE_PER_SECOND));
    expect(voiceConsent('en').body).toContain(String(VOICE_PAISE_PER_SECOND));
  });
});

describe('WIRING — the charge is real, and it is asked for first', () => {
  const ws = read('src/server/sonic/sonicWs.ts');
  const button = read('src/components/sonic/ProfessionalVoiceButton.tsx');
  const chat = read('src/components/sonic/SonicChat.tsx');

  it('billing starts at `ready`, never at connect — a failed start bills nothing', () => {
    // Everything before `ready` is us getting our own session up. The user got nothing.
    expect(ws).toContain('.then(() => { startMeter(); send(ws, { type: \'ready\' }); })');
    const at = ws.indexOf('const startMeter');
    expect(at).toBeGreaterThan(-1);
    expect(ws.slice(at, at + 300)).toContain('if (billingStartedAt || !uid || freeListed) return;');
  });

  it('the wallet is really debited, per tick, with the shared rate', () => {
    expect(ws).toContain('debitWalletForBuild(');
    expect(ws).toContain('billedInr: voiceSecondsCostInr(owed)');
    expect(ws).toContain('buildRef: voiceDebitRef(callId, through)');
  });

  it('a second tick cannot re-charge seconds a slow write is still settling', () => {
    const at = ws.indexOf('const settle');
    expect(ws.slice(at, at + 900)).toMatch(/billedSeconds = through;[\s\S]{0,200}await debitWalletForBuild/);
  });

  it('hanging up settles the final partial slice — it is not a free tail', () => {
    expect(ws).toContain('const stopMeter');
    expect(ws).toContain("ws.on('close', () => { stopMeter();");
    expect(ws).toContain("ws.on('error', () => { stopMeter();");
  });

  /**
   * FOUND BY RE-READING THE FIRST VERSION OF THIS CODE, before it ever ran in production.
   *
   * `endCall()` used to close the socket and leave the ticker to `ws.on('close')`. But `ws.close()`
   * on a socket that is already gone emits NO 'close' event — so the interval would have kept running
   * on a dead call, and every later tick would have billed more elapsed seconds. It would have hit
   * precisely the user the branch exists for: the one whose balance just ran out, charged on for a
   * call that had already ended.
   *
   * The same class, one level down: the seconds between a call ending and 'close' finally arriving
   * were billed as talking time. The billing clock now stops when the CALL does.
   */
  it('ending a call stops the ticker THERE — it is never left to the close event', () => {
    const at = ws.indexOf('const endCall');
    expect(at).toBeGreaterThan(-1);
    const fn = ws.slice(at, at + 900);
    expect(fn).toContain('clearInterval(ticker)');
    expect(fn).toContain('billingEndedAt = Date.now()');
    // …and a tick already in flight when the call ended must not charge past it.
    expect(ws).toMatch(/if \(ending\) return;[\s\S]{0,400}await settle\(\);\s*\n\s*if \(ending\) return;/);
  });

  it('the billing clock stops at the END of the call, not when the socket finally closes', () => {
    expect(ws).toContain('unbilledSeconds(billingStartedAt, billingEndedAt || Date.now(), billedSeconds)');
    // A normal hang-up sets it; a call already ended keeps its EARLIER timestamp.
    expect(ws).toContain('if (!billingEndedAt) billingEndedAt = Date.now();');
  });

  it('an empty wallet never reaches the provider at all', () => {
    expect(ws).toContain('mayStartVoiceCall(balance, false)');
    // …and the check sits in the UPGRADE path, before the socket becomes a session.
    expect(ws.indexOf('mayStartVoiceCall')).toBeGreaterThan(ws.indexOf('handleSonicUpgrade'));
  });

  it('the price is agreed BEFORE the call, not discovered after it', () => {
    // Tapping the mic opens a consent card, not a call.
    expect(button).toContain('onClick={() => setAsking(true)}');
    expect(button).toContain('voiceConsent(voiceLang())');
    expect(button).toContain('{consent.body}');
  });

  it('the live meter shows the SERVER\'s billed seconds, never a local stopwatch', () => {
    // A client-side count would drift from the wallet and display a different figure from the charge.
    expect(chat).toContain("msg.type === 'billing'");
    expect(chat).toContain('setBilledSeconds(msg.seconds)');
    expect(chat).toContain('voiceRunningCostLabel(billedSeconds');
  });

  it('a call cut short says WHY, instead of looking like a dropped connection', () => {
    expect(chat).toContain("msg.type === 'ended'");
    expect(chat).toMatch(/balance ran out/i);
  });
});

describe('voice is now on EVERY AI, as asked', () => {
  const screens: Array<[string, string]> = [
    ['the free + IDE chat', 'src/components/ide/AIChat.tsx'],
    ['NavBharatAI Pro v5.0', 'src/components/agentv3/AgentV3Panel.tsx'],
    ['Doctor AI', 'src/components/sda/SDAChat.tsx'],
    ['the professionals', 'src/components/professionals/ProfessionalChat.tsx'],
  ];
  for (const [name, file] of screens) {
    it(`${name} carries the voice button`, () => {
      expect(read(file)).toContain('<ProfessionalVoiceButton');
    });
  }

  it('the CALL SURFACE is lazy — typing a message must not download a voice-call engine', () => {
    /**
     * CAUGHT BY CI AS A REAL BUDGET BREACH, and fixed rather than budgeted around. Putting the voice
     * button on every AI (including the free chat) made `SonicChat` — mic capture, PCM resampling,
     * playback scheduling, the waveform — part of the MAIN chunk. The largest chunk went from
     * 645.3 KB to 640.9 KB once it was lazy-imported: smaller than before the feature landed.
     * A static import here would silently undo that for every user on first paint.
     */
    const button = read('src/components/sonic/ProfessionalVoiceButton.tsx');
    expect(button).toContain("lazy(() => import('./SonicChat')");
    expect(button).toContain('<Suspense');
    // Only the TYPE may be imported statically — types vanish at build time.
    expect(button).toContain("import type { SonicTurn } from './SonicChat'");
    expect(button).not.toMatch(/^import \{[^}]*SonicChat[^}]*\} from '\.\/SonicChat'/m);
  });

  it('the old "professionals only" restriction is recorded as SUPERSEDED, not silently dropped', () => {
    const button = read('src/components/sonic/ProfessionalVoiceButton.tsx');
    expect(button).toMatch(/SUPERSEDED/);
    expect(button).toMatch(/2026-07-14/); // the instruction being superseded is still named
  });
});
