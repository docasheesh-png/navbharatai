/**
 * PRO'S HISTORY ONLY IN PRO, FREE'S ONLY IN FREE — and the leak that made that untrue.
 *
 * Admin 2026-09-22: *"navbharatai pro ki history sirf navbharatai pro me dikhe, navbharatai free ki
 * sirf navbharatai free me … leakage to band karne ki bola tha maine."*
 *
 * 🔴 HOW A PRO SESSION BECAME A FREE ONE, in three ordinary steps and no error anywhere:
 *   1. `useSessionManager.restoreSession` stamped `currentAgent: 'navbharatai'` on every restored
 *      non-v3 session. Its `isV3Session` matches the `agentv3` family — NOT `navbharatai-pro`, which
 *      is what App.tsx saves the Pro App Builder chat as. So opening a Pro session rewrote it.
 *   2. App.tsx's Firestore sync wrote that through as `current_agent` (and writes no `agent` field).
 *   3. The next load reads `agent: docData.current_agent || docData.original_agent` → 'navbharatai'.
 *   From then on HistoryView's `String(s.agent || s.current_agent || s.currentAgent)` read
 *   'navbharatai', and the session sat in NavBharatAI Free's history for good.
 *
 * 🔑 THE DEFECT IS THE `||` CHAIN, not the keyword list: it reads the FIRST field present and
 * ignores the other four, so overwriting ONE field is enough to change what a session appears to be.
 * `sessionOwnerOf` reads every one of them, which is why it survives step 2 even on rows already
 * laundered before this fix shipped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sessionIsPro, sessionIsDoctor, sessionOwnerOf } from '../src/lib/sessionRouting';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8');

/** The row AgentV3Panel writes for a v5.0 session (metadata only). */
const v3Row = () => ({
  id: 'v3_abc123', uci: 'v3_abc123', userId: 'u1', tab: 'engine_builder',
  original_agent: 'agentv3', current_agent: 'agentv3', title: 'Billing app', mode: 'build',
});
/** The row App.tsx saves for the Pro App Builder chat. */
const proBuilderRow = () => ({
  id: 'pro_9', title: 'Shop app', agent: 'navbharatai-pro',
  originalAgent: 'navbharatai-pro', currentAgent: 'navbharatai-pro', mode: 'build',
});
/** An ordinary NavBharatAI Free chat. */
const freeRow = () => ({
  id: 'sess_1', title: 'Hello', agent: 'navbharatai',
  originalAgent: 'navbharatai', currentAgent: 'navbharatai', tab: 'nbi_chat',
});
const doctorRow = () => ({ id: 'sess_2', title: 'Fever', agent: 'sda', currentAgent: 'sda' });

describe('every shape a real writer produces lands on the right surface', () => {
  it('a v5.0 build is Pro', () => {
    expect(sessionOwnerOf(v3Row())).toBe('pro');
  });

  it('a Pro App Builder chat is Pro', () => {
    expect(sessionOwnerOf(proBuilderRow())).toBe('pro');
  });

  it('a Free chat is Free and a Doctor chat is Doctor', () => {
    expect(sessionOwnerOf(freeRow())).toBe('free');
    expect(sessionOwnerOf(doctorRow())).toBe('doctor');
    expect(sessionIsDoctor(doctorRow())).toBe(true);
    expect(sessionIsPro(freeRow())).toBe(false);
  });
});

describe('the leak itself', () => {
  it('a Pro session whose current_agent a restore overwrote is STILL Pro', () => {
    // Exactly what Firestore holds after step 2 above: `original_agent` still says what it is, and
    // the field the old code happened to read first no longer does.
    const laundered = { id: 'pro_9', title: 'Shop app', agent: 'navbharatai', current_agent: 'navbharatai', original_agent: 'navbharatai-pro' };
    expect(sessionOwnerOf(laundered)).toBe('pro');
  });

  it('a v5.0 build whose agent fields were all rewritten is still Pro by its id', () => {
    expect(sessionOwnerOf({ id: 'v3_abc123', agent: 'navbharatai', current_agent: 'navbharatai' })).toBe('pro');
  });

  it('the first-field-wins read is what fails — the new one does not', () => {
    const s = { agent: 'navbharatai', current_agent: 'agentv3' };
    // The old rule, reproduced here only to show the difference it makes.
    const firstFieldWins = String(s.agent || s.current_agent || '').toLowerCase();
    expect(firstFieldWins.includes('agentv3')).toBe(false);
    expect(sessionIsPro(s)).toBe(true);
  });

  it('junk never classifies as Pro, and never throws', () => {
    for (const bad of [null, undefined, {}, { agent: 42 }, { id: 5 }, 'nonsense' as unknown]) {
      expect(sessionOwnerOf(bad as never)).toBe('free');
    }
  });
});

describe('what was deliberately NOT widened', () => {
  it('a Free session that autosaved while the Pro tab was open stays Free', () => {
    // App.tsx's generic saver writes `tab: activeView`. Treating `nbi_pro_chat` as a Pro signal would
    // make such a row vanish from Free's history — the reported bug's mirror image.
    expect(sessionOwnerOf({ ...freeRow(), tab: 'nbi_pro_chat' })).toBe('free');
  });

  it('only `engine_builder` counts as a Pro tab, and it still does', () => {
    expect(sessionIsPro({ id: 'x', tab: 'engine_builder' })).toBe(true);
    expect(sessionIsPro({ id: 'x', meta: { tab: 'engine_builder' } })).toBe(true);
    expect(sessionIsPro({ id: 'x', tab: 'professionals' })).toBe(false);
  });

  it('Pro wins a tie, so a doubtful row never lands in Free', () => {
    expect(sessionOwnerOf({ id: 'v3_1', agent: 'doctor' })).toBe('pro');
  });
});

describe('one rule, both lists', () => {
  it('the Free list asks the shared classifier, not a local copy', () => {
    const view = read('src/components/HistoryView.tsx');
    expect(view).toContain("from '../lib/sessionRouting'");
    expect(view).toContain('const isProSession = (s: any) => sessionIsPro(s);');
    expect(view).toContain("const isFreeSession = (s: any) => sessionOwnerOf(s) === 'free';");
    // Reversion guard: the local first-field-wins rule must not come back.
    expect(view).not.toContain("String(s.agent || s.current_agent || s.currentAgent || '')");
  });

  it('the Pro list asks the SAME classifier', () => {
    const panel = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(panel).toContain("import { sessionIsPro } from '../../lib/sessionRouting';");
    expect(panel).toContain('if (!sessionIsPro({ ...data, id: d.id })) continue;');
    // The old four-signal copy, gone.
    expect(panel).not.toContain("data?.current_agent === 'agentv3'");
  });

  it('opening a Pro conversation no longer rewrites what it is', () => {
    const mgr = read('src/hooks/useSessionManager.ts');
    expect(mgr).toContain("currentAgent: restoredOwner === 'free' ? 'navbharatai' : (targetSession.currentAgent || targetAgent),");
    expect(mgr).not.toMatch(/\n\s*currentAgent: 'navbharatai',\n\s*agent: targetAgent,/);
  });
});

describe('the Pro list does not wait for the superset', () => {
  // Admin, same message: "navbharatai pro, ki loading me bahut time lagta hai … bhi quickly load ho
  // jaye". Both sources used to be awaited before anything was shown, and the second is a getDocs
  // over every chat_sessions document — whole documents, carrying transcripts and a built app's files.
  const panel = read('src/components/agentv3/AgentV3Panel.tsx');
  const body = panel.slice(panel.indexOf('const loadHistory = async () => {'), panel.indexOf('const toggleHistory = async () => {'));

  it('the server list is published and the spinner cleared BEFORE the Firestore pass', () => {
    const publish = body.indexOf('publish();');
    const getDocs = body.indexOf('await getDocs(');
    const spinnerOff = body.indexOf('setHistoryLoading(false)');
    expect(publish).toBeGreaterThan(-1);
    expect(getDocs).toBeGreaterThan(-1);
    expect(publish).toBeLessThan(getDocs);
    expect(spinnerOff).toBeLessThan(getDocs);
  });

  it('the top-up can only ADD rows — the richer server record still wins', () => {
    expect(body).toContain('if (!bySession.has(sid)) bySession.set(sid, row);');
  });

  it('a superseded load cannot overwrite a newer list', () => {
    expect(body).toContain('const gen = ++historyLoadGenRef.current;');
    expect(body).toContain('if (gen !== historyLoadGenRef.current) return;');
  });
});
