// Autopsy 0311186f (2026-10-04). The user pasted an assistant's reply about an automatic forex scalper —
// advice, the questions it asked them, example values — and added "App name ALGO". The engine:
//   • counted 18 features (questions and settings among them) and split it into 8 modules;
//   • classified it REAL ESTATE off "broker" and told the builder to add listings, a map and an EMI calculator;
//   • warned the user the summary "never mentions" the app they asked for — “**PERFECT level**”, a quoted term;
//   • promised 9–10 min for a turn that built one module in 1.9;
//   • said an unread picture was "a photo, not a UI design";
//   • told a "continue" that built module 2 "✏️ Editing your existing app".
// The prompt below is the report's own, verbatim.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { megaProjectSignals } from '../src/server/AgentV3/ProjectPlan';
import { enumeratedFeatureItems } from '../src/server/AgentV3/enumeratedFeatures';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { offTopicSummaryNotice, quotedAppName } from '../src/server/AgentV3/offTopicSummary';
import { moduleTurnEtaLine } from '../src/server/AgentV3/moduleTurnEta';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const PROMPT = readFileSync(join(__dirname, 'fixtures/report0311186fPrompt.txt'), 'utf8');
const ROUTE = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('questions and settings are not features', () => {
  it('the report prompt is no longer a mega project', () => {
    const sig = megaProjectSignals(PROMPT);
    expect(sig.fires).toBe(false);
    expect(sig.features).toBeLessThan(14);
  });

  it('a question, an assignment and a labelled value are not counted; a named part still is', () => {
    const items = enumeratedFeatureItems('- Timeframe scalping? (1m / 5m?)\n- SL = 0.25% (example)\n- **Daily stop:** -2% account equity\n- Price alerts\n- Trade journal\n- Login: email and password');
    expect(items).toEqual(['price alerts', 'trade journal', 'login: email and password']);
  });
});

describe('a trading app is a trading app', () => {
  it('the report prompt is trading, not real estate', () => {
    const r = analyzeRequirementGaps(PROMPT);
    expect(r.domain).toBe('trading');
    expect(r.likelyMissing.join(' ')).not.toMatch(/property|mortgage|map view/i);
  });

  it('a property broker still reads as real estate', () => {
    expect(analyzeRequirementGaps('Build an app for a property broker to list flats for rent with photos').domain).toBe('real-estate');
  });
});

describe('a quoted term is not the app name', () => {
  it('“**PERFECT level**” is not a name, so the summary is not flagged', () => {
    expect(quotedAppName(PROMPT)).toBeNull();
    expect(offTopicSummaryNotice(PROMPT, '✅ Module complete — constants and types are ready.')).toBeNull();
  });

  it('a quote the sentence calls a name still is one', () => {
    expect(quotedAppName('Build an app called “Shiv Medical Store” for my shop')).toBe('Shiv Medical Store');
    expect(quotedAppName('make the “Daily Expense Diary” app')).toBe('Daily Expense Diary');
  });
});

describe('a module turn withdraws the whole-app ETA', () => {
  it('the line names the module and makes no new promise', () => {
    const line = moduleTurnEtaLine(1, 8, 'Data Access Layer');
    expect(line).toContain('module 2 of 8');
    expect(line).toContain('Data Access Layer');
    expect(line).not.toMatch(/\d+\s*min/);
  });

  it('the accuracy verdict is not computed against a withdrawn promise', () => {
    const d = new BuildDiagnostics();
    d.setEtaPromise({ estimateMs: 570_000, lowMs: 555_000, highMs: 592_000, evidenced: true });
    d.withdrawEtaPromise();
    expect((d.report() as { etaAccuracy?: unknown }).etaAccuracy).toBeUndefined();
  });

  it('the route withdraws it when a module turn is chosen', () => {
    expect(ROUTE).toMatch(/buildDiag\.withdrawEtaPromise\(\);\s*\n\s*events\.emit\(\{ type: 'narration', agent: 'architect', text: moduleTurnEtaLine\(/);
  });
});

describe('the report says what it knows', () => {
  it('an unread picture is never classified as a photo', () => {
    expect(ROUTE).toMatch(/picturesSetAside = images\.length > 0 && fate === 'read' && !pictureIsSpec/);
  });

  it('a "continue" that builds the next module is not an edit of an existing app', () => {
    expect(ROUTE).toMatch(/if \(!continuesPlan\) events\.emit\(\{[\s\S]{0,120}Editing your existing app/);
  });
});
