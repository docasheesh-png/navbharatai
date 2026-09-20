/**
 * 🔴 A REPORT MUST SAY WHAT IT NO LONGER CONTAINS.
 *
 * Admin, 2026-09-20: *"pahle autopsy ko fix karo, yeh problem wapas na aye. kisi bhi other apps
 * bannae me."*
 *
 * ## The bug
 *
 * A build report was capped TWICE on its way to the admin panel, and neither cap left a trace:
 *
 * | channel  | the build records | the recorder kept | Firestore kept |
 * |----------|-------------------|-------------------|----------------|
 * | llmCalls | unbounded         | 300               | **40**         |
 * | commands | unbounded         | 300               | **40**         |
 * | errors   | unbounded         | 200               | 50             |
 *
 * So a build that made 312 model calls was stored with 40 of them and NO statement that 272 were
 * gone. The reader — the admin, or Claude performing the autopsy CLAUDE.md's fifth absolute rule
 * makes mandatory — counts forty and says "this build made forty calls". Over the 900 KB emergency
 * threshold the channels were removed entirely, and `llmCalls: undefined` then read exactly like a
 * build that made no model calls at all.
 *
 * That rule's own Step 1 opens *"Read the WHOLE report end to end — never a truncated tail."* The
 * storage layer was quietly making that impossible.
 *
 * ## Why this is a CLASS fix and not a patch
 *
 * 1. **Two layers, and the upper one was worse.** The recorder's caps (`this.commands.length <
 *    MAX_COMMANDS`) discarded silently AND kept no counter, so the true total was not merely
 *    unreported — it was unknowable. Counting at the store alone would have produced "40 of 300"
 *    for a build that really made 500. The count had to start where the entries arrive.
 * 2. **Four identical copies of the emergency drop.** `saveDiagnostics`, `saveDiagnosticsHistory`
 *    and their two per-user siblings each carried their own `{ ...stored, commands: undefined,
 *    llmCalls: undefined }`. A fix at one would have been forgotten at the fourth — the drifted-copy
 *    class this repo has already paid for with `safeRelPath` (four copies) and the zombie-write lane
 *    (fixed in one of two, failing a 28-minute build two months later). They are now ONE function.
 * 3. **Trimming and declaring are a single operation.** `trimChannel` returns the loss WITH the
 *    list, so a caller cannot take the shorter list without the fact. That is what stops the bug
 *    coming back in the next channel somebody adds.
 *
 * ## The merge rule is the correctness of the whole thing
 *
 * A report is trimmed repeatedly. Each pass sees only what the last one left, so a naive second pass
 * records `kept: 0, total: 40` and destroys the only number that mattered. The earliest total wins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  trimChannel, dropChannel, mergeTruncation, readCompleteness, completenessLine, truncationNote,
  channelWasTruncated, COMPLETE, type ChannelTruncation,
} from '../src/server/AgentV3/reportTruncation';
import { trimReportForStorage, dropHeavyChannelsForStorage, compactReportForRecord, STORED_LLM_CALLS_MAX } from '../src/server/AgentV3/DiagnosticsStore';
import type { BuildDiagnosticsReport } from '../src/server/AgentV3/BuildDiagnostics';

const call = (i: number) => ({ ts: i, provider: 'GLM', model: 'glm-5.3', ok: true });
const cmd = (i: number) => ({ ts: i, command: `echo ${i}`, exitCode: 0, stdout: '', stderr: '' });

function reportWith(over: Partial<BuildDiagnosticsReport>): BuildDiagnosticsReport {
  return {
    schema: 'navbharatai.v3.build-diagnostics/1',
    startedAt: 0, endedAt: 1,
    counts: { total: 0, errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
    issues: [], problems: [],
    ...over,
  } as BuildDiagnosticsReport;
}

describe('one trim, one declaration — they cannot be done separately', () => {
  it('keeping 40 of 312 says "40 of 312", not "40"', () => {
    const { list, fact } = trimChannel(Array.from({ length: 312 }, (_, i) => call(i)), 40);
    expect(list).toHaveLength(40);
    expect(fact).toEqual({ kept: 40, total: 312 });
  });

  it('a channel that fits loses nothing and claims nothing', () => {
    const { list, fact } = trimChannel([call(1), call(2)], 40);
    expect(list).toHaveLength(2);
    expect(fact).toBeUndefined();   // silence here is correct — nothing was lost
  });

  it('the TAIL is kept, because a build fails at its end', () => {
    const { list } = trimChannel([call(1), call(2), call(3)], 2);
    expect(list?.map((c) => c.ts)).toEqual([2, 3]);
  });

  it('🔴 dropping a channel records the count it had — never a silent undefined', () => {
    // This is the worst case of the original bug: `llmCalls: undefined` read exactly like a build
    // that never called a model.
    const { list, fact } = dropChannel(Array.from({ length: 312 }, (_, i) => call(i)));
    expect(list).toBeUndefined();
    expect(fact).toEqual({ kept: 0, total: 312 });
  });

  it('dropping an already-empty channel claims nothing', () => {
    expect(dropChannel([]).fact).toBeUndefined();
    expect(dropChannel(undefined).fact).toBeUndefined();
  });
});

describe('🔑 THE MERGE RULE — the earliest total wins', () => {
  it('a second pass cannot destroy the first pass’s count', () => {
    // Recorder kept 300 of 500 → storage cut to 40 → emergency dropped to 0.
    // The honest end state is "0 of 500". A naive merge would say "0 of 40".
    const afterRecorder = mergeTruncation(COMPLETE, { llmCalls: { kept: 300, total: 500 } });
    const afterStorage = mergeTruncation(afterRecorder, { llmCalls: { kept: 40, total: 300 } });
    const afterEmergency = mergeTruncation(afterStorage, { llmCalls: { kept: 0, total: 40 } });
    expect(afterEmergency.channels?.llmCalls).toEqual({ kept: 0, total: 500 });
  });

  it('a channel that ends up whole is not listed as a loss', () => {
    // Alarming an admin about a loss that did not happen is its own dishonesty.
    expect(mergeTruncation(COMPLETE, { commands: { kept: 7, total: 7 } })).toEqual(COMPLETE);
  });

  it('the note names the worst loss first, and says "of"', () => {
    const t = mergeTruncation(COMPLETE, {
      errors: { kept: 50, total: 60 },
      llmCalls: { kept: 40, total: 312 },
    });
    expect(t.complete).toBe(false);
    expect(t.note).toContain('40 of 312 model calls');
    expect(t.note!.indexOf('312')).toBeLessThan(t.note!.indexOf('60'));
  });
});

describe('🔒 three answers, never two — a legacy report is UNKNOWN', () => {
  it('complete / truncated / unknown are distinguishable', () => {
    expect(readCompleteness(COMPLETE)).toBe('complete');
    expect(readCompleteness({ complete: false, channels: { llmCalls: { kept: 0, total: 9 } } })).toBe('truncated');
    expect(readCompleteness(undefined)).toBe('unknown');        // a report written before this check
  });

  it('a legacy report is never reported as complete', () => {
    // The whole reason `complete: true` is written even when nothing was lost. Without it, "no
    // field" would mean both "nothing lost" and "we cannot tell" — the ambiguity being removed.
    expect(completenessLine(undefined)).toContain('not recorded');
    expect(completenessLine(undefined)).not.toContain('whole record');
    expect(completenessLine(COMPLETE)).toBe('');
  });
});

describe('🔴 "complete" is an ANSWER, not an absence — the bug my own fix had first', () => {
  // The first draft of the cost-ledger wiring read only `channels.llmCalls`, found nothing on a
  // COMPLETE report, and fell through to the legacy length guess — which then marked a build that
  // genuinely made exactly 40 calls as a lower bound and threw a correct measurement out of the
  // admin's sample. A complete report STATES that nothing was lost.
  it('a complete report answers "no" for every channel', () => {
    expect(channelWasTruncated(COMPLETE, 'llmCalls')).toBe(false);
    expect(channelWasTruncated(COMPLETE, 'commands')).toBe(false);
  });

  it('a truncated report answers per channel, not as a whole', () => {
    const t = mergeTruncation(COMPLETE, { llmCalls: { kept: 40, total: 312 } });
    expect(channelWasTruncated(t, 'llmCalls')).toBe(true);
    expect(channelWasTruncated(t, 'commands')).toBe(false);   // this one survived whole
  });

  it('🔒 a legacy report answers UNDEFINED — never false, so a caller keeps its own fallback', () => {
    // `false` here would silently start treating old, genuinely truncated logs as complete.
    expect(channelWasTruncated(undefined, 'llmCalls')).toBeUndefined();
  });
});

describe('the storage path declares its own caps', () => {
  it('trimReportForStorage reports what it cut', () => {
    const out = trimReportForStorage(reportWith({
      llmCalls: Array.from({ length: 312 }, (_, i) => call(i)),
      commands: Array.from({ length: 100 }, (_, i) => cmd(i)),
    }));
    expect(out.llmCalls).toHaveLength(STORED_LLM_CALLS_MAX);
    expect(out.truncation?.complete).toBe(false);
    expect(out.truncation?.channels?.llmCalls).toEqual({ kept: STORED_LLM_CALLS_MAX, total: 312 });
    expect(out.truncation?.channels?.commands).toEqual({ kept: 40, total: 100 });
  });

  it('a small report is declared COMPLETE, positively', () => {
    const out = trimReportForStorage(reportWith({ llmCalls: [call(1)], commands: [cmd(1)] }));
    expect(readCompleteness(out.truncation)).toBe('complete');
  });

  it('🔴 it carries the RECORDER’s losses forward, so "40 of 500" survives', () => {
    // Without this the store would say "40 of 300" for a build that really made 500 calls — the
    // recorder having thrown 200 away before the store ever saw them.
    const out = trimReportForStorage(reportWith({
      llmCalls: Array.from({ length: 300 }, (_, i) => call(i)),
      truncation: mergeTruncation(COMPLETE, { llmCalls: { kept: 300, total: 500 } }),
    }));
    expect(out.truncation?.channels?.llmCalls).toEqual({ kept: STORED_LLM_CALLS_MAX, total: 500 });
  });
});

describe('the last-resort drop is ONE function, and it declares', () => {
  it('records "0 of N" for each channel it removes', () => {
    const stored = trimReportForStorage(reportWith({
      llmCalls: Array.from({ length: 312 }, (_, i) => call(i)),
      commands: Array.from({ length: 312 }, (_, i) => cmd(i)),
    }));
    const out = dropHeavyChannelsForStorage(stored);
    expect(out.llmCalls).toBeUndefined();
    expect(out.commands).toBeUndefined();
    expect(out.truncation?.channels?.llmCalls).toEqual({ kept: 0, total: 312 });
    expect(out.truncation?.channels?.commands).toEqual({ kept: 0, total: 312 });
    expect(completenessLine(out.truncation)).toContain('0 of 312 model calls');
  });

  it('🔒 not one save path still drops a channel by hand', () => {
    // The four copies are the point. A fifth save path added later must reach for the function,
    // and this assertion is what makes a hand-rolled spread fail CI instead of shipping a report
    // that lies on one path out of five.
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/DiagnosticsStore.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/\.\.\.stored,[\s\S]{0,120}commands:\s*undefined/);
    expect(src.match(/dropHeavyChannelsForStorage\(stored\)/g) ?? []).toHaveLength(4);
  });
});

describe('the compact embedded copy declares its DELIBERATE drops too', () => {
  it('says how many it dropped and where the full record is', () => {
    // Omitted by design (they live in workspace_diagnostics_v3) — but a reader holding only this
    // copy could not tell "by design" from "the build made none".
    const out = compactReportForRecord(reportWith({
      llmCalls: Array.from({ length: 12 }, (_, i) => call(i)),
      commands: Array.from({ length: 5 }, (_, i) => cmd(i)),
    }));
    expect(out.llmCalls).toBeUndefined();
    expect(out.truncation?.channels?.llmCalls).toEqual({ kept: 0, total: 12 });
    expect(out.truncation?.fullerCopy).toContain('full build report');
  });
});

describe('the recorder counts what its OWN caps refuse', () => {
  it('🔴 the counters exist at all three silent drop sites', () => {
    // The upper layer of the bug: `if (this.commands.length < MAX_COMMANDS)` discarded with no
    // counter, so the true total was not merely unreported — it was unknowable, and no fix at the
    // storage layer could have recovered it.
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    expect(src).toContain('this.channelTotals.commands += 1;');
    expect(src).toContain('this.channelTotals.llmCalls += 1;');
    expect(src).toContain('this.channelTotals.errors += 1;');
    // …and the report states them, derived at serialization so no ending path can forget it.
    expect(src).toContain('truncation: this.truncationFact()');
  });
});

describe('the admin can SEE it — a field nobody reads is half a fix', () => {
  it('the report panel shows a chip for truncated and for unknown, and nothing when complete', () => {
    // ⚠️ ASSERTED ON THE CHIP'S OWN TERNARY, not on "the string appears in this file" — the weaker
    // form passed while the panel was genuinely broken, because a bad edit had pasted the same words
    // into an unrelated `useState` declaration two hundred lines away. A substring search over a
    // 5,000-line file is not a test of the thing it names.
    const panel = readFileSync(join(__dirname, '..', 'src/components/AdminDashboard.tsx'), 'utf8');
    expect(panel).toContain("from '../server/AgentV3/reportTruncation'");
    expect(panel).toContain("{hard ? '⚠ Part of this report was dropped' : 'Completeness not recorded'}");
    expect(panel).toContain('readCompleteness(selectedReport?.report?.truncation)');
    // …and the chip is SILENT on a whole report: the early return is what stops it nagging.
    expect(panel).toContain("if (!selectedReport || state === 'complete') return null;");
  });
});

describe('pure — safe to call from the client', () => {
  it('never throws on malformed input', () => {
    const bad = { complete: 'yes' } as unknown as { complete: boolean };
    expect(readCompleteness(bad)).toBe('unknown');
    expect(() => truncationNote({})).not.toThrow();
    expect(truncationNote({} as Record<string, ChannelTruncation>)).toBe('');
  });
});
