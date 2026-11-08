import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { roadmapGuardrail } from '../src/server/lib/megaRoadmap';
import { manifestArchitectureProblem } from '../src/server/AgentV3/manifestArchitecture';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { runOneShot } from '../src/server/AgentV3/OneShotBuilder';
import { createSteeringHandoff, STEERING_YIELD_REASON, oneShotOutcomeRecord } from '../src/server/AgentV3/steeringHandoff';
import { createLaneWriteFence } from '../src/server/AgentV3/laneWriteFence';
import { withReplyLanguage } from '../src/server/AgentV3/replyLanguageBinding';
import { voiceOf, voiceRequestedIn, type PlatformVoice } from '../src/server/AgentV3/platformVoice';
import { createSandboxAdmissionBudget, SANDBOX_ADMISSION_BLOCKED } from '../src/server/AgentV3/sandboxAdmissionBudget';
import { isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import type { ToolUse, TurnResult, RunTurnParams } from '../src/server/AgentV3/ClaudeClient';

const original = 'Mujhe youtube ki tarah ek app Banakar do';
const roadmap = (buildPrompt: string) => ({userMessage:'Pehla hissa banaunga',achievableSummary:'Video dekh sakte hain',note:null,steps:[
  {title:'Video feed',goal:'Video chala sakte hain',buildPrompt,needsInfra:null},
  {title:'Watch history',goal:'History dekh sakte hain',buildPrompt:'Add working watch history to the existing app',needsInfra:null},
]});
const manifest='src/App.tsx :: root component\nsrc/components/Player.tsx :: player';
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r}); return {promise,resolve}; }
function lane(over: Partial<Parameters<typeof runSimpleBuild>[0]>={}) {
  const calls:string[]=[];const saved:string[]=[];
  return {calls,saved,deps:{prompt:original,framework:'vite-react',scaffoldPaths:['index.html'],
    generate:async(_s:string,u:string)=>{calls.push(u);if(u.includes('Plan the file list'))return manifest;if(u.includes('Design the shared contract'))return 'export interface Video { id: string }';const path=u.match(/write THIS file in full:\s*\n\s*([^\n]+)/)?.[1]?.trim()||'src/App.tsx';return `<<<FILE ${path}>>>\nexport default function App(){return null}\n<<<ENDFILE>>>`},
    writeFiles:async(files:Array<{path:string;content:string}>)=>{saved.push(...files.map(f=>f.path));return files.map(f=>({path:f.path,ok:true}))},...over}};
}
const finalTurn: TurnResult={text:'done',toolUses:[],stopReason:'end_turn',usage:{inputTokens:1,outputTokens:1}};
function runner(client:{runTurn:(params:RunTurnParams)=>Promise<TurnResult>}, dispatch: (call: ToolUse)=>Promise<{tool_use_id:string;content:string;is_error:boolean}>, over: Partial<ConstructorParameters<typeof AgentRunner>[0]>={}) {
  const events = new AgentEventStream();
  return new AgentRunner({client,dispatcher:{dispatch,changeCount:()=>0,frameworkId:'vite-react'} as never,state:new WorkspaceState(events),events,model:'fixture',system:'Internal English system',tools:defaultToolCatalog(),maxSteps:9,...over});
}
const tool=(id:string,name='bash'):ToolUse=>({id,name,input:name==='bash'?{command:'ls'}:{pattern:'*'}});
const capacity=(call:ToolUse)=>({tool_use_id:call.id,is_error:true,content:'Error: Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes (20).'});

describe('BR1952 D03: planner choices do not override original architecture constraints',()=>{
  it('rejects the known invented single-HTML roadmap before public emission/persistence/execution',()=>{
    const r=roadmapGuardrail(roadmap('Build this video viewer as a single HTML file with inline CSS and JavaScript'),null,{framework:'vite-react',originalRequest:original});
    expect(r.roadmap).toBeNull();expect(r.rejected.join(' ')).toMatch(/planner choice, not a user constraint/);
  });
  it.each([['vite-react','Build the app as a Vite React project'],['vue','Build the app with Vue Single-File Components'],['vite-react','Do not use a single HTML file; keep the React project']])('preserves compatible or negated choices: %s %s',(framework,brief)=>{
    expect(roadmapGuardrail(roadmap(brief),null,{framework,originalRequest:original}).roadmap).not.toBeNull();
  });
  it.each(['python-fastapi','node-express'])('does not invent an architecture conflict for a compatible backend-served HTML frontend: %s',framework=>{
    expect(roadmapGuardrail(roadmap('Build the viewer frontend as a single HTML file served by the existing API'),null,{framework,originalRequest:'Build a video viewing API and frontend'}).roadmap).not.toBeNull();
  });
  it('does not reject a genuinely requested one-file static app',()=>{
    expect(roadmapGuardrail(roadmap('Build a single HTML file video viewer'),null,{framework:'static',originalRequest:'single file HTML video app'}).roadmap).not.toBeNull();
  });
  it('does not turn a planner invention into a user manifest restriction',()=>{
    expect(manifestArchitectureProblem(['src/App.tsx','src/components/Player.tsx'],original)).toBeNull();
    expect(manifestArchitectureProblem(['index.html'],'one HTML file video viewer')).toBeNull();
  });
  it.each(['Do not use a single HTML file; use React','Never build everything in one HTML file','No single file HTML app, keep the existing modules'])('does not invert a user ban: %s',request=>{
    expect(manifestArchitectureProblem(['src/App.tsx','src/components/Player.tsx'],request)).toBeNull();
  });
  it('the one-shot sibling cannot save a multi-file answer to a real one-HTML constraint',async()=>{
    const writeFiles=vi.fn(async()=>[]);const r=await runOneShot({prompt:'single HTML file video app',originalRequest:'single HTML file video app',framework:'static',scaffoldPaths:[],generate:async()=> '<<<FILE index.html>>>\n<h1>Videos</h1>\n<<<ENDFILE>>>\n<<<FILE app.js>>>\nconsole.log(1)\n<<<ENDFILE>>>',writeFiles});
    expect(r.ok).toBe(false);expect(r.reason).toMatch(/architecture_mismatch/);expect(writeFiles).not.toHaveBeenCalled();
  });
  it('rejects actual manifest disagreement before the shared contract or consumers are bought',async()=>{
    const h=lane({originalRequest:'Build a single HTML file video viewer'});const r=await runSimpleBuild(h.deps);
    expect(r.ok).toBe(false);expect(r.reason).toMatch(/architecture_mismatch/);expect(h.calls).toHaveLength(1);expect(h.saved).toEqual([]);
  });
});

describe('BR1952 D34: queued steering yields without draining notes or pretending the user stopped',()=>{
  it('retains a completed manifest and starts no contract/consumer after steering',async()=>{
    const q:string[]=[];const owner=createSteeringHandoff(()=>q,()=>true);owner.beginLane();
    const h=lane({yieldRequested:()=>owner.pending(),generate:async()=>{q.push('channel upload bhi add karo');return manifest}});
    const r=await runSimpleBuild(h.deps);expect(r.ok).toBe(false);expect(r.stopped).not.toBe(true);expect(r.reason).toBe(STEERING_YIELD_REASON);expect(r.summary).not.toMatch(/reasoning|reasons before|timed out/i);expect(r.plannedPaths).toContain('src/App.tsx');expect(owner.take()).toEqual([]);expect(q).toHaveLength(1);
    owner.releaseLane();expect(owner.take()).toEqual(['channel upload bhi add karo']);expect(owner.take()).toEqual([]);
  });
  it('keeps completed concurrent files, settles accepted writes, and refuses obsolete writers before delivery',async()=>{
    const q:string[]=[];const owner=createSteeringHandoff(()=>q,()=>true);owner.beginLane();
    const gate=deferred<void>();const entered=deferred<void>();const inFlight=deferred<void>();let consumers=0;
    const saved:string[]=[];const fence=createLaneWriteFence(async files=>{if(files.some(f=>f.path==='src/components/Player.tsx')){entered.resolve();await gate.promise}saved.push(...files.map(f=>f.path));return files.map(f=>({path:f.path,ok:true}))});const write=fence.open('simple');
    const h=lane({yieldRequested:()=>owner.pending(),stopLane:()=>owner.pending()?STEERING_YIELD_REASON:null,writeFiles:write});const gen=h.deps.generate;
    h.deps.generate=async(s,u)=>{if(u.includes('Plan the file list'))return manifest+'\nsrc/components/Channel.tsx :: channel display';if(u.includes('write THIS file')){consumers++;if(consumers===2)inFlight.resolve();await inFlight.promise;if(!q.length)q.push('monetization bhi chahiye')}return gen(s,u)};
    let ended=false;const pending=runSimpleBuild(h.deps).then(r=>{ended=true;return r});await entered.promise;
    expect(owner.take()).toEqual([]);expect(ended).toBe(false);gate.resolve();const result=await pending;
    expect(result.ok).toBe(false);expect(result.stopped).not.toBe(true);expect(result.salvagedPaths).toContain('src/components/Player.tsx');expect(saved).toContain('src/components/Channel.tsx');expect(consumers).toBe(2);
    await fence.handoffAndDrain();owner.releaseLane();expect(owner.take()).toHaveLength(1);expect(owner.take()).toEqual([]);
    await expect(write([{path:'src/App.tsx',content:'obsolete'}])).rejects.toThrow(/handed off/);
  });
  it('write ownership cannot pass while an accepted write is still pending',async()=>{
    const gate=deferred<void>();const fence=createLaneWriteFence(async()=>gate.promise);const write=fence.open('fast');const writing=write([{path:'src/App.tsx',content:'old'}]);let handed=false;
    const drain=fence.handoffAndDrain().then(()=>{handed=true});await Promise.resolve();expect(handed).toBe(false);await expect(write([])).rejects.toThrow(/handed off/);gate.resolve();await writing;await drain;expect(handed).toBe(true);
  });
  it.each(['verify','preview'] as const)('steering during %s prevents a terminal stale-scope success',async phase=>{
    let pending=false;const h=lane({yieldRequested:()=>pending,verify:async()=>{if(phase==='verify')pending=true;return{ok:true,errors:''}},startPreview:async()=>{pending=true}});
    const r=await runSimpleBuild(h.deps);expect(r.ok).toBe(false);expect(r.reason).toBe(STEERING_YIELD_REASON);expect(r.filesWritten).toBeGreaterThan(0);expect(r.stopped).not.toBe(true);
  });
  it('Stop retains precedence over a simultaneously queued steer after saving',async()=>{
    const abort=new AbortController();let pending=false;const h=lane({signal:abort.signal,yieldRequested:()=>pending});const write=h.deps.writeFiles;
    h.deps.writeFiles=async files=>{const outcome=await write(files);if(files.some(file=>file.path==='src/App.tsx')){pending=true;abort.abort()}return outcome};
    const result=await runSimpleBuild(h.deps);expect(result.stopped).toBe(true);expect(result.handedOff).not.toBe(true);expect(result.summary).not.toMatch(/queued|carrying on/);
  });
  it('OneShot keeps its finished in-flight file but does not report a stale scope complete',async()=>{
    let pending=false;const writeFiles=vi.fn(async(files:Array<{path:string;content:string}>)=>files.map(f=>({path:f.path,ok:true})));const startPreview=vi.fn(async()=>{});
    const r=await runOneShot({prompt:original,framework:'static',scaffoldPaths:[],yieldRequested:()=>pending,generate:async()=>{pending=true;return'<<<FILE index.html>>>\n<h1>Videos</h1>\n<<<ENDFILE>>>'},writeFiles,startPreview});
    expect(r.ok).toBe(false);expect(r.filesWritten).toBe(1);expect(r.salvagedPaths).toEqual(['index.html']);expect(writeFiles).toHaveBeenCalledTimes(1);expect(startPreview).not.toHaveBeenCalled();expect(r.reason).toBe(STEERING_YIELD_REASON);
  });
  it('a steer arriving during the one-shot caller verify is not recorded as a terminal build success',()=>{
    expect(oneShotOutcomeRecord('BUILD_SUCCESS',true).code).toBe('ONESHOT_SCOPE_YIELD');expect(oneShotOutcomeRecord('BUILD_SUCCESS',false).code).toBe('OUTCOME_BUILD_SUCCESS');
  });
  it('a disabled steering capability neither drains a queue nor forces a lane yield',()=>{
    const q=['note'];const owner=createSteeringHandoff(()=>q,()=>false);expect(owner.pending()).toBe(false);expect(owner.take()).toEqual([]);expect(q).toEqual(['note']);
  });
  it('AgentRunner receives the original user note exactly once after ownership is released',async()=>{
    const q=['channel upload bhi add karo'];const owner=createSteeringHandoff(()=>q,()=>true);owner.beginLane();expect(owner.take()).toEqual([]);owner.releaseLane();
    const calls:RunTurnParams[]=[];const r=runner({runTurn:async p=>{calls.push({...p,messages:structuredClone(p.messages)});return finalTurn}},async c=>({...capacity(c),content:'unused'}),{steerPoll:()=>owner.take()});
    await r.run(original);expect(JSON.stringify(calls[0].messages).match(/channel upload bhi add karo/g)).toHaveLength(1);expect(owner.take()).toEqual([]);
  });
});

describe('BR1952 D35: original user voice survives English milestone/code/repair briefs',()=>{
  it.each([
    [original,'hinglish','Roman-script Hinglish'],['मुझे वीडियो देखने वाला ऐप बना दो','hindi','Hindi in Devanagari'],['Build a video viewing app','en','English'],
  ] as const)('binds all text and tool-runner boundaries for %s',async(request,voice,marker)=>{
    expect(voiceOf(request)).toBe(voice);const calls:RunTurnParams[]=[];const client={runTurn:async(p:RunTurnParams)=>{calls.push(p);return finalTurn}};
    const wrapped=withReplyLanguage(client,()=>voice);await wrapped.runTurn({model:'fixture',system:'Write internal buildPrompt in English.',messages:[{role:'user',content:'Build step one in Vite React'}],tools:[],maxTokens:32});
    await runner(client,async c=>capacity(c),{replyVoice:()=>voice}).run('Fix the TypeScript error');
    expect(calls).toHaveLength(2);for(const p of calls){expect(p.system).toContain(`[USER REPLY LANGUAGE: ${marker}`);expect(p.system).toContain('userMessage, achievableSummary, note, title, goal');expect(p.system).toContain('not the app UI language')}
  });
  it('resolves a live explicit switch per turn rather than caching the original language',async()=>{
    let voice:PlatformVoice='hinglish';const systems:string[]=[];const runner=withReplyLanguage({runTurn:async p=>{systems.push(p.system);return finalTurn}},()=>voice);
    const p={model:'fixture',system:'code',messages:[],tools:[],maxTokens:32};await runner.runTurn(p);voice=voiceRequestedIn('English please')!;await runner.runTurn(p);voice=voiceRequestedIn('हिंदी में बताओ')!;await runner.runTurn(p);
    expect(systems[0]).toContain('Roman-script Hinglish');expect(systems[1]).toContain('[USER REPLY LANGUAGE: English]');expect(systems[2]).toContain('Hindi in Devanagari');expect(p.system).toBe('code');
  });
});

describe('BR1952 B-INFRA: bounded real recovery, not repeated identical full-builder probes',()=>{
  it('permits a real recovery after one capacity failure and resets on successful workspace I/O',async()=>{
    const budget=createSandboxAdmissionBudget();const a=tool('a'),b=tool('b'),c=tool('c');await budget.dispatch(a,async()=>capacity(a));
    expect((await budget.dispatch(b,async()=>({tool_use_id:b.id,is_error:false,content:'src/'}))).is_error).toBe(false);
    await budget.dispatch(c,async()=>capacity(c));expect(budget.exhausted).toBe(false);
  });
  it('serializes a known-capacity recovery, never shares different tool outputs and never raises limits',async()=>{
    const budget=createSandboxAdmissionBudget();const a=tool('a'),b=tool('b'),c=tool('c','glob');await budget.dispatch(a,async()=>capacity(a));const gate=deferred<void>();let real=0;
    const retry=budget.dispatch(b,async()=>{real++;await gate.promise;return capacity(b)});const probe=budget.dispatch(c,async()=>{real++;return capacity(c)});await Promise.resolve();expect(real).toBe(1);gate.resolve();await retry;const refused=await probe;
    expect(real).toBe(1);expect(refused.tool_use_id).toBe('c');expect(refused.content).toBe(SANDBOX_ADMISSION_BLOCKED);expect(budget.exhausted).toBe(true);
  });
  it.each([false,true])('unrelated error and quoted successful stdout do not poison workspace admission (success=%s)',async success=>{
    const budget=createSandboxAdmissionBudget();const a=tool('a');for(let i=0;i<4;i++)await budget.dispatch(a,async()=>({tool_use_id:a.id,is_error:!success,content:success?capacity(a).content:'Error: npm registry rate limit exceeded'}));expect(budget.exhausted).toBe(false);
  });
  it.each(['append_file','write_files_batch'])('the sandbox-writing sibling %s cannot bypass the same exhausted budget',async name=>{
    const budget=createSandboxAdmissionBudget();let probes=0;
    for(const id of ['first','recovery']){const call=tool(id);await budget.dispatch(call,async()=>capacity(call))}
    const call=tool('blocked-writer',name);const refused=await budget.dispatch(call,async()=>{probes++;return capacity(call)});
    expect(probes).toBe(0);expect(refused.content).toBe(SANDBOX_ADMISSION_BLOCKED);expect(budget.exhausted).toBe(true);
  });
  it('non-sandbox tools cannot reset a proven failure, but remain available',async()=>{
    const budget=createSandboxAdmissionBudget();for(const id of['a','b'])await budget.dispatch(tool(id),async()=>capacity(tool(id)));let called=false;
    await budget.dispatch(tool('todo','update_todo'),async()=>{called=true;return{tool_use_id:'todo',is_error:false,content:'updated'}});expect(called).toBe(true);expect(budget.exhausted).toBe(true);
  });
  it.each([true,false])('the real AgentRunner stops after failed admission plus one failed recovery, including a read-only child (artifacts=%s)',async expectsArtifacts=>{
    let model=0,probes=0;const budget=createSandboxAdmissionBudget();const notes:string[]=[];
    const client={runTurn:async()=>{model++;return{...finalTurn,text:'',stopReason:'tool_use',toolUses:[tool(`c${model}`,expectsArtifacts?'bash':'glob')]}}};
    const dispatch=async(c:ToolUse)=>{probes++;return capacity(c)};
    const r=await runner(client,dispatch,{expectsArtifacts,sandboxAdmissionBudget:budget,onNote:n=>notes.push(n.code)}).run(original);
    expect(r.ok).toBe(false);expect(model).toBe(2);expect(probes).toBe(2);expect(r.summary).toBe(SANDBOX_ADMISSION_BLOCKED);expect(notes).toContain('SANDBOX_ADMISSION_EXHAUSTED');expect(isAppFinding({code:'SANDBOX_ADMISSION_EXHAUSTED'} as never)).toBe(false);expect(r.summary).not.toMatch(/saved|user stopped/i);
    await runner(client,dispatch,{expectsArtifacts,sandboxAdmissionBudget:budget}).run('Retry or heal');expect(model).toBe(2);expect(probes).toBe(2);
  });
});

describe('production sibling census: prevention remains attached to the real route doors',()=>{
  it('binds both text factories, every inherited tool runner, manifest identity and steering ownership',()=>{
    const s=readFileSync('src/server/routes/agentv3.ts','utf8');
    expect(s.match(/=> withReplyLanguage\(withAnswerNotDeliberation/g)).toHaveLength(2);
    expect(s).toContain('replyVoice: () => rb.replyVoice');expect(s).toContain('originalRequest: originalPrompt');expect(s).toContain('steerPoll: () => steeringHandoff.take()');
    expect(s).toContain('if (steeringHandoff.pending()) throw new Error(STEERING_YIELD_REASON)');expect(s).toContain('&& !steeringHandoff.pending())');
    expect(s.indexOf('await laneFence.handoffAndDrain()')).toBeLessThan(s.indexOf('steeringHandoff.releaseLane()'));
    expect(s).toContain('yieldRequested: () => steeringHandoff.pending()');expect(s).toContain('const sandboxAdmissionBudget = createSandboxAdmissionBudget()');
    const child=readFileSync('src/server/AgentV3/SubAgent.ts','utf8');expect(child).toContain('replyVoice: deps.replyVoice');expect(child).toContain('sandboxAdmissionBudget: deps.sandboxAdmissionBudget');
  });
});
