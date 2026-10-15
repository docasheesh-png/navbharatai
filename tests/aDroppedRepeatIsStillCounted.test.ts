/**
 * Q-1087 — a build report could not show the defect it was reporting.
 *
 * Build `413d29a1` (session report 12ef62b2) ran the same no-op command about sixty times across
 * minutes 10–13 of a 13.4-minute build that ended RED. Its stored report says:
 *
 *     "kept 40 of 140 sandbox commands (the first 20 and the last 20 — 100 from the middle are gone)"
 *
 * The loop lived entirely in the hundred that went. Report 398db9f3 lost its RED gate's own blocker the
 * same way (#3743's Q-1067, now in main) — two unrelated reports, one day, the same shape.
 *
 * ⚠️ AND THIS IS NOT A FAULT IN THE HEAD+TAIL SPLIT. That split is argued at length in
 * reportTruncation.ts and the argument holds: neither end is privileged, and it costs not one byte.
 * The point is narrower and applies to ANY window — a LOOP is not an entry, it is a COUNT of entries,
 * and a count cannot be sampled. So the gap is CENSUSED before it is cut: only repeats, only the top
 * few, and only when something actually repeated, so an ordinary build pays nothing and a looping one
 * pays a few hundred bytes to make its loop readable in one line.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  trimChannel, gapCensus, mergeGapTop, mergeTruncation, truncationNote, gapShape, windowShape,
  GAP_TOP_MAX, GAP_LABEL_MAX,
} from '../src/server/AgentV3/reportTruncation';

/** The reported build's own command, verbatim. */
const NOOP = ': > /tmp/x && node -e \'console.log("noop")\'';

/** 140 commands shaped like build 413d29a1: real work at each end, ~58 identical no-ops in the middle. */
function build413d29a1(): Array<{ command: string }> {
  const out: Array<{ command: string }> = [];
  for (let i = 0; i < 25; i++) out.push({ command: `npm install pkg-${i}` });
  for (let i = 0; i < 58; i++) out.push({ command: NOOP });
  for (let i = 0; i < 40; i++) out.push({ command: `./node_modules/.bin/tsc --noEmit # ${i}` });
  for (let i = 0; i < 17; i++) out.push({ command: `npm run build # ${i}` });
  return out;
}

describe('🔴 the reported build: the loop survives the trim even though its entries do not', () => {
  const list = build413d29a1();

  it('the gap really does swallow the whole loop — the premise, measured not assumed', () => {
    const { list: kept } = trimChannel(list, 40, undefined, (c) => c.command);
    expect(list.length).toBe(140);
    expect(kept).toHaveLength(40);
    // Not one no-op is among the forty that survive. This is the defect, reproduced.
    expect(kept!.filter((c) => c.command === NOOP)).toHaveLength(0);
  });

  it('…and the census names it, with its real count', () => {
    const { fact } = trimChannel(list, 40, undefined, (c) => c.command);
    expect(fact!.kept).toBe(40);
    expect(fact!.total).toBe(140);
    expect(fact!.head).toBe(20);
    expect(fact!.gapTop?.[0]).toEqual({ what: NOOP, n: 58 });
  });

  it('and the one sentence an admin reads now says so', () => {
    const { fact } = trimChannel(list, 40, undefined, (c) => c.command);
    const note = truncationNote({ commands: fact! });
    expect(note).toContain('40 of 140 sandbox commands');
    expect(note).toContain('100 from the middle are gone');
    expect(note).toContain('what repeated there');
    expect(note).toContain('×58');
  });
});

describe('🔒 an ordinary build pays nothing', () => {
  it('no repeat in the gap ⇒ no field at all (never an empty array, which would read as "no loop")', () => {
    const distinct = Array.from({ length: 140 }, (_, i) => ({ command: `npm run step-${i}` }));
    const { fact } = trimChannel(distinct, 40, undefined, (c) => c.command);
    expect(fact!.total).toBe(140);
    expect(fact!.gapTop).toBeUndefined();
    expect(gapShape(fact!)).toBe('');
    expect(truncationNote({ commands: fact! })).not.toContain('what repeated');
  });

  it('a list under the cap is untouched and says nothing', () => {
    const short = [{ command: 'npm ci' }, { command: 'npm run build' }];
    const { list, fact } = trimChannel(short, 40, undefined, (c) => c.command);
    expect(list).toHaveLength(2);
    expect(fact).toBeUndefined();
  });

  it('a caller that passes no summariser behaves exactly as before', () => {
    const before = trimChannel(build413d29a1(), 40);
    expect(before.fact?.gapTop).toBeUndefined();
    expect(before.fact?.kept).toBe(40);
    expect(before.fact?.total).toBe(140);
  });
});

describe('🔒 the census is bounded — it grows with the REPETITION, never with the gap', () => {
  it('a thing seen once is not a pattern', () => {
    expect(gapCensus([{ c: 'a' }, { c: 'b' }, { c: 'c' }], (x) => x.c)).toEqual([]);
    expect(gapCensus([{ c: 'a' }, { c: 'a' }], (x) => x.c)).toEqual([{ what: 'a', n: 2 }]);
  });

  it('at most GAP_TOP_MAX labels, commonest first, ties broken deterministically', () => {
    const many = [];
    for (let k = 0; k < 10; k++) for (let i = 0; i < k + 2; i++) many.push({ c: `cmd-${k}` });
    const top = gapCensus(many, (x) => x.c);
    expect(top).toHaveLength(GAP_TOP_MAX);
    expect(top[0].n).toBeGreaterThan(top[1].n);
    expect(gapCensus(many, (x) => x.c)).toEqual(top); // deterministic
  });

  it('a 10,000-entry gap of one repeat still costs ONE short row', () => {
    const huge = Array.from({ length: 10_000 }, () => ({ c: NOOP }));
    const top = gapCensus(huge, (x) => x.c);
    expect(top).toEqual([{ what: NOOP, n: 10_000 }]);
    expect(JSON.stringify(top).length).toBeLessThan(200);
  });

  it('a long label is capped, and whitespace is normalised so one command has one identity', () => {
    const long = 'x'.repeat(500);
    expect(gapCensus([{ c: long }, { c: long }], (x) => x.c)[0].what).toHaveLength(GAP_LABEL_MAX);
    expect(gapCensus([{ c: 'npm   ci\n' }, { c: 'npm ci' }], (x) => x.c)).toEqual([{ what: 'npm ci', n: 2 }]);
  });

  it('a summariser that throws or returns nothing never breaks a report', () => {
    expect(gapCensus([{ c: 'a' }, { c: 'a' }], () => { throw new Error('nope'); })).toEqual([]);
    expect(gapCensus([{ c: 'a' }, { c: 'a' }], () => '')).toEqual([]);
    expect(() => trimChannel(build413d29a1(), 40, undefined, () => { throw new Error('nope'); })).not.toThrow();
  });
});

describe('🔒 two passes censused two different slices, so the counts SUM', () => {
  it('the merge rule keeps both, because both describe real dropped entries', () => {
    expect(mergeGapTop([{ what: NOOP, n: 30 }], [{ what: NOOP, n: 25 }])).toEqual([{ what: NOOP, n: 55 }]);
    expect(mergeGapTop(undefined, [{ what: 'a', n: 3 }])).toEqual([{ what: 'a', n: 3 }]);
    expect(mergeGapTop([{ what: 'a', n: 3 }], undefined)).toEqual([{ what: 'a', n: 3 }]);
    expect(mergeGapTop(undefined, undefined)).toEqual([]);
  });

  it('…and the merged report carries it, rather than the later pass erasing the earlier count', () => {
    // Pass 1 (the recorder's own cap) saw the real total and censused what it dropped.
    const prior = mergeTruncation(undefined, { commands: { kept: 300, total: 1000, head: 150, gapTop: [{ what: NOOP, n: 400 }] } });
    // Pass 2 (the store) trims the survivors and censuses its own gap.
    const after = mergeTruncation(prior, { commands: { kept: 40, total: 300, head: 20, gapTop: [{ what: NOOP, n: 58 }] } });
    const f = after.channels!.commands;
    expect(f.total).toBe(1000);               // the earliest total still wins
    expect(f.kept).toBe(40);                  // the latest kept
    expect(f.gapTop).toEqual([{ what: NOOP, n: 458 }]); // and both censuses
    expect(after.note).toContain('×458');
  });

  it('a channel that lost nothing is still never listed, census or not', () => {
    const t = mergeTruncation(undefined, { commands: { kept: 40, total: 40, gapTop: [{ what: 'x', n: 2 }] } });
    expect(t.complete).toBe(true);
    expect(t.channels).toBeUndefined();
  });
});

describe('🔒 the store asks for the census on the two channels a loop lives in', () => {
  it('COMMANDS are censused; MODEL CALLS deliberately are not, and the reason is measured', () => {
    // 🔴 I FIRST CENSUSED BOTH, AND THE EXISTING SUITE PROVED THAT WRONG. A model call's prompt preview
    // is deduped by the recorder to the literal placeholder "[system prompt head identical to the
    // previous call]" — in build 413d29a1 that was 169 of 171 calls — so a census keyed on it fires on
    // essentially EVERY long build and reports "the model made many calls", which `total` already says.
    // A census that always fires is noise, and noise costs the same bytes as signal. Three pre-existing
    // tests broke on exactly that, which is how it was caught; the fix was to narrow the change, not to
    // relax them. Commands carry their own distinctive text, which is where a repeat is meaningful.
    const src = readFileSync('src/server/AgentV3/DiagnosticsStore.ts', 'utf8');
    const commands = src.slice(src.indexOf('const commands = trimChannel('), src.indexOf(';', src.indexOf('const commands = trimChannel(')));
    expect(commands).toContain('c.command');
    const llm = src.slice(src.indexOf('const llmCalls = trimChannel('), src.indexOf(';', src.indexOf('const llmCalls = trimChannel(')));
    expect(llm).not.toContain('promptPreview');
    expect(llm).not.toContain('=>'); // no summariser at all
    // And the decision is written where the next reader will meet it, not only here.
    expect(src).toMatch(/DELIBERATELY GETS NO CENSUS/);
  });

  it('the window shape still reads correctly with a census attached', () => {
    const f = { kept: 40, total: 140, head: 20, gapTop: [{ what: NOOP, n: 58 }] };
    expect(windowShape(f)).toContain('the first 20 and the last 20');
    expect(windowShape(f)).toContain('what repeated there');
    // A plain tail has no head to describe but still has a gap to report.
    expect(windowShape({ kept: 40, total: 140, gapTop: [{ what: NOOP, n: 58 }] })).toContain('what repeated there');
  });
});
