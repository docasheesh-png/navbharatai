/**
 * Autopsy a4be7fa2 + 3f959fde (2026-10-01): a Telugu user attached a Kerala-lottery spreadsheet and asked
 * which algorithm suits the data. Every item below is the real report's fact, locked as a class.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerAfterPlanning, looksLikeSelfInstruction } from '../src/server/AgentV3/answerAfterPlanning';
import { parseNpmAuditSummary, npmAuditNote, npmSaysNoFix, noFixPackageNames } from '../src/server/AgentV3/npmAuditSummary';
import { countEnumeratedFeatures, isDataValue } from '../src/server/AgentV3/enumeratedFeatures';
import { condenseDataTables, planningRequest } from '../src/server/AgentV3/planningRequest';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { dataEntryEvidence, unreferencedComponents } from '../src/server/AgentV3/journeyDerivation';
import { packageChoiceRule } from '../src/server/lib/unfixablePackages';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { repeatedReadSummary } from '../src/server/AgentV3/repeatedReads';
import { decideUnfinishedResume } from '../src/server/AgentV3/unfinishedResume';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// The build's final reply, verbatim up to the start of the answer.
const LEAKED = 'Now final summary. No more tools. \n\nMake it concise. In Telugu/English mix.\n\n'
  + '"Ee data ki suitable algorithm enti?" answer clearly.\n\n'
  + 'Mention where to add full dataset. Also warn about xlsx advisory? Maybe not in final. But it\'s useful. I\'ll mention briefly.\n\n'
  + 'Proceed. \n\n\n\n'
  + '🎟️ **Kerala Lottery Analyzer ready.**\n\nMee xlsx file upload cheste, app automatic ga ee stats chupistundi:\n\n'
  + '- Total draws, first/last draw dates, missing dates, average gap\n- Digit 0–9 frequency bar chart';

describe('a model\'s notes to itself are not its answer', () => {
  it('the real reply loses its planning preamble and keeps the whole answer', () => {
    const out = answerAfterPlanning(LEAKED);
    expect(out.startsWith('🎟️ **Kerala Lottery Analyzer ready.**')).toBe(true);
    expect(out).not.toContain('No more tools');
    expect(out).not.toContain('Proceed.');
    expect(out).toContain('Digit 0–9 frequency bar chart');
  });

  it('🔒 an ordinary answer with blank lines is returned exactly as it came', () => {
    const answer = 'Your app is ready.\n\n\n\nOpen the Preview tab to see it. I\'ll mention one thing: it saves to this device.';
    expect(answerAfterPlanning(answer)).toBe(answer);
  });

  it('🔒 one self-instruction phrase is not enough', () => {
    const t = 'Proceed.\n\n\n\nHere is the summary of what I built for you, with every screen listed.';
    expect(answerAfterPlanning(t)).toBe(t);
  });

  it('🔒 a structured opening is an answer, never a preamble', () => {
    const t = '## Final summary\n- No more tools needed\n- I\'ll mention the limits\n\n\n\nEverything works as asked.';
    expect(looksLikeSelfInstruction(t.split('\n\n\n\n')[0])).toBe(false);
    expect(answerAfterPlanning(t)).toBe(t);
  });

  it('🔒 nothing is cut when the remainder is not a real answer', () => {
    const t = 'Final summary. No more tools.\n\n\n\nOk.';
    expect(answerAfterPlanning(t)).toBe(t);
  });

  it('the runner applies it to reply turns before the narration and the summary read the text', () => {
    const src = strip(read('src/server/AgentV3/AgentRunner.ts'));
    const at = src.indexOf('const answer = answerAfterPlanning(turn.text);');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at - 120, at)).toContain('turn.toolUses.length === 0');
    expect(src.indexOf("events.emit({ type: 'narration', agent: agentRole, text: turn.text")).toBeGreaterThan(at);
  });
});

// npm's real output from that build.
const AUDIT_FIX = '\nadded 2 packages, and audited 84 packages in 1s\n\n13 packages are looking for funding\n  run `npm fund` for details\n\n'
  + '# npm audit report\n\nxlsx  *\nSeverity: high\nPrototype Pollution in sheetJS - https://github.com/advisories/GHSA-4r6h-8v6p-xvw6\n'
  + 'SheetJS Regular Expression Denial of Service (ReDoS) - https://github.com/advisories/GHSA-5pgg-2g8v-p4x9\nNo fix available\nnode_modules/xlsx\n\n'
  + '1 high severity vulnerability\n\nSome issues need review, and may require choosing\na different dependency.\n';
const INSTALL = '\nadded 81 packages, and audited 82 packages in 13s\n\n12 packages are looking for funding\n  run `npm fund` for details\n\n'
  + '1 high severity vulnerability\n\nSome issues need review, and may require choosing\na different dependency.\n\nRun `npm audit` for details.\n';

describe('"No fix available" is never told as "a major upgrade fixes it"', () => {
  it('the real audit output: no fix, and the package is named', () => {
    const s = parseNpmAuditSummary(AUDIT_FIX)!;
    expect(s.total).toBe(1);
    expect(s.noFix).toBe(true);
    expect(s.noFixPackages).toEqual(['xlsx']);
    const note = npmAuditNote(s, { compatibleFixAlreadyRun: true })!;
    expect(note).toContain('no release of `xlsx`');
    expect(note).toContain('replace that package');
    expect(note).not.toContain('major-version upgrade');
  });

  it('the install output alone already says so', () => {
    const s = parseNpmAuditSummary(INSTALL)!;
    expect(s.noFix).toBe(true);
    expect(noFixPackageNames(INSTALL)).toEqual([]);
    expect(npmAuditNote(s)).toContain('no release of the affected package');
  });

  it('🔒 when npm offers a fix, the ordinary advice stands', () => {
    const mixed = `${INSTALL}\nTo address issues that do not require attention, run:\n  npm audit fix\n`;
    expect(npmSaysNoFix(mixed)).toBe(true);
    expect(parseNpmAuditSummary(mixed)!.noFix).toBeUndefined();
    expect(npmAuditNote(parseNpmAuditSummary(mixed))).toContain('Running `npm audit fix` applies');
  });
});

const ROWS = Array.from({ length: 400 }, (_, i) => `20${12 + Math.floor(i / 50)}-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z,${100000 + i * 37}`);
const ATTACHMENT = ['[Attached file: Kerala_Lottery_First_Prize_6Digit_FULL_2012_2026.xlsx]', '```', '# Sheet: First Prize 6 Digit', 'Date,1st Prize 6 Digit', ...ROWS, '```'].join('\n');
const PROMPT = 'Ipudu e data ni check cheyu e algorithm suitable check cheyu';

describe('a data file is data, not a feature list', () => {
  it('a timestamp or a number is a value, never a feature — names with a digit still count', () => {
    expect(isDataValue('2012-01-01T00:00:00.000Z')).toBe(true);
    expect(isDataValue('MP3 player')).toBe(false);
    expect(countEnumeratedFeatures(ROWS.slice(0, 20).join('\n'))).toBe(0);
    // Values written inline (a date list pasted into a message) counted one feature each before the fix.
    expect(countEnumeratedFeatures(ROWS.slice(0, 20).join(', '))).toBe(0);
    expect(countEnumeratedFeatures('notes, 2FA login, QR code scanner, MP3 player, reminders')).toBeGreaterThanOrEqual(4);
  });

  it('the table is condensed to its header and size; the rest is left as written', () => {
    const c = condenseDataTables(ATTACHMENT);
    expect(c.tables).toBe(1);
    expect(c.rows).toBe(401);
    expect(c.text).toContain('[data table: 401 rows × 2 columns, first row: Date,1st Prize 6 Digit]');
    expect(c.text).toContain('# Sheet: First Prize 6 Digit');
    expect(c.text.length).toBeLessThan(400);
  });

  it('🔒 a spec written as lines is never condensed', () => {
    const spec = '- login, signup\n- dashboard with charts, filters, export\n- billing, invoices\n- settings\n- reports, PDF, email';
    expect(condenseDataTables(spec).tables).toBe(0);
    const words = Array.from({ length: 6 }, () => 'Students, Teachers, Fees').join('\n');
    expect(condenseDataTables(words).tables).toBe(0);
  });

  it('the real request now sizes as a question about data, not a 40-feature app', () => {
    const planning = planningRequest({ prompt: PROMPT, attachmentText: ATTACHMENT, userAppExists: false });
    expect(planning.text).toContain('data to work with, not a list of features to build');
    expect(planning.sizing).not.toContain('[');
    expect(planning.sizing).not.toContain('```');
    expect(analyzeAppScope(planning.sizing).decision).toBe('direct');
    expect(analyzeRequest({ prompt: planning.sizing }).complexityScore).toBeLessThan(40);
    // The label that made it score as a complex app before the fix is locked in its own test below.
  });
});

describe('our own label is never read as the user\'s words', () => {
  it('the old attachment label alone made a question score as a complex app', () => {
    const labelled = `${PROMPT}\n\n[The user attached file(s) with this message. Their content describes what to build:]`;
    expect(analyzeRequest({ prompt: labelled }).taskType).toBe('complex_app');
    const planning = planningRequest({ prompt: PROMPT, attachmentText: 'Date,Prize', userAppExists: false });
    expect(planning.text).toContain('[The user attached');
    expect(analyzeRequest({ prompt: planning.sizing }).taskType).not.toBe('complex_app');
  });

  it('earlier requests reach the sizers without their label', () => {
    const planning = planningRequest({ prompt: 'add login', recentTurns: [{ text: 'build a hospital management system', lane: 'build' }], userAppExists: false });
    expect(planning.text).toContain('[Earlier in this conversation');
    expect(planning.sizing).toBe('add login\n\nbuild a hospital management system');
  });

  it('every deterministic sizer in the route reads the sizing text', () => {
    const route = strip(read('src/server/routes/agentv3.ts'));
    for (const reader of ['complexityFromPrompt', 'analyzeAppScope', 'detectMegaProject', 'sharedDataNeed']) {
      expect(route).not.toMatch(new RegExp(`${reader}\\(planning\\.text\\)`));
    }
    expect(route).not.toMatch(/analyzeRequest\(\{ prompt: planning\.text/);
  });
});

describe('a screen nothing shows is not the app', () => {
  const files = {
    'src/main.tsx': "import App from './App';",
    'src/App.tsx': "import { LotteryStats } from './components/LotteryStats';\nexport default function App() { return <LotteryStats />; }",
    'src/components/LotteryStats.tsx': 'export function LotteryStats() { return <div>stats</div>; }',
    'src/components/DataPreview.tsx': 'export function DataPreview() { return <select aria-label="column"><option>a</option></select>; }',
  };

  it('the orphan DataPreview is set aside, and it no longer names the app as taking input', () => {
    expect([...unreferencedComponents(files)]).toEqual(['src/components/DataPreview.tsx']);
    expect(dataEntryEvidence(files)).toBeNull();
  });

  it('🔒 an imported component with a form still counts', () => {
    const wired = { ...files, 'src/App.tsx': `${files['src/App.tsx']}\nimport { DataPreview } from './components/DataPreview';` };
    expect(dataEntryEvidence(wired)?.path).toBe('src/components/DataPreview.tsx');
  });
});

describe('the builder hears which packages not to install before it installs them', () => {
  it('xlsx is named with exceljs, in the architect prompt and in every writing specialist', () => {
    expect(packageChoiceRule()).toContain('`xlsx`');
    expect(packageChoiceRule()).toContain('exceljs');
    expect(architectSystemPrompt('vite-react')).toContain(packageChoiceRule());
    expect(strip(read('src/server/AgentV3/SubAgent.ts'))).toContain('contextBlocks.push(packageChoiceRule())');
  });
});

describe('the read report counts only what the reader already held', () => {
  it('the worst list names unchanged re-reads beside the total', () => {
    const line = repeatedReadSummary(new Map([['src/index.css', 7], ['src/App.tsx', 4], ['a.ts', 1]]), new Map([['src/index.css', 2], ['src/App.tsx', 3], ['a.ts', 0]]));
    expect(line).toContain('src/App.tsx (3 unchanged of 4 reads)');
    expect(line).toContain('src/index.css (2 unchanged of 7 reads)');
    expect(line.indexOf('src/App.tsx')).toBeLessThan(line.indexOf('src/index.css'));
  });

  it('the dispatcher counts a re-read as wasted only when THIS agent already held it', () => {
    const src = strip(read('src/server/AgentV3/ToolDispatcher.ts'));
    expect(src).toContain('const unchangedRereads = (prior?.unchangedRereads ?? 0) + (ownUnchanged && !(ownCount === 2 && own?.handed === true) ? 1 : 0);');
  });
});

describe('route wiring', () => {
  const route = strip(read('src/server/routes/agentv3.ts'));

  it('an edit of a workspace holding only our starter runs as a fresh build', () => {
    expect(route).toContain("const editOfStarterCandidate = intent === 'edit_existing' && !hasImportIntent && !isImportTurn;");
    const at = route.indexOf('if (editOfStarterCandidate) {');
    expect(at).toBeGreaterThan(0);
    expect(route.slice(at, at + 160)).toContain("intent = 'new_build';");
    expect(route.slice(at, at + 160)).toContain('isEditMode = false;');
  });

  it('a specialist is handed the request with what came with it', () => {
    expect(route).toContain('userRequest: () => planning.text,');
  });

  it('a planned fast-lane hand-off is not reported as BUILD_FAILED', () => {
    expect(route).toContain('const plannedHandoff = !sb.ok && !sb.stopped && fastLaneReasoningRung !== null;');
    expect(route).toContain("'Fast-lane outcome: a planned hand-off to the full builder — not a failure.'");
  });
});

describe('a need of the user\'s goes to the user', () => {
  it('the resume tells the model to ask the user, not to describe asking', () => {
    const d = decideUnfinishedResume({ text: 'Data lekunda em cheyalemu.', blockers: ['entry is still the starter'], resumesUsed: 0 });
    expect(d.resume).toBe(true);
    expect(d.message).toContain('ask THEM for it');
  });
});
