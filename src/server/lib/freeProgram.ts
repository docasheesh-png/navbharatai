// THE FREE PROGRAM SWITCH — one admin-controlled pause for everything NavBharatAI gives away (admin 2026-10-22).
//
// 🔴 THE ADMIN'S ORDER (verbatim): *"navbharatai pro ka free token system band karna hoga! paise nahi hai.
// navbharatai free chat to chalne do! baki sab free token system pause kar do! kuch din ke liye! user ko lagna hi
// nahi chahiye ki koi free token system tha bhi! bas paid system rakho. pay and use waise already bana hua hai."*
// And on the old gift tokens: *"purane token hide kar do! user ko lage token hai hi nahi! aur free trial ended
// likh kar aaye wallet me. kuch din baad jab paise aa jayenge tab in token ko wapas de denge! abhi sab 00 kar do!"*
// And on the daily allowances (images, tools, professionals): paused too. Free Chat is NOT part of this.
//
// WHAT "PAUSED" MEANS, in one place so no surface invents its own meaning:
//   1. NO NEW GIFTS — the referral ladder (signup / login / mobile / GitHub / code) grants and pays nothing.
//   2. NO FREE PRO — an account that has never paid cannot start a NavBharatAI Pro build, whatever its balance.
//   3. NO FREE DAILY ALLOWANCE — images, tools and professionals need a paying account.
//   4. THE OLD GIFT BALANCE IS HIDDEN, NEVER DELETED — a never-paid wallet is SHOWN as 0 with "free trial ended"
//      (`maskWalletForView`); the stored document is untouched, so the tokens come back when the program resumes.
//      A wallet that has ever paid is shown exactly as it is: its balance is real money's worth.
//   5. THE SCREENS FORGET IT EXISTED — the browser hides every reward / referral / free-token surface (public flag).
//
// 🔒 FAIL-SAFE IS "PAUSED". A missing setting, an unreadable one, a storage blip — all read as PAUSED, because the
// whole point is that the admin cannot afford the other mistake. The one exception is a unit-test run (VITEST),
// where there is no database and the existing suites exercise the live behaviour; the tests of THIS file inject
// their own backend and prove the default.
//
// The setting lives at `platform_settings/free_program` and is read through a 2-second cache; a snapshot
// subscription keeps every Cloud Run instance in step, so a toggle takes effect within seconds everywhere.

import { getServerDb, type Firestore } from './serverDb';
import { hasEverPaid } from '../AgentV3/FreeTierBuildRouting';
import { setFreeProgramPausedHint } from './freeProgramHint';

export const FREE_PROGRAM_COLLECTION = 'platform_settings';
export const FREE_PROGRAM_DOCUMENT = 'free_program';

/** What a never-paid account is told wherever the free allowance would have applied. */
export const FREE_TRIAL_ENDED_MESSAGE = 'Your free trial has ended. Add credits to keep building.';
export const FREE_TRIAL_ENDED_CODE = 'free_trial_ended';

export interface FreeProgramState { paused: boolean; updatedAt: number | null }

/** An absent or unreadable document is PAUSED; only a stored `paused: false` is live. */
export function freeProgramState(data: unknown): FreeProgramState {
  const d = (data ?? {}) as Partial<FreeProgramState>;
  return { paused: d.paused !== false, updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : null };
}

export interface FreeProgramBackend {
  read(): Promise<unknown>;
  write(next: FreeProgramState): Promise<void>;
  subscribe?(fn: (data: unknown) => void, error: () => void): () => void;
}

function firestoreBackend(): FreeProgramBackend {
  const db: Firestore | null = getServerDb();
  if (!db) throw new Error('Free program storage unavailable');
  const ref = db.collection(FREE_PROGRAM_COLLECTION).doc(FREE_PROGRAM_DOCUMENT);
  return {
    read: async () => (await ref.get()).data(),
    write: async (next) => { await ref.set(next); },
    subscribe: (fn, error) => ref.onSnapshot((snap) => fn(snap.data()), error),
  };
}

/** Before the first successful read this is what the synchronous answer is. */
function defaultPausedBeforeFirstRead(): boolean {
  return !process.env.VITEST;
}

export class FreeProgramStore {
  private value: FreeProgramState | null = null;
  private readAt = 0;
  private pending: Promise<FreeProgramState> | null = null;
  private stopWatch?: () => void;
  constructor(private backend: () => FreeProgramBackend = firestoreBackend, private now: () => number = Date.now,
    private defaultPaused: () => boolean = defaultPausedBeforeFirstRead) {}

  /** The last known answer, with no I/O. Paused until something has proven otherwise. */
  pausedNow(): boolean { return this.value ? this.value.paused : this.defaultPaused(); }

  private accept(state: FreeProgramState): FreeProgramState { this.value = state; this.readAt = this.now(); setFreeProgramPausedHint(state.paused); return state; }

  /** Fresh enough (2 s) answer. Unreadable ⇒ PAUSED, and the failure is not cached as a fact. */
  async read(): Promise<FreeProgramState & { unavailable?: boolean }> {
    if (this.value && this.now() - this.readAt < 2_000) return this.value;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const data = await Promise.race([
          this.backend().read(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Free program setting unavailable')), 1_500); }),
        ]);
        return this.accept(freeProgramState(data));
      } catch {
        if (!this.value) return { paused: this.defaultPaused(), updatedAt: null, unavailable: true };
        return { ...this.value, paused: true, unavailable: true };
      } finally { if (timer) clearTimeout(timer); this.pending = null; }
    })();
    return this.pending;
  }

  /** Subscribe once so every instance hears a toggle within seconds. Harmless if storage is missing. */
  start(): void {
    if (this.stopWatch) return;
    try {
      this.stopWatch = this.backend().subscribe?.((data) => { this.accept(freeProgramState(data)); }, () => {
        this.readAt = 0; this.stopWatch?.(); this.stopWatch = undefined;
      });
    } catch { /* read() still answers paused until storage can be read. */ }
  }

  async setPaused(paused: boolean): Promise<FreeProgramState> {
    const next: FreeProgramState = { paused, updatedAt: this.now() };
    await this.backend().write(next); // throws → the caller reports a failed save, never a fake success
    return this.accept(next);
  }
}

export const freeProgramStore = new FreeProgramStore();

/** Synchronous: for the call sites that already branch synchronously (referral routes). */
export function freeProgramPausedNow(): boolean { freeProgramStore.start(); return freeProgramStore.pausedNow(); }
/** Asynchronous and fresh: for the call sites that can wait one cheap read (builds, tools, wallet). */
export async function freeProgramPaused(): Promise<boolean> { freeProgramStore.start(); return (await freeProgramStore.read()).paused; }

// ── what a never-paid wallet is SHOWN while the program is paused ──────────────────────────────────────────────

/** Wallet fields that carry a balance, a gift or a reward history. Shown as zero / empty for a never-paid wallet. */
const BALANCE_FIELDS = ['remaining_balance', 'total_balance', 'tokenBalance', 'freeGiftedTokens', 'giftTokensRemaining'] as const;

/**
 * The wallet document as the OWNER should see it. Pure.
 *
 * Paused + never paid ⇒ the balance reads 0, the reward history is empty and `freeTrialEnded` is true; the stored
 * document is not touched (the route only calls this on the way out). Everything else passes through unchanged:
 * a program that is live, or an account that has ever paid, sees its real wallet.
 */
export function maskWalletForView(data: Record<string, unknown>, paused: boolean): Record<string, unknown> {
  if (!paused || hasEverPaid(data as never)) return data;
  const out: Record<string, unknown> = { ...data, walletLedger: [], freeTrialEnded: true, freeTrialEndedMessage: FREE_TRIAL_ENDED_MESSAGE };
  for (const k of BALANCE_FIELDS) if (k in out) out[k] = 0;
  return out;
}
