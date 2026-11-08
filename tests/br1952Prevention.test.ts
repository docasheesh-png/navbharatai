// BR1952 (84d16d0e): offline production-path regressions, never a paid replay.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { runOneShot, oneShotStillViable, oneShotSkipReason } from '../src/server/AgentV3/OneShotBuilder';
import { continueFastLaneGeneration } from '../src/server/AgentV3/FastLaneContinuation';
import { binaryTextGenerationProblem } from '../src/server/AgentV3/binaryTextWrite';
import { inUserVoice } from '../src/server/AgentV3/platformVoice';
import { foldPlanToBudget } from '../src/server/AgentV3/fileBudget';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { isAppFinding, PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { abortBuild, interruptedBeforeAnyVerdict, abortCauseOf } from '../src/server/AgentV3/buildAbortCause';

const manifest = 'src/App.tsx :: root component\nsrc/components/VideoPlayer.tsx :: real player';
const contract = 'export interface VideoMetadata { id: string; title: string }';
function lane(over: Partial<Parameters<typeof runSimpleBuild>[0]> = {}) {
  const logs: string[] = [];
  const saved: Array<{path: string; content: string}> = [];
  const calls: string[] = [];
  return { logs, saved, calls, deps: {
    prompt: 'Mujhe youtube ki tarah ek app Banakar do', framework: 'vite-react', scaffoldPaths: ['index.html'],
    generate: async (_system: string, user: string) => {
      calls.push(user);
      if (user.includes('Plan the file list')) return manifest;
      if (user.includes('Design the shared contract')) return contract;
      const path = user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim() || 'src/App.tsx';
      return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`;
    },
    writeFiles: async (files: Array<{path: string; content: string}>) => {
      saved.push(...files);
      return files.map(f => ({path: f.path, ok: true}));
    },
    log: (s: string) => logs.push(s), ...over,
  }};
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('text generation must hand asset work to a tool-capable builder before spending on it', () => {
  it.each(['src/assets/thumbnails/thumb4.jpg', 'src/assets/videos/sample1.mp4', 'public/favicon.ico', 'public/model.GLB', 'public/font.woff2'])('keeps %s in the handed-off plan, but makes no contract/file/continuation call', async asset => {
    let calls = 0;
    const h = lane({generate: async () => { calls++; return `${manifest}\n${asset} :: required asset`; }});
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/binary.*tool|tool.*binary/i);
    expect(calls).toBe(1);
    expect(h.saved).toEqual([]);
    expect(r.plannedPaths).toContain(asset);
    expect(r.plannedPaths).toContain('src/App.tsx');
  });
  it('does not reject an actual text SVG or a URL mentioned only in a source purpose', async () => {
    const h = lane();
    const original = h.deps.generate;
    h.deps.generate = async (s, u) => u.includes('Plan the file list') ? `${manifest}\npublic/icon.svg :: text icon; use https://example.test/video.mp4 in player` : original(s,u);
    expect((await runSimpleBuild(h.deps)).ok).toBe(true);
  });
});

describe('a source-file budget must not fold independently parsed resources into config or code', () => {
  it('preserves package.json/postcss.config.js/README.md from the actual BR1952 fold', () => {
    const paths = ['src/App.tsx', 'src/a.ts', 'tailwind.config.js', 'postcss.config.js', 'package.json', 'README.md'];
    const r = foldPlanToBudget(paths.map(path => ({path, purpose: path})), {maxFiles: 3, label: 'simple'});
    expect(r.files.map(f => f.path)).toEqual(paths);
    expect(r.folded).toEqual([]);
    expect(r.note).toMatch(/exceeded/i);
  });
  it.each(['global.css','index.html','video.mp4','settings.json','schema.sql','Dockerfile','vite.config.ts'])('does not lose %s merely because the numeric budget is too small', name => {
    const r = foldPlanToBudget(['src/App.tsx','src/a.ts',name].map(path=>({path,purpose:path})), {maxFiles:2,label:'simple'});
    expect(r.files.map(f=>f.path)).toContain(name);
    expect(r.folded).not.toContain(name);
  });
  it('still co-locates ordinary helper modules, without folding their host away', () => {
    const r = foldPlanToBudget(['src/App.tsx','src/a.ts','src/b.ts'].map(path=>({path,purpose:path})), {maxFiles:2,label:'simple'});
    expect(r.files.map(f=>f.path)).toEqual(['src/App.tsx','src/a.ts']);
    expect(r.folded).toEqual(['src/b.ts']);
  });
});

describe('the shared contract is a real saved prerequisite, not an announcement about an in-memory string', () => {
  it('saves it before a consumer is generated, exactly once with acknowledged outcomes', async () => {
    const h = lane(); const original = h.deps.generate;
    h.deps.generate = async (s,u) => {
      if (u.includes('write THIS file')) expect(h.saved.some(f=>f.path==='src/types.ts')).toBe(true);
      return original(s,u);
    };
    expect((await runSimpleBuild(h.deps)).ok).toBe(true);
    expect(h.saved.filter(f=>f.path==='src/types.ts')).toHaveLength(1);
  });
  it('a refused contract starts no per-file consumer calls and never says Wrote', async () => {
    const h = lane({writeFiles: async files => files.map(f=>({path:f.path,ok:false,error:'sandbox capacity unavailable'}))});
    const r = await runSimpleBuild(h.deps);
    expect(r.ok).toBe(false);
    expect(r.filesWritten).toBe(0);
    expect(h.calls.filter(s=>s.includes('write THIS file'))).toHaveLength(0);
    expect(h.logs.some(s=>s.includes('Wrote the shared contract'))).toBe(false);
  });
  it('buffered file completion says generated, not a saved-file checkmark', async () => {
    const h = lane();
    const original = h.deps.writeFiles;
    h.deps.writeFiles = async files => {
      if (files.some(f=>f.path==='src/App.tsx')) {
        expect(h.logs.some(s=>/^✓ src\//.test(s))).toBe(false);
        expect(h.logs.some(s=>s.includes('Generated src/') && s.includes('not saved yet'))).toBe(true);
      }
      return original(files);
    };
    expect((await runSimpleBuild(h.deps)).ok).toBe(true);
  });
});

async function stoppedRunner(isError: boolean, changed = false, existing = false, opaque = false) {
  const ac = new AbortController();
  const client: MessagesCreateClient = {messages:{create: async()=>({content:[{type:'tool_use',id:'t1',name:'bash',input:{command:'ls'}}],stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1}}) as never}};
  let changes = 0;
  const dispatcher = { changeCount:opaque ? undefined : ()=>changes, dispatch:async(call:{id:string})=>{
    if (changed) changes++;
    abortBuild(ac,'futile');
    return {tool_use_id:call.id, content:isError?'Rate limit exceeded: maximum concurrent E2B sandboxes (20)':'command completed',is_error:isError};
  }};
  const events = new AgentEventStream();
  return new AgentRunner({client:new ClaudeClient(client),dispatcher:dispatcher as never,state:new WorkspaceState(events),events,model:'m',system:'s',tools:defaultToolCatalog(),signal:ac.signal,hasExistingFiles:()=>existing}).run('Build a video app');
}
describe('an attempted mutation is not evidence of saved work', () => {
  it('a successful ls with a known zero-change receipt is still not saved files',async()=>{
    expect((await stoppedRunner(false)).summary).not.toMatch(/files so far are saved/);
  });
  it('BR1952 failed ls must not claim files were saved', async()=>{
    const r=await stoppedRunner(true);
    expect(r.summary).not.toMatch(/files so far are saved/);
    expect(r.summary).toMatch(/nothing had been produced/i);
  });
  it('retains real earlier work even if the last command failed', async()=>{
    expect((await stoppedRunner(true,false,true)).summary).toMatch(/files so far are saved/);
  });
  it('retains a partial change actually observed before a tool error', async()=>{
    expect((await stoppedRunner(true,true)).summary).toMatch(/files so far are saved/);
  });
  it('does not silently discard a successful effect from an opaque tool', async()=>{
    expect((await stoppedRunner(false,false,false,true)).summary).toMatch(/files so far are saved/);
  });
});

// Run the production callback selected by its declaration, not a second implementation of its order.
const source = readFileSync('src/server/routes/agentv3.ts','utf8');
const ast = ts.createSourceFile('agentv3.ts',source,ts.ScriptTarget.Latest,true);
const nodes: ts.Node[]=[]; (function walk(n:ts.Node){nodes.push(n);ts.forEachChild(n,walk)})(ast);
function declaration(name:string){
  const found=nodes.filter(ts.isVariableDeclaration).filter(n=>n.name.getText(ast)===name && !!n.initializer);
  expect(found).toHaveLength(1); return found[0];
}
function execute(text:string,env:Record<string,unknown>){
  const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(...Object.keys(env),js)(...Object.values(env));
}
describe('the terminal signal wins over live status and capability marketing',()=>{
  it.each([true,false])('never emits live ETA after the same tick aborts or starts aborted (starts active=%s)', active=>{
    const timer=declaration('diagHeartbeatTimer').initializer as ts.CallExpression;
    const callback=timer.arguments[0];
    const ac=new AbortController(); if(!active)abortBuild(ac,'futile');
    const emitted:unknown[]=[];
    const env={rb:{ended:false},abort:ac,buildDiagRef:{heartbeat:vi.fn(),record:vi.fn()},userWait:{since:null},events:{emit:(e:unknown)=>emitted.push(e)},waitingForUserLine:()=>'',futilityFired:false,futilityArmed:true,futilityState:{},futilityMinutes:()=>10,tickFutility:()=>({state:{},quietMinutes:10,stop:true}),writtenFiles:new Set(),commandsRun:0,pathsReadNow:()=>0,etaStepsDone:0,futilityStopApplies:()=>true,renderSeenThisBuild:()=>false,workspaceId:'w',futilityDetail:()=>'',console:{log:()=>{}},abortBuild,etaTick:1,etaTotalMs:300000,etaStartMs:1,etaPlatformSeededFiles:0,etaFinalChecks:false,etaAppRenderedAt:0,etaAppExists:()=>false,etaLoopFailed:true,etaPlannedFiles:28,etaFirstFileAt:0,etaPlannedSteps:0,etaStepPaths:new Set(),etaFirstStepAt:0,etaEvidenced:false,effectiveBuildSeconds:1500,etaRoughBand:false,etaRoughHighMs:0,etaBaseMs:300000,etaRevisions:0,etaPromisedHighMs:432286,etaTickLine:()=>({text:'I will keep going for up to 15 min more',totalMs:300000,revisions:0,evidenced:false})};
    vi.useFakeTimers();
    const tick=execute(`return ${callback.getText(ast)}`,env) as ()=>void;
    const id=setInterval(tick,60000); vi.advanceTimersByTime(60000); clearInterval(id);
    expect(ac.signal.aborted).toBe(true);
    expect(emitted).toEqual([]);
  });
  it.each([false,true])('an unrecovered sandbox suppresses the paid-capability upsell even without a provider outage (aborted=%s)', aborted=>{
    const interrupted=declaration('interrupted');
    const ac=new AbortController();if(aborted)abortBuild(ac,'futile');
    expect(execute(`return ${interrupted.initializer!.getText(ast)}`,{stopped:false,sandboxUnavailable:true,abort:ac,interruptedBeforeAnyVerdict,abortCauseOf})).toBe(true);
  });
  it('a recovered workspace does not veto a genuine capability verdict',()=>{
    expect(execute(`return ${declaration('interrupted').initializer!.getText(ast)}`,{stopped:false,sandboxUnavailable:false,abort:new AbortController(),interruptedBeforeAnyVerdict,abortCauseOf})).toBe(false);
  });
});

describe('binary-text generation siblings cannot reopen the same impossible work',()=>{
  it('a one-file binary plan also skips one-shot, even though its size fits',()=>{
    const reason=binaryTextGenerationProblem([{path:'public/icon.png'}])!;
    expect(oneShotStillViable({plannedFiles:1,reason})).toBe(false);
    expect(oneShotSkipReason({plannedFiles:1,reason})).toMatch(/binary/);
  });
  it('one-shot refuses a binary reply before the writer and never reports success',async()=>{
    const writeFiles=vi.fn(async()=>[]);
    const r=await runOneShot({prompt:'a logo app',framework:'vite-react',scaffoldPaths:[],generate:async()=> '<<<FILE public/logo.png>>>\nPNG bytes\n<<<ENDFILE>>>',writeFiles});
    expect(r.ok).toBe(false); expect(writeFiles).not.toHaveBeenCalled();
  });
  it('neither complete nor truncated binary blocks buy a continuation',async()=>{
    for(const text of ['<<<FILE src/assets/thumbnails/thumb4.jpg>>>\nJFIF partial', '<<<FILE public/logo.png>>>\nPNG bytes\n<<<ENDFILE>>>']){
      const generate=vi.fn();
      await expect(continueFastLaneGeneration({text,stopReason:'max_tokens'},{generate})).rejects.toThrow(/binary/);
      expect(generate).not.toHaveBeenCalled();
    }
  });
  it('a later continuation cannot introduce binary bytes into kept output',async()=>{
    const r=await continueFastLaneGeneration({text:'<<<FILE src/App.tsx>>>\nexport default ',stopReason:'max_tokens'},{generate:async()=>({text:'<<<FILE public/logo.png>>>\nPNG\n<<<ENDFILE>>>',stopReason:'end_turn'})});
    expect(r.failure).not.toBeNull(); expect(r.text).not.toContain('PNG'); expect(r.dropped?.path).toBe('src/App.tsx');
  });
  it.each(['hinglish','hindi'] as const)('the new unsaved-progress line preserves the %s voice',voice=>{
    const text=inUserVoice('🧩 Generated src/App.tsx (1/2) — not saved yet.',voice);
    expect(text).toContain('src/App.tsx'); expect(text).toContain('(1/2)'); expect(text).not.toContain('not saved yet');
  });
});

describe('workspace failure is not permission to spend on a text-only lane',()=>{
  it('the skip stays process-only, with no app health penalty or user repair offer',()=>{
    const code='FAST_LANE_SKIPPED_SANDBOX';
    expect(PROCESS_ONLY_CODES.has(code)).toBe(true);
    expect(isAppFinding({code,phase:'build'})).toBe(false);
    expect(buildFindingSuggestions([{code,severity:'warning',autoResolved:false}])).toEqual([]);
    expect(readFileSync('src/server/AgentV3/buildFindingSuggestions.ts','utf8')).toContain("'FAST_LANE_SKIPPED_SANDBOX'");
  });
  const env={goldenPreseeded:false,pastedSeed:new Set(),oneShotEnabled:()=>true,intent:'new_build',onlyOpus:false,classifyForSimpleLane:()=>true,analysis:{startTier:'haiku'},projectModuleRef:null,isImportTurn:false};
  it('unavailable setup skips the shared simple/one-shot admission but does not abort the recovery-capable builder',()=>{
    const ac=new AbortController();
    expect(execute(`return ${declaration('fastLaneWouldRun').initializer!.getText(ast)}`,{...env,sandboxUnavailable:true,abort:ac})).toBe(false);
    expect(ac.signal.aborted).toBe(false);
  });
  it('normal available builds keep the fast lane, and golden/import/module exclusions stay excluded',()=>{
    const code=`return ${declaration('fastLaneWouldRun').initializer!.getText(ast)}`;
    expect(execute(code,{...env,sandboxUnavailable:false})).toBe(true);
    for(const control of [{goldenPreseeded:true},{isImportTurn:true},{projectModuleRef:{}},{intent:'edit_existing'}]) expect(execute(code,{...env,sandboxUnavailable:false,...control})).toBe(false);
  });
});

describe('whole-server class census: a new sibling needs the same boundary and a regression',()=>{
  const files: Array<[string,string]>=[];
  function readTree(dir:string){for(const e of readdirSync(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;if(e.isDirectory())readTree(p);else if(/\.tsx?$/.test(p)&&!p.endsWith('.test.ts'))files.push([p,readFileSync(p,'utf8')]);}}
  readTree('src/server');
  it.each([
    ['runSimpleBuild',['src/server/routes/agentv3.ts']],
    ['runOneShot',['src/server/routes/agentv3.ts']],
    ['continueFastLaneGeneration',['src/server/routes/agentv3.ts']],
    ['foldPlanToBudget',['src/server/AgentV3/SimpleBuilder.ts','src/server/routes/agentv3.ts']],
    ['futilityStopApplies',['src/server/routes/agentv3.ts']],
  ])('%s callers are all covered by this audit, including the blueprint folding sibling',(name,expected)=>{
    const re=new RegExp(`(?<!function )\\b${name}\\s*\\(`,'g');
    expect(files.flatMap(([p,text])=>[...text.matchAll(re)].map(()=>p)).sort()).toEqual(expected);
  });
  it('there is only one saved-work effect-counter update, after dispatch; old generation checkmarks cannot reappear',()=>{
    const runner=readFileSync('src/server/AgentV3/AgentRunner.ts','utf8');
    expect(runner.match(/producingToolUses\s*\+=/g)).toHaveLength(1);
    const observed=runner.slice(runner.indexOf('const dispatchObserved'),runner.indexOf('const serialIdx'));
    expect(observed.indexOf('producingToolUses +=')).toBeGreaterThan(observed.indexOf('await dispatchWithBudget'));
    const simple=readFileSync('src/server/AgentV3/SimpleBuilder.ts','utf8');
    expect(simple).not.toContain('`✓ ${spec.path}');
    expect(simple.indexOf('const contractSave = await writeAndLearn')).toBeGreaterThan(-1);
    expect(simple.indexOf('const contractSave = await writeAndLearn')).toBeLessThan(simple.indexOf('deps.log?.(`📐 Wrote the shared contract'));
  });
});
