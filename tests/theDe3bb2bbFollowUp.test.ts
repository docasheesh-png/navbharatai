/**
 * Autopsy de3bb2bb follow-up (admin decisions 2026-10-01): Q-065 small batches, Q-066 the sub-agent style
 * hand-back, Q-067 an unknown word is not a service, Q-068 one readiness warning per build.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_FILES_PER_BATCH, batchSizeNote } from '../src/server/AgentV3/batchSize';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { catalogForTools } from '../src/server/AgentV3/ToolCatalog';
import { scopeStyleHandBack, decideStyleResume } from '../src/server/AgentV3/stylePolishResume';
import { unknownNamesInRequest, unknownNameBuilderNote, unknownNameNoteEnabled } from '../src/server/AgentV3/unknownName';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import type { AgentEvent } from '../src/server/AgentV3/types';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Q-065 — a batch carries at most three new files', () => {
  it('the number is three, and one place owns it', () => {
    expect(MAX_FILES_PER_BATCH).toBe(3);
  });

  it('the prompt no longer tells the builder to pass every file in one call', () => {
    const prompt = architectSystemPrompt('vite-react');
    expect(prompt).not.toMatch(/pass all files in\s+one call/);
    expect(prompt).not.toMatch(/3× faster than calling\s+write_file/);
    expect(prompt).toContain(`at most ${MAX_FILES_PER_BATCH} new files per call`);
  });

  it('the tool description says the same thing', () => {
    const [tool] = catalogForTools(['write_files_batch']);
    expect(tool.description).toContain(`up to ${MAX_FILES_PER_BATCH} NEW files`);
    expect(tool.description).not.toMatch(/faster than/i);
  });

  it('the real case (7 files) is told to write fewer next time; a small batch is told nothing', () => {
    expect(batchSizeNote(7)).toContain('7 files');
    expect(batchSizeNote(7)).toContain(`at most ${MAX_FILES_PER_BATCH}`);
    expect(batchSizeNote(3)).toBe('');
    expect(batchSizeNote(1)).toBe('');
    expect(batchSizeNote(Number.NaN)).toBe('');
  });

  it('the dispatcher appends the note to the batch result (every file is still written)', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(src).toContain('${batchSizeNote(dedupedByPath.size)}');
  });
});

describe('Q-066 — a writing sub-agent gets the style hand-back, scoped to its own files', () => {
  const project = {
    'src/index.css': '.card { padding: 8px; }\n',
    'src/screens/Mine.tsx': 'export const A = () => <div className="card data-row">x</div>;',
    'src/screens/Sibling.tsx': 'export const B = () => <div className="chat-bubble">y</div>;',
  };

  it('a class only a SIBLING uses is not handed to this agent', () => {
    const scoped = scopeStyleHandBack(
      { missing: ['chat-bubble', 'data-row'], sheet: 'src/index.css', pages: [{ file: 'src/screens/Sibling.tsx', defects: ['bare-markup' as never] }], a11y: [{ file: 'src/screens/Sibling.tsx', issues: ['x'] }], offGrid: [] },
      project,
      new Set(['src/screens/Mine.tsx']),
    );
    expect(scoped.missing).toEqual(['data-row']);
    expect(scoped.pages).toEqual([]);
    expect(scoped.a11y).toEqual([]);
  });

  it('an agent that wrote nothing styled is handed nothing, so its turn ends as before', () => {
    const scoped = scopeStyleHandBack({ missing: ['chat-bubble'], pages: [] }, project, new Set(['src/screens/Mine.tsx']));
    const d = decideStyleResume({ text: 'Done.', missing: scoped.missing, pages: scoped.pages, resumesUsed: 0, producedFiles: true });
    expect(d.resume).toBe(false);
  });

  it('the runner holds the hand-back for sub-agents only, once, and the spawn turns it on for writers', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    expect(runner).toMatch(/ok && !readinessGate && this\.opts\.styleHandBack === true/);
    expect(runner).toContain('undefinedClassesNow({ onlyWritten: true })');
    // A specialist's "ready" reaches the chat too, so its hand-back says "not finished yet" (#3468's rule).
    const subBlock = runner.slice(runner.indexOf('this.opts.styleHandBack === true'), runner.indexOf('U-1 — LintGate'));
    expect(subBlock).toContain("handBackNotice('style', turn.text)");
    const sub = read('src/server/AgentV3/SubAgent.ts');
    expect(sub).toContain('styleHandBack: roleExpectsArtifacts(deps.toolsOverride ?? cfg.tools)');
    expect(sub).toContain('onNote: deps.onNote');
    const route = read('src/server/routes/agentv3.ts');
    const deps = route.slice(route.indexOf('const subAgentDeps: SubAgentDeps = {'), route.indexOf('const spawnSubAgent = makeSubAgentSpawn(subAgentDeps);'));
    expect(deps).toContain('onNote: (note');
  });
});

describe('Q-067 — a word we do not know is not a service to connect to', () => {
  it('the real prompt: COACT is named', () => {
    expect(unknownNamesInRequest('Ye yese app banao jo data COACT oar sake')).toEqual(['COACT']);
  });

  it('acronyms, known services and emphasis stand down', () => {
    expect(unknownNamesInRequest('GST billing app with PDF invoices and UPI QR')).toEqual([]);
    expect(unknownNamesInRequest('Shop with STRIPE checkout and RAZORPAY')).toEqual([]);
    expect(unknownNamesInRequest('Make a VERY simple todo app, BANAO JALDI')).toEqual([]);
    expect(unknownNamesInRequest('a hospital EMR with OPD and KOT')).toEqual([]);
  });

  it('a word the request itself names as a service is a real request, not a typo', () => {
    expect(unknownNamesInRequest('Build a dashboard that pulls orders from the ACME API')).toEqual([]);
    expect(unknownNamesInRequest('integrate with ACME for stock levels')).toEqual([]);
    expect(unknownNamesInRequest('ACME se connect karo aur data dikhao')).toEqual([]);
  });

  it('a request typed in capitals carries no signal in its case', () => {
    expect(unknownNamesInRequest('MAKE A TODO APP WITH DARK MODE')).toEqual([]);
  });

  it('the builder is told no client, no API URL, no env variable — and to say how it read the word', () => {
    const note = unknownNameBuilderNote(['COACT']);
    expect(note).toContain('"COACT"');
    expect(note).toMatch(/Do NOT build a client, an API URL/);
    expect(note).toContain('environment variable');
    expect(note).toMatch(/say in one short sentence how you read/);
    expect(unknownNameBuilderNote([])).toBe('');
  });

  it('kill switch', () => {
    expect(unknownNameNoteEnabled({ AGENTV3_UNKNOWN_NAME_NOTE: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(unknownNameNoteEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('the route hands it to the builder, the planner and the fast lane, on new builds only', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain("intent === 'new_build' && !isImportTurn && unknownNameNoteEnabled() ? unknownNamesInRequest(prompt) : []");
    expect(route).toContain('buildPrompt = `${unknownNameNote}');
    expect(route).toContain('const plannerGoalBase = unknownNameNote');
    expect(route).toContain('pastedBriefSuffix + unknownNameSuffix, framework');
  });
});

describe('Q-068 — one readiness warning per build', () => {
  it('two runners reporting the same warning record it once (the real case: "No tests at all" ×2)', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    const done = (ts: number) => ({ type: 'done', ok: true, summary: 'ok', ts, readiness: { score: 91, ready: true, blockers: [], warnings: ['No tests at all'] } } as unknown as AgentEvent);
    d.ingestEvent(done(1790860877094));
    // The real timeline has other lines between the two (READY_BEFORE_END, the integrity heal, …).
    d.record({ phase: 'build', severity: 'info', code: 'INTEGRITY_HEALED', message: 'Fixed the duplicate stylesheet import.', autoResolved: true });
    d.ingestEvent(done(1790860925513));
    expect(d.report().issues.filter((i) => i.code === 'READINESS_WARNING')).toHaveLength(1);
  });

  it('a different warning is still recorded', () => {
    const d = new BuildDiagnostics({ now: () => 1 });
    d.ingestEvent({ type: 'done', ok: true, summary: 'ok', ts: 1, readiness: { score: 91, ready: true, blockers: [], warnings: ['No tests at all'] } } as unknown as AgentEvent);
    d.record({ phase: 'build', severity: 'info', code: 'AGENT_STEP', message: 'between', autoResolved: true });
    d.ingestEvent({ type: 'done', ok: true, summary: 'ok', ts: 2, readiness: { score: 91, ready: true, blockers: [], warnings: ['No tests at all', 'no error boundary'] } } as unknown as AgentEvent);
    expect(d.report().issues.filter((i) => i.code === 'READINESS_WARNING').map((i) => i.message)).toEqual(['No tests at all', 'no error boundary']);
  });
});
