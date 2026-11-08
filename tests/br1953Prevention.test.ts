import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { examPrepAppTsx } from '../src/server/AgentV3/goldenScaffolds/indiaApps';
import { GOLDEN_SCAFFOLDS, goldenScaffoldForPrompt, goldenBuildPrompt, goldenQuestionReviewIssue, EXAM_REVIEW_CONTRACT } from '../src/server/AgentV3/goldenScaffolds/registry';
import { verbatimTemplateSkipsModel } from '../src/server/AgentV3/templateVerify';
import { STARTER_TEMPLATES } from '../src/components/agentv3/starterTemplates';
import { goldenComponentHarness } from './helpers/goldenComponentHarness';
import { makeSubAgentSpawn } from '../src/server/AgentV3/SubAgent';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

// Verbatim BR1953 request; do not silently substitute a different chip or ratings requirement.
const PROMPT = 'Build a mock test app for Indian competitive exam practice: a sectioned paper (General Knowledge, Reasoning, Quantitative Aptitude, English), one timer for the whole paper, four options per question, mark-for-review, a question palette to jump between questions, and negative marking of 0.25 for every wrong answer. Show a result screen with the section-wise score and a review of every question, and keep past attempts in the browser. Mobile-first, light/dark mode.';
const INTENT = "Now I understand the current implementation. The app is a complete mock test application with sections, timer, question navigation, and result display. However, it doesn't have a review/rating system yet, which is what we need to implement.\n\nBased on the requirements, I need to add reviews/ratings functionality. Let me think about how to implement this effectively:\n\n1. Users should be able to rate/review questions after completing the test\n2. Reviews should be saved and displayed in the result screen\n3. We should maintain past reviews in localStorage\n\nLet me update the app to include reviews/ratings functionality:\n\n";
let app: ReturnType<typeof goldenComponentHarness> | undefined;
const data = new Map<string, string>();
let visible: () => void = () => {};
function open(history?: unknown) {
  data.clear(); if (history !== undefined) data.set('exam-attempts-v1', JSON.stringify(history));
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  vi.stubGlobal('document', { addEventListener: (_: string, f: () => void) => { visible = f; }, removeEventListener: () => { visible = () => {}; } });
  app = goldenComponentHarness(examPrepAppTsx); return app;
}
afterEach(() => { app?.dispose(); app = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
const attempts = () => JSON.parse(data.get('exam-attempts-v1') ?? '[]');

describe('BR1953 shipped exam source: one scoring rule and an actual whole-paper deadline', () => {
  it('every section applies -0.25 per wrong answer; section scores add to the paper score', () => {
    const a = open(); a.click('Start test'); a.click('A. Article 14'); a.click('Go to question 5'); a.click('B. 38'); a.click('Submit paper');
    expect(a.text()).toContain('General Knowledge-0.25 / 4');
    expect(a.text()).toContain('Reasoning1 / 3'); expect(a.text()).toContain('Quantitative Aptitude0 / 3');
    expect(attempts()[0]).toMatchObject({ score: 0.75, correct: 1, wrong: 1, skipped: 10 });
    expect(a.text()).toContain('Answer: Article 17 · you chose Article 14');
    expect(a.nodes().filter(n => n.props.className === 'badge' && n.props.children === 'Skipped')).toHaveLength(10);
  });
  it.each([true, false])('all twelve questions expose four options and score a complete %s-correct paper consistently', correct => {
    const a = open(); a.click('Start test');
    const answers = [1,2,2,1,1,0,1,2,1,1,2,1];
    for (let i=0;i<answers.length;i++) {
      a.click('Go to question ' + (i+1));
      const options=a.nodes().filter(n=>n.type==='button' && /^[A-D]\. /.test(a.textOf(n)));
      expect(options).toHaveLength(4);
      options[correct ? answers[i] : (answers[i]+1)%4].props.onClick(); a.flush();
    }
    a.click('Submit paper'); expect(attempts()[0]).toMatchObject({score:correct?12:-3,correct:correct?12:0,wrong:correct?0:12,skipped:0});
    expect(a.text()).toContain('General Knowledge'+(correct?4:-1)+' / 4');
    expect(a.text()).toContain('English'+(correct?2:-0.5)+' / 2');
    a.click('Back to start'); const saved=attempts(); a.dispose(); app=undefined;
    const reload=open(saved); expect(reload.text()).toContain('Past attempts'); expect(attempts()).toEqual(saved);
  });
  it('an all-skipped paper has zero, not negative marks', () => {
    const a = open(); a.click('Start test'); a.click('Submit paper');
    expect(attempts()[0]).toMatchObject({ score: 0, wrong: 0, skipped: 12 });
  });
  it('a throttled background callback uses elapsed wall time, not one tick; navigation cannot reset it', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    const a = open(); a.click('Start test');
    vi.setSystemTime(1000000 + 61000); vi.advanceTimersByTime(1000); a.flush();
    expect(a.text()).toContain('08:58'); a.click('Go to question 8'); expect(a.text()).toContain('08:58');
    vi.setSystemTime(1000000 + 600000); visible(); a.flush();
    expect(a.text()).toContain('Result'); expect(attempts()).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
    a.click('Back to start'); a.click('Start test'); expect(a.text()).toContain('10:00');
  });
  it('no answer can enter after the deadline but before the next browser interval callback', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000000);
    const a = open(); a.click('Start test'); vi.setSystemTime(1600000); a.click('B. Article 17');
    expect(a.text()).toContain('Result'); expect(attempts()[0]).toMatchObject({ score: 0, skipped: 12 });
  });
  it('a submit/expiry or repeated-click race saves exactly one attempt, and a new paper can still submit', () => {
    const a = open(); a.click('Start test'); const submit = a.button('Submit paper').props.onClick;
    submit(); submit(); a.flush(); expect(attempts()).toHaveLength(1);
    a.click('Back to start'); a.click('Start test'); a.click('Submit paper'); expect(attempts()).toHaveLength(2);
  });
  it('answered and current questions retain a visible and accessible mark-for-review', () => {
    const a = open(); a.click('Start test'); a.click('B. Article 17'); a.click('Mark for review');
    const marked = a.button('Go to question 1 — marked for review'); expect(marked.props.children).toContain(' ⚑');
    a.click('Next'); expect(a.button('Go to question 1 — marked for review')).toBeDefined();
    a.click('Go to question 1 — marked for review'); a.click('Unmark'); expect(a.button('Go to question 1').props.children).not.toContain(' ⚑');
  });
  it('mixed corrupt browser history cannot crash render or poison the best score; valid older attempts survive', () => {
    const good = { at: '2026-01-01T00:00:00.000Z', score: -0.25, max: 3, correct: 0, wrong: 1, skipped: 2 };
    const a = open([null, {}, { ...good, at: 'bad' }, { ...good, score: 'NaN' }, { ...good, wrong: -1 }, good]);
    expect(a.text()).toContain('Best so far: -0.25'); expect(a.text()).not.toContain('NaN'); expect(attempts()).toEqual([good]);
    a.click('Clear history'); expect(attempts()).toEqual([]);
  });
  it.each([{}, 'not-an-array', 9])('non-array persisted history is safe: %s', bad => { expect(open(bad).text()).not.toContain('Past attempts'); });
  it('storage unavailable/private mode remains a working exam', () => {
    open(); app!.dispose(); vi.stubGlobal('localStorage', { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } });
    app = goldenComponentHarness(examPrepAppTsx); app.click('Start test'); app.click('Submit paper'); expect(app.text()).toContain('Result');
  });
  it('census: every exam-attempt/negative-marking golden entry runs this tested shared source', () => {
    const exams = GOLDEN_SCAFFOLDS.filter(g => g.appTsx.includes('exam-attempts-v1'));
    expect(exams.map(g => g.id)).toEqual(['exam-prep']); expect(exams[0].appTsx).toBe(examPrepAppTsx);
  });
});

describe('BR1953 review-domain contract, including the admitted Surplus path', () => {
  it('the retained input really is this exact chip, but Surplus must NOT silently skip the model', () => {
    expect(STARTER_TEMPLATES.find(t => t.id === 'exam-prep')!.prompt).toBe(PROMPT);
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: PROMPT, surplusAdmitted: true, env: {} })).toBe(false);
    expect(verbatimTemplateSkipsModel({ preseeded: true, tier: 'simple', prompt: PROMPT, env: {} })).toBe(true);
  });
  it('the actual seed prompt binds question review before the model chooses changes', () => {
    expect(goldenBuildPrompt(goldenScaffoldForPrompt(PROMPT)!, PROMPT)).toContain(EXAM_REVIEW_CONTRACT);
  });
  it.each([INTENT, 'I will add reviews/ratings functionality.', 'interface Review { rating: number; }', 'setRating(5)'])('refuses the evidenced competing rating product: %s', proposal => {
    expect(goldenQuestionReviewIssue(PROMPT, proposal)).toContain('Not run');
  });
  it.each(['Fix section-wise negative marking.', 'Show the chosen and correct answer for every question.', 'Do not add ratings; fix section scores.', 'Never implement star ratings. Keep answer review.', 'Do not add a rating system; fix scores.', 'Do not add reviews and ratings; retain question review.'])('retains legitimate requested work: %s', proposal => {
    expect(goldenQuestionReviewIssue(PROMPT, proposal)).toBeNull();
  });
  it('new code is checked, while removing old rating code and opaque non-exam payloads stay safe', () => {
    expect(goldenQuestionReviewIssue(PROMPT, 'Repair question review.', {new_string:'interface Review { rating: number; }'})).toContain('Not run');
    expect(goldenQuestionReviewIssue(PROMPT, 'Remove unrequested feedback.', {old_string:'interface Review { rating: number; }',new_string:''})).toBeNull();
    expect(goldenQuestionReviewIssue('Build an invoice app.', 'Add ratings.', { get content() { throw Error('must not inspect'); } })).toBeNull();
  });
  it('explicit user extensions and non-exam review apps keep their own authority', () => {
    expect(goldenQuestionReviewIssue(PROMPT + ' Add question star ratings.', INTENT)).toBeNull();
    expect(goldenQuestionReviewIssue('Build a customer reviews and ratings app.', INTENT)).toBeNull();
    expect(goldenBuildPrompt(goldenScaffoldForPrompt(PROMPT)!, PROMPT, 'Add question star ratings.')).toContain("the user's addition wins");
  });
});

function runFixture(options: { stopAfterReady?: boolean; proposal?: string; guard?: boolean; earlyStop?: boolean; failAfterReady?: boolean; toolInput?: Record<string, unknown>; scopePrompt?: string }) {
  const ac = new AbortController(); const events = new AgentEventStream(); const notes: string[] = []; const dispatched: string[] = []; let calls = 0;
  const client: MessagesCreateClient = { messages: { create: async () => {
    calls++;
    if (options.earlyStop) { ac.abort(); throw Error('cancelled'); }
    if (options.stopAfterReady && calls === 21) { ac.abort(); throw Error('cancelled'); }
    if (options.failAfterReady && calls === 21) throw Error('synthetic fatal');
    if (options.proposal && calls > 1) return { content: [{type:'text',text:'Stopped without making that change.'}], stop_reason:'end_turn', usage:{input_tokens:1,output_tokens:1} } as never;
    return { content: [{type:'text',text:options.proposal ?? 'Checking the requested paper.'}, {type:'tool_use',id:'t'+calls,name:'edit_file',input:options.toolInput ?? {path:'src/App.tsx',old_string:'x',new_string:'y'}}], stop_reason:'tool_use', usage:{input_tokens:1,output_tokens:1} } as never;
  } } };
  const dispatcher = { dispatch: async (tu: {id:string;name:string}) => { dispatched.push(tu.name); return {tool_use_id:tu.id,content:'ok',is_error:false}; }, changeCount:()=>dispatched.length, wroteAnything:()=>true,
    assessBuildReadiness:async()=>({score:100,ready:true,blockers:[],warnings:[],tier:'production'}), lastTypecheckErrorCount:()=>0, undefinedClassesNow:async()=>[] };
  const runner = new AgentRunner({client:new ClaudeClient(client), dispatcher:dispatcher as never, events,state:new WorkspaceState(events),model:'m',system:'s',tools:defaultToolCatalog(),signal:ac.signal,maxSteps:22,
    requestActionIssue: options.guard ? (p,input)=>goldenQuestionReviewIssue(options.scopePrompt ?? PROMPT,p,input) : undefined,onNote:n=>notes.push(n.code)});
  return { result:runner.run(PROMPT), dispatched, notes };
}

describe('production AgentRunner boundaries: refusal and readiness attribution survive cancellation', () => {
  it('refuses the actual contradictory edit before dispatch, not just a prompt suggestion', async () => {
    const f = runFixture({proposal:INTENT,guard:true}); await f.result; expect(f.dispatched).toEqual([]); expect(f.notes).toContain('REQUEST_SCOPE_REFUSED');
  });
  it('a real writer specialist inherits the original-user guard before any actuator write', async () => {
    let calls=0; const events=new AgentEventStream(); const writeFile=vi.fn(async()=>{});
    const client: MessagesCreateClient={messages:{create:async()=> (++calls===1 ? {
      content:[{type:'text',text:INTENT},{type:'tool_use',id:'child-write',name:'write_file',input:{path:'src/ratings.ts',content:'export const rating = 5;'}}],stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1},
    } : {content:[{type:'text',text:'No rating change was made.'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}) as never}};
    const spawn=makeSubAgentSpawn({client:new ClaudeClient(client),workspaceId:'br1953-scope-child',events,state:new WorkspaceState(events),model:'m',maxSteps:2,
      actuator:{readFile:async()=>{throw Error('ENOENT');},writeFile,listFiles:async()=>[],runCommand:async()=>({exitCode:0,stdout:'',stderr:''})},
      requestActionIssue:(p,input)=>goldenQuestionReviewIssue(PROMPT,p,input)});
    await spawn('frontend','Implement the original mock-test request.'); expect(writeFile).not.toHaveBeenCalled();
  });
  it('the real mutation boundary permits removal of an unwanted old rating field', async () => {
    const f=runFixture({proposal:'Remove the unwanted feedback field.',guard:true,toolInput:{path:'src/App.tsx',old_string:'rating: number;',new_string:''}});
    await f.result; expect(f.dispatched).toEqual(['edit_file']);
  });
  it('an unrelated app does not serialize/copy or inspect a large opaque tool body for this scope check', async () => {
    const input={path:'src/App.tsx',get content():string {throw Error('unnecessary payload traversal');}};
    const f=runFixture({proposal:'Update the invoice.',guard:true,scopePrompt:'Build an invoice app.',toolInput:input});
    await f.result; expect(f.dispatched).toEqual(['edit_file']);
  });
  it('legitimate score edits remain dispatchable', async () => {
    const f = runFixture({proposal:'Fix section-wise negative marking.',guard:true}); await f.result; expect(f.dispatched).toEqual(['edit_file']);
  });
  it('Stop after the real cadence done scan preserves the first measurement without changing ok:false', async () => {
    const f = runFixture({stopAfterReady:true}); const r = await f.result; expect(r.ok).toBe(false); expect(r.readyAt).toMatchObject({step:10,score:100});
  });
  it('Stop before any done scan never fabricates readiness', async () => { const r = await runFixture({earlyStop:true}).result; expect(r.ok).toBe(false); expect(r.readyAt).toBeUndefined(); });
  it('census: every direct run-result exit carrying measured usage also preserves the readiness field', () => {
    const src = readFileSync('src/server/AgentV3/AgentRunner.ts','utf8'); const ast = ts.createSourceFile('runner.ts',src,ts.ScriptTarget.Latest,true); let count=0;
    function visit(n: ts.Node) {
      if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
        const code=n.expression.getText(ast);
        if (/\busage\b/.test(code) && /billedUsd: billed\(\)/.test(code)) { count++; expect(code).toContain('readyAt: readyMark'); }
      }
      ts.forEachChild(n,visit);
    }
    visit(ast); expect(count).toBeGreaterThanOrEqual(10);
    let declaration:ts.VariableDeclaration|undefined;
    function mark(n:ts.Node) { if(ts.isVariableDeclaration(n) && n.name.getText(ast)==='readyMark') declaration=n; ts.forEachChild(n,mark); }
    mark(ast); expect(declaration).toBeDefined();
    for(let parent=declaration!.parent;parent;parent=parent.parent) expect(ts.isForStatement(parent)).toBe(false);
  });
  it.each([
    ['new_build', false, undefined, true], ['new_build', false, 123, false], ['new_build', true, undefined, false], ['edit', false, undefined, false],
  ])('original-chip guard respects real later user authority: %s %s %s', (intent, isEditMode, lastSteerAt, refused) => {
    const route=readFileSync('src/server/routes/agentv3.ts','utf8');
    const ast=ts.createSourceFile('route.ts',route,ts.ScriptTarget.Latest,true); let expression='';
    function visit(n: ts.Node) { if(ts.isVariableDeclaration(n) && n.name.getText(ast)==='requestActionIssue') expression=n.initializer!.getText(ast); ts.forEachChild(n,visit); }
    visit(ast); expect(expression).not.toBe('');
    const js=ts.transpileModule('const f = '+expression+'; exports.f=f;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const out: {f?:(p:string)=>string|null}={};
    new Function('exports','intent','isEditMode','rb','originalPrompt','goldenQuestionReviewIssue',js)(out,intent,isEditMode,{lastSteerAt},PROMPT,goldenQuestionReviewIssue);
    expect(Boolean(out.f!(INTENT))).toBe(refused);
  });
  it('production route binds the ORIGINAL new-build request, not a generated replacement or chat turn', () => {
    const route=readFileSync('src/server/routes/agentv3.ts','utf8');
    expect(route).toContain("const requestActionIssue = (proposal: string, input?: Record<string, unknown>) => intent === 'new_build' && !isEditMode && !rb.lastSteerAt");
    expect(route).toContain('goldenQuestionReviewIssue(originalPrompt, proposal, input) : null');
    expect(route.match(/^        requestActionIssue,$/gm)).toHaveLength(2);
    const child = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');
    expect(child).toContain('requestActionIssue: deps.requestActionIssue');
  });
});
