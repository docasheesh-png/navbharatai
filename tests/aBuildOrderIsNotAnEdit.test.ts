/**
 * A BUILD ORDER IS NOT AN EDIT — autopsy e9b25b08 (2026-09-18).
 *
 * Prompt: `"Build a search engines like google"`. Free/Weak, an existing workspace holding four
 * scaffold files. The engine told the user *"✏️ Editing your existing app (4 source files)"* about an
 * app they had never written, Software Project Mode recorded *"this turn is not a fresh build, so no
 * plan was created"* — the admin's own first test of that flag, blocked here — and the user stopped
 * the build at 69 seconds having seen nothing produced. `GREEN_GUARD_NONE` confirms no working state
 * had ever existed in that workspace.
 *
 * THE CHAIN, each link measured rather than assumed:
 *   1. `isExplicitCompleteBuild("Build a search engine like google")` is FALSE — only a prompt
 *      carrying the literal word "complete"/"full" passes.
 *   2. so the route's deterministic net forced `new_build` → `edit_existing`.
 *   3. that net's own comment names the case it was written for: *"even if the LLM is down/slow and
 *      the keyword fallback returned new_build"* — yet it fired unconditionally.
 *   4. the intention reader HAD run, HAD been handed `projectExists` in its own prompt, and had
 *      still answered **build**.
 *
 * A fallback that becomes an override breaks the thing it was helping — this repo's own words for
 * `withSandboxBrowsers` (autopsy 697b38ee), one layer up.
 *
 * 🔒 THE FIX IS NOT A WIDER VOCABULARY. `isExplicitCompleteBuild` stays exactly as strict as it is,
 * because loosening it would put a real user's app at risk of being rebuilt; these cases assert that
 * it is untouched. What changed is that the net now yields to the one actor that reads intention
 * with the project's state in front of it.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyIntentSmartDetailed,
  classifyIntentWithConfidence,
  isExplicitCompleteBuild,
} from '../src/server/AgentV3/IntentClassifier';
import { isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import {
  SCAFFOLD_PATHS,
  userOwnedFileCount,
  workspaceHoldsUserApp,
} from '../src/server/AgentV3/userProjectFiles';
import { zeroBillReasonFor } from '../src/server/AgentV3/zeroBillReason';

const ctx = { projectExists: true, recentRequests: [] as string[] };
const answers = (word: string) => async () => word;
const throws = async () => { throw new Error('provider down'); };

describe('the bug, pinned as measured', () => {
  it('🔴 a plain build order does NOT satisfy isExplicitCompleteBuild — only the word "complete" does', () => {
    for (const p of [
      'Build a search engines like google',
      'Build a search engine like google',
      'build a todo website',
      'build a chat app like whatsapp',
      'ek dukaan ka billing app banao',
      'make a game like ludo',
    ]) {
      expect(isExplicitCompleteBuild(p), p).toBe(false);
    }
    expect(isExplicitCompleteBuild('Create a complete Hospital OPD Management System')).toBe(true);
  });

  it('🔒 and that guard is DELIBERATELY untouched — a genuine edit can never become a rebuild', () => {
    for (const p of ['add a logout button', 'fix the header color', 'make the dashboard complete']) {
      expect(isExplicitCompleteBuild(p), p).toBe(false);
    }
  });
});

/**
 * 🔴 MEASURED, AND IT REDIRECTED THE WHOLE FIX. Every plain build order classifies `new_build` at
 * HIGH confidence, so the intention reader is deliberately never consulted for one — which means a
 * reader-based guard alone could not have fixed the reported build. My first version was exactly that
 * guard; these cases are what caught it. Recorded rather than quietly corrected.
 */
describe('the reader never sees a plain build order — it is already certain', () => {
  it('a build order is HIGH confidence, so the reader is skipped', () => {
    for (const p of [
      'Build a search engines like google',
      'build a todo website',
      'ek dukaan ka billing app banao',
      'banao ek blog',
    ]) {
      const r = classifyIntentWithConfidence(p);
      expect(r.intent, p).toBe('new_build');
      expect(r.confidence, p).toBe('high');
    }
  });

  it('an ambiguous edit instruction is LOW confidence — that IS the reader\'s population', () => {
    const r = classifyIntentWithConfidence('add a logout button');
    expect(r.confidence).toBe('low');
  });
});

const AMBIGUOUS = 'add a logout button';

describe('readerAnswered — who actually decided this turn', () => {
  it('is TRUE only when the reader itself answered', async () => {
    for (const [word, intent] of [['build', 'new_build'], ['edit', 'edit_existing'], ['chat', 'chat'], ['help', 'chat']] as const) {
      const r = await classifyIntentSmartDetailed(AMBIGUOUS, answers(word), ctx);
      expect(r.readerAnswered, word).toBe(true);
      expect(r.intent, word).toBe(intent);
    }
  });

  it('is FALSE when the reader could not answer — the net must keep governing those', async () => {
    const failed = await classifyIntentSmartDetailed(AMBIGUOUS, throws, ctx);
    expect(failed.readerAnswered).toBe(false);

    const garbage = await classifyIntentSmartDetailed(AMBIGUOUS, answers('banana'), ctx);
    expect(garbage.readerAnswered).toBe(false);
  });

  it('is FALSE for "unclear" — the intent returned there is the KEYWORD verdict, not the reader\'s', async () => {
    const r = await classifyIntentSmartDetailed(AMBIGUOUS, answers('unclear'), ctx);
    expect(r.unclear).toBe(true);
    expect(r.readerAnswered).toBe(false);
  });

  it('is FALSE for a high-confidence keyword verdict — the reader is never consulted', async () => {
    let called = false;
    const r = await classifyIntentSmartDetailed('Build a search engines like google', async () => { called = true; return 'chat'; }, ctx);
    expect(called).toBe(false);
    expect(r.readerAnswered).toBe(false);
    expect(r.intent).toBe('new_build');
  });

  it('a caller that ignores the flag is byte-identical to before it existed', async () => {
    const r = await classifyIntentSmartDetailed(AMBIGUOUS, answers('build'), ctx);
    expect(r.intent).toBe('new_build');
    expect(r.unclear).toBe(false);
  });
});

/**
 * The route's condition, restated here as the pure decision it is. The route applies exactly this
 * expression; these cases fix WHICH populations move and which do not.
 */
function netDowngrades(o: {
  intent: 'new_build' | 'edit_existing' | 'chat';
  userAppExists: boolean;
  wantsFreshStart: boolean;
  explicitCompleteBuild: boolean;
  readerAnswered: boolean;
}): boolean {
  const readerOverrulesTheNet = o.readerAnswered && o.intent === 'new_build';
  return o.intent === 'new_build' && o.userAppExists && !o.wantsFreshStart
    && !o.explicitCompleteBuild && !readerOverrulesTheNet;
}

describe('the net stands in for a reader that did not run — it does not overrule one that did', () => {
  const base = { intent: 'new_build', userAppExists: true, wantsFreshStart: false, explicitCompleteBuild: false } as const;

  it('🔴 THE REPORTED CASE: the reader answered build, so the order stays a build', () => {
    expect(netDowngrades({ ...base, readerAnswered: true })).toBe(false);
  });

  it('🔒 the reader did NOT run — the net governs, exactly as before', () => {
    expect(netDowngrades({ ...base, readerAnswered: false })).toBe(true);
  });

  it('🔴 THE REPORTED CASE, the other half: only the scaffold is present, so there is no app to edit', () => {
    expect(netDowngrades({ ...base, userAppExists: false, readerAnswered: false })).toBe(false);
    expect(netDowngrades({ ...base, userAppExists: false, readerAnswered: true })).toBe(false);
  });

  it('🔒 the two existing escape hatches are unchanged', () => {
    expect(netDowngrades({ ...base, wantsFreshStart: true, readerAnswered: false })).toBe(false);
    expect(netDowngrades({ ...base, explicitCompleteBuild: true, readerAnswered: false })).toBe(false);
  });

  it('🔒 an EDIT the reader itself decided is never flipped to a build by this flag', () => {
    expect(netDowngrades({ ...base, intent: 'edit_existing', readerAnswered: true })).toBe(false);
    expect(netDowngrades({ ...base, intent: 'chat', readerAnswered: true })).toBe(false);
  });
});

describe('the downgrade is no longer silent', () => {
  it('BUILD_ORDER_READ_AS_EDIT is a fact about our routing, never a finding about the app', () => {
    expect(isAppFinding({ phase: 'plan', code: 'BUILD_ORDER_READ_AS_EDIT' })).toBe(false);
    const suggestions = buildFindingSuggestions([
      { code: 'BUILD_ORDER_READ_AS_EDIT', message: 'read as an edit', severity: 'info', phase: 'plan' },
    ]);
    expect(suggestions).toHaveLength(0);
  });
});

describe('the scaffold is not the user\'s app', () => {
  it('🔒 the path list is DERIVED from the scaffold itself, not re-listed', () => {
    for (const p of ['package.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'vite.config.ts']) {
      expect(SCAFFOLD_PATHS.has(p), p).toBe(true);
    }
    expect(SCAFFOLD_PATHS.size).toBeGreaterThanOrEqual(10);
  });

  it('🔴 a workspace holding ONLY the scaffold holds no app of the user\'s', () => {
    expect(userOwnedFileCount(['index.html', 'package.json', 'src/main.tsx', 'src/App.tsx'])).toBe(0);
    expect(workspaceHoldsUserApp(['index.html', 'package.json', 'src/main.tsx'])).toBe(false);
  });

  it('🔒 one file of their own is enough — a real app is never mistaken for a scaffold', () => {
    expect(userOwnedFileCount(['index.html', 'package.json', 'src/pages/Dashboard.tsx'])).toBe(1);
    expect(workspaceHoldsUserApp(['index.html', 'src/components/Cart.tsx'])).toBe(true);
  });

  it('normalises the three spellings of one path, and de-duplicates', () => {
    expect(userOwnedFileCount(['./src/App.tsx', '/src/App.tsx', 'src/App.tsx'])).toBe(0);
    expect(userOwnedFileCount(['./src/Cart.tsx', 'src/Cart.tsx'])).toBe(1);
  });

  it('🔒 UNKNOWN MEANS YES — an unreadable listing can never be read as an empty workspace', () => {
    expect(workspaceHoldsUserApp(null)).toBe(true);
    expect(workspaceHoldsUserApp(undefined)).toBe(true);
  });

  it('is total on junk', () => {
    expect(userOwnedFileCount([])).toBe(0);
    expect(userOwnedFileCount(['', '   ', null as unknown as string])).toBe(0);
    expect(workspaceHoldsUserApp([])).toBe(false);
  });
});

describe('a build the user stopped is not an empty build', () => {
  it('🔴 THE REPORTED LINE: a stopped build no longer says "empty build (0 files produced)"', () => {
    expect(zeroBillReasonFor({ ok: false, stoppedByUser: true }))
      .toBe('stopped by the user before any file was written — never charged');
  });

  it('🔒 the two states that already worked are untouched', () => {
    expect(zeroBillReasonFor({ ok: true, stoppedByUser: false }))
      .toBe('verified-no-change turn (nothing needed changing) — not charged');
    expect(zeroBillReasonFor({ ok: false, stoppedByUser: false }))
      .toBe('empty build (0 files produced) — never charged');
  });

  it('success is asked FIRST — a verified-no-change turn is a success that wrote nothing', () => {
    expect(zeroBillReasonFor({ ok: true, stoppedByUser: true }))
      .toBe('verified-no-change turn (nothing needed changing) — not charged');
  });

  it('every branch is a ₹0 reason — the bill never moved, only the sentence', () => {
    for (const ok of [true, false]) {
      for (const stoppedByUser of [true, false]) {
        expect(zeroBillReasonFor({ ok, stoppedByUser })).toMatch(/not charged|never charged/);
      }
    }
  });
});
