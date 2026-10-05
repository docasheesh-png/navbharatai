// Forensic audit 2026-10-04 (P1) — every Doctor AI answer carries what it cost, so a paid turn is charged.
//
// On the paid tier the Grok × Gemini race answers first, and it returned text only: `sdaSpend` stayed
// null, the charge decision read "unmeasured", and ₹0 was debited. The Vertex, free-Gemini and Claude
// fallbacks did the same. The balance never fell, so the wallet gate never refused: unlimited paid
// turns. Every branch that sets the reply now records the provider's own reported usage.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/server/routes/sda.ts', 'utf8');
const lines = src.split('\n');

describe('census: every provider answer in sda.ts records its usage', () => {
  it('each line that takes a reply from a provider is followed by a spend assignment', () => {
    const offenders: string[] = [];
    lines.forEach((line, i) => {
      if (!/\breply = /.test(line)) return;
      if (/let reply = ''/.test(line)) return;                    // the declaration
      if (/reply = reply\./.test(line)) return;                   // post-processing of an answer already measured
      if (/reply = (?:[A-Za-z]+Reply|directDoseReply|unknownNewbornDoseReply|vialRememberedMessage)\b/.test(line)) return; // deterministic, no model
      const window = lines.slice(i, i + 8).join('\n');
      if (!/sdaSpend = /.test(window)) offenders.push(`${i + 1}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  it('a racer returns its spend with its text, and the winner\'s spend is kept', () => {
    expect(src).toMatch(/type SdaRacerFn = \(signal: AbortSignal\) => Promise<\{ text: string; spend: ChatTurnUsage \}>/);
    expect(src).toMatch(/reply = sdaWinner\.text; sdaSpend = sdaWinner\.spend;/);
  });

  it('the route is rate-limited', () => {
    expect(src).toMatch(/app\.post\('\/api\/sda-chat', sdaLimiter,/);
  });
});
