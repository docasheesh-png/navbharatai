import { labelAuthoredFields } from '../src/server/AppMakerLab/intelligence/A11yLinter';
import { runOneShot } from '../src/server/AgentV3/OneShotBuilder';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_ACTION_SCRIPT, SCREENSHOT_CDP_SCRIPT, uiScanScript } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { findUiElements } from '../src/server/AgentV3/UiElementFinder';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { deriveJourneys, journeyScript, stateDoorControls, runnableJourneys, formFeedsList, submitTargetIn, persistenceEvidence, type Journey, type JourneyResult } from '../src/server/AgentV3/journeyDerivation';
import { auditSummaryClaims, type MeasuredFacts } from '../src/server/AgentV3/claimAudit';

const app = `import {useState} from 'react';
export default function App(){
 const [started,setStarted]=useState(false); const [seconds,setSeconds]=useState(600);
 const [reviews,setReviews]=useState([]); const [comment,setComment]=useState('');
 const begin=()=>{setStarted(true);setSeconds(600)};
 const save=()=>setReviews([...reviews,comment]);
 return <main>{!started ? <button type="button" onClick={begin}>Start test</button> :
 <section><textarea name="comment" aria-label="Review comment" value={comment} onChange={e=>setComment(e.target.value)}/>
 <button type="submit" onClick={save}>Save review</button><ul>{reviews.map(x=><li>{x}</li>)}</ul></section>}</main>
}`;
const derive = () => deriveJourneys({ files: { 'src/App.tsx': app }, marker: 'nbai-1956' });

/** Execute the EXACT production JS with observable browser effects, not source text assertions alone. */
async function browserScript(script: string, argv: string, state = { url: 'http://localhost:5173/', started: true, scrolls: 0 }) {
  const files = new Map<string, string>(); const navigations: string[] = []; let disconnected = false;
  const page = {
    url: () => state.url,
    setViewportSize: async () => {},
    goto: async (url: string) => { navigations.push(url); state.url = new URL(url).href; state.started = false; },
    evaluate: async (fn: Function) => String(fn).includes('querySelectorAll') ? [{tag: 'textarea', label: state.started ? 'Review comment' : 'INTRO'}] : String(fn).includes('document') ? 1 : state.scrolls++,
    waitForTimeout: async () => {}, screenshot: async () => Buffer.from('png'),
    $: async () => null,
    click: async () => { if (!state.started) throw new Error('selector timed out'); },
  };
  const browser = { contexts: () => [{pages: () => [page]}] };
  const proc = { argv: ['node','script',argv], stdout: {write: () => {}}, stderr: {write: (s: string) => { throw new Error(s); }}, exit: () => { disconnected = true; } };
  await vm.runInNewContext(script, {URL, Buffer, process: proc, require: (name: string) => {
    if (name === 'playwright') return {chromium: {connectOverCDP: async () => browser, launch: async () => ({newPage:async()=>page,close:async()=>{}})}};
    if (name === 'fs') return {writeFileSync: (p: string, s: unknown) => files.set(p, String(s)), appendFileSync: () => {}};
    throw new Error(name);
  }});
  return {files, navigations, disconnected, state};
}

describe('BR1956 F1 — inspection observes the action browser, never an unrelated clean home page', () => {
  it('the live review screen survives an element scan, including a canonically equal slashless URL', async () => {
    const r = await browserScript(uiScanScript('http://localhost:5173'), '');
    expect(r.navigations).toEqual([]);
    expect(r.state.started).toBe(true);
    expect([...r.files.values()].some(x => x.includes('Review comment'))).toBe(true);
    expect(r.disconnected).toBe(true);
  });
  it('a genuinely different requested page still navigates, and an initial blank page opens the requested app', async () => {
    for (const url of ['about:blank', 'https://example.com/']) {
      const r = await browserScript(uiScanScript('http://localhost:5173'), '', {url, started:false, scrolls:0});
      expect(r.navigations).toEqual(['http://localhost:5173']);
    }
  });
  it('the screenshot sibling also preserves same-page SPA state for a slashless target', async () => {
    const r = await browserScript(SCREENSHOT_CDP_SCRIPT, 'http://localhost:5173');
    expect(r.navigations).toEqual([]); expect(r.state.started).toBe(true);
  });
  it('blank-page scroll is an explicit error, never a successful interaction or an automatic replay', async () => {
    const r = await browserScript(BROWSER_ACTION_SCRIPT, JSON.stringify({action:'scroll'}), {url:'about:blank',started:false,scrolls:0});
    const meta = JSON.parse([...r.files.entries()].find(([p]) => p.endsWith('last-action.json'))![1]);
    expect(meta.result).toMatch(/^ERROR:.*Navigate to the preview first/);
    expect(r.state.scrolls).toBe(0); expect(r.navigations).toEqual([]);
  });
  it('missing selectors remain action errors, without relaunching or erasing the current page', async () => {
    const r = await browserScript(BROWSER_ACTION_SCRIPT, JSON.stringify({action:'click',selector:'.missing'}), {url:'http://localhost:5173/',started:false,scrolls:0});
    expect([...r.files.values()].some(x => x.includes('ERROR: selector timed out'))).toBe(true);
    expect(r.navigations).toEqual([]);
  });
  it('all three persistent tool scripts use the one page owner; independent verification captures stay independent', () => {
    const src=fs.readFileSync(path.join(__dirname,'../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'),'utf8');
    expect(src.match(/ctx\.pages\(\)\[0\]/g)).toHaveLength(1);
    for (const script of [BROWSER_ACTION_SCRIPT,SCREENSHOT_CDP_SCRIPT,uiScanScript('http://localhost:5173')]) expect(script).toContain('connectOverCDP');
    expect(src).toContain('const shotBody = uiScanScript(url)');
  });
});

describe('BR1956 F2 — named controls and actual action outcomes', () => {
  it('theme query never ranks the unrelated anonymous anchor or Start test by role alone', () => {
    const page=[{tag:'a',selector:'a'},{tag:'button',text:'☀️ Light',label:'Toggle theme',selector:'.theme'},{tag:'button',text:'Start test',selector:'.primary'}];
    expect(findUiElements(page,'theme toggle button').map(x=>x.element.selector)).toEqual(['.theme']);
    expect(findUiElements(page,'start test button')[0].element.selector).toBe('.primary');
    expect(findUiElements(page,'missing input field')).toEqual([]);
    expect(findUiElements([{tag:'h1',text:'Start test'}],'start test button')).toEqual([]);
    expect(findUiElements([{tag:'span',role:'button',label:'Toggle theme'}],'theme toggle button')).toHaveLength(1);
    expect(findUiElements(page,'button').length).toBe(3);
    for(const query of ['question content','rate this question','review section']) expect(findUiElements([{tag:'p',text:'12 questions across 4 sections. 10:00'}],query)).toEqual([]);
  });
  it.each(['ERROR: selector timed out','ERROR: action report outcome unknown'])('retains image AND failure flag for %s', async (result) => {
    const actuator:ActuatorPort={readFile:async()=>'',writeFile:async()=>{},listFiles:async()=>[],runCommand:async()=>({exitCode:0,stdout:'',stderr:''}),browserAction:async()=>({screenshot:'PNG',result})};
    const d=new ToolDispatcher(actuator,'br1956-test');
    const r=await d.dispatch({id:'b',name:'browser_action',input:{action:'click',selector:'.primary'}});
    expect(r.is_error).toBe(true); expect(r.image?.base64).toBe('PNG'); expect(r.content).toContain(result);
  });
  it('a genuine successful browser action remains successful without claiming a nonexistent screenshot', async () => {
    const actuator:ActuatorPort={readFile:async()=>'',writeFile:async()=>{},listFiles:async()=>[],runCommand:async()=>({exitCode:0,stdout:'',stderr:''}),browserAction:async()=>({screenshot:'',result:'Clicked Start test'})};
    const r=await new ToolDispatcher(actuator,'br1956-test').dispatch({id:'b',name:'browser_action',input:{action:'click',selector:'.primary'}});
    expect(r.is_error).toBe(false);expect(r.content).not.toContain('Screenshot attached');
  });
});

describe('BR1956 F3 — same-file state doors, bounded and source-proven', () => {
  it('derives Start test as a prerequisite for the hidden review form in App.tsx', () => {
    expect(stateDoorControls(app)).toEqual(['Start test']);
    expect(derive()[0]).toMatchObject({kind:'create-persists',openControls:['Start test'],route:'/'});
    expect(journeyScript('http://localhost:5173',derive(),'nbai-1956')).toContain('for (const name of out.doors) await pressReach(name)');
  });
  it('binds persistence to Save review, never to a preceding Start test handler', () => {
    expect(formFeedsList(app, submitTargetIn(app))).toBe('yes');
    expect(formFeedsList(app.replace('>Save review<',' aria-label="Save review">＋<'),submitTargetIn(app.replace('>Save review<',' aria-label="Save review">＋<')))).toBe('yes');
  });
  it.each([
    ['fetch side effect', '()=>{setStarted(true);fetch("/start")}', 'Start test'],
    ['storage side effect', '()=>{localStorage.setItem("x","y");setStarted(true)}', 'Start test'],
    ['unknown callback', 'startExam', 'Start test'],
    ['computed argument', '()=>setStarted(compute())', 'Start test'],
    ['outward label', '()=>setStarted(true)', 'Start payment'],
    ['write label', '()=>setStarted(true)', 'Start and submit test'],
  ])('does not infer a safe door for %s', (_,handler,label) => {
    expect(stateDoorControls(app.replace('onClick={begin}>Start test',`onClick={${handler}}>${label}`))).toEqual([]);
  });
  it('does not accept a custom useState, submit control, ambiguous ARIA label or unsafe alternate name', () => {
    for(const altered of [app.replace("from 'react'","from './custom'"),app.replace('type="button"','type="submit"'),app.replace('type="button"','aria-labelledby="unknown"'),app.replace('type="button"','title="Delete attempt"')]) expect(stateDoorControls(altered)).toEqual([]);
  });
  it('does not borrow a setter or handler from another lexical scope, or click implicit/spread/bubbling submit controls', () => {
    const shadow = app.replace('export default function App(){', 'export default function App(setStarted){').replace(' const [started,setStarted]=useState(false);',' const [started,setOriginal]=useState(false);') + '\nfunction Other(){const [x,setStarted]=useState(false);return null;}';
    expect(stateDoorControls(shadow)).toEqual([]);
    expect(stateDoorControls(app.replace('function App(){','function App(useState){'))).toEqual([]);
    expect(stateDoorControls(app.replace('const begin=()=>','let begin=()=>').replace(' return <main>', ' begin=sendPayment; return <main>'))).toEqual([]);
    expect(stateDoorControls(app.replace('const [started,setStarted]','let [started,setStarted]').replace(' return <main>', ' setStarted=sendPayment; return <main>'))).toEqual([]);
    for(const altered of [app.replace('type="button"',''),app.replace('type="button"','type="button" {...props}'),app.replace('<main>','<main onClick={sendPayment}>'),app.replace('type="button"','type="button" aria-label={unknown}')]) expect(stateDoorControls(altered)).toEqual([]);
  });
  it('enforces the no-user-database and credential write fences', () => {
    const [j]=deriveJourneys({files:{'src/App.tsx':app,'src/db.ts':'import {getFirestore} from "firebase/firestore"'},marker:'x'});
    expect(j.kind).toBe('form-submit');
    expect(runnableJourneys([j],{'src/db.ts':'import {getFirestore} from "firebase/firestore"'})).toEqual([]);
    expect(runnableJourneys([j],{})).toEqual([j]);
    const [search] = deriveJourneys({files:{'src/pages/Search.tsx':app,'src/db.ts':'import {getFirestore} from \"firebase/firestore\"'},marker:'x'});
    expect(search).toMatchObject({kind:'form-submit',writes:false});
    expect(runnableJourneys([search],{'src/db.ts':'getFirestore()'})).toEqual([]);
    const nav:Journey = {...j,kind:'nav-click',writes:false,fields:[],submit:null};
    expect(runnableJourneys([nav],{'src/db.ts':'getFirestore()'})).toEqual([nav]);
    expect(stateDoorControls(app.replace('onClick={begin}','onClick={()=>setStarted(true)}'))).toEqual(['Start test']);
  });
});

const facts:MeasuredFacts={consoleCaptured:true,screenshotTaken:true,previewVerified:true};
const result=(j:Journey,verdict:JourneyResult['verdict']='passed',step='reload'):JourneyResult=>({id:j.id,kind:j.kind,route:j.route,verdict,step,note:'fixture',errors:[]});
describe('BR1956 F4 — persistence claims require create AND reload, not a paint, submit or unknown fact', () => {
  it('catches the exact retained summary line without asserting the historical app lost data', () => {
    const hits=auditSummaryClaims('Reviews are stored locally and persist between sessions',{...facts,persistence:'not-run'});
    expect(hits.find(x=>x.kind==='persistence-unverified')?.measured).toContain('no create-and-reload journey completed');
  });
  it('corrects the exact fully-functional/tested claim without treating absent proof as an app failure',()=>{
    const text='The app is fully functional and ready for use. Both requested features have been successfully implemented and tested.';
    expect(auditSummaryClaims(text,{...facts,journeyOutcome:'not-run'}).some(x=>x.kind==='functionality-unverified')).toBe(true);
    expect(auditSummaryClaims(text,{...facts,journeyOutcome:'passed'}).some(x=>x.kind==='functionality-unverified')).toBe(false);
    expect(auditSummaryClaims(text,{...facts,journeyOutcome:'not-run',gamePlayed:'passed'}).some(x=>x.kind==='functionality-unverified')).toBe(false);
    for(const text of ['The app will be fully functional','The app is not fully functional','The app has a functional preview']) expect(auditSummaryClaims(text,{...facts,journeyOutcome:'not-run'}).some(x=>x.kind==='functionality-unverified')).toBe(false);
  });
  it.each(['passed','failed','not-run'] as const)('uses explicit %s evidence without conflating missing with failure', state => {
    const hits=auditSummaryClaims('Reviews persist between sessions',{...facts,persistence:state});
    expect(hits.some(x=>x.kind==='persistence-unverified')).toBe(state!=='passed');
  });
  it.each(['Reviews do not persist between sessions','I will add persistent storage','Could persist after a reload','Persistence is untested','Add persistence later','The app supports persistence','No persistent storage is used','Persistence may be added later'])('leaves negation/plans/descriptions alone: %s',text=>{
    expect(auditSummaryClaims(text,{...facts,persistence:'not-run'}).some(x=>x.kind==='persistence-unverified')).toBe(false);
  });
  it('omitted evidence is not an accusation, and a generic submit pass is not persistence proof',()=>{
    expect(auditSummaryClaims('Reviews persist between sessions',facts).some(x=>x.kind==='persistence-unverified')).toBe(false);
    const [j]=derive();expect(persistenceEvidence([j],[])).toBe('not-run');
    expect(persistenceEvidence([j],[result(j,'passed','after-submit')])).toBe('not-run');
    expect(persistenceEvidence([{...j,kind:'form-submit'}],[result(j)])).toBe('not-run');
    expect(persistenceEvidence([j],[result(j,'unreachable')])).toBe('not-run');
    expect(persistenceEvidence([j],[result(j,'failed')])).toBe('failed');
    expect(persistenceEvidence([j],[result(j)])).toBe('passed');
  });
  it('partial and foreign results cannot substantiate all planned persistence journeys',()=>{
    const [j]=derive(), second={...j,id:'create-persists:second'};
    expect(persistenceEvidence([j,second],[result(j)])).toBe('not-run');
    expect(persistenceEvidence([j],[result(second)])).toBe('not-run');
    expect(persistenceEvidence([j,second],[result(j),result(second)])).toBe('passed');
  });
  it('the production caller carries exact runner-derived persistence proof to the auditor, never the paint verdict',()=>{
    const route=fs.readFileSync(path.join(__dirname,'../src/server/routes/agentv3.ts'),'utf8');
    expect(route).toContain("let persistenceProof: 'passed' | 'failed' | 'not-run' = 'not-run'");
    expect(route).toContain('persistenceProof = persistenceEvidence(journeys, journeyResults)');
    expect(route).toContain('persistence: persistenceProof');
  });
});


describe('BR1956 upstream literal-placeholder label prevention, not invented historical labels', () => {
  const raw = 'export default function App(){return <textarea placeholder="Write your review" />}';
  it('labels only newly authored literal-placeholder controls; the established off switch removes the behavior', () => {
    expect(labelAuthoredFields('src/App.tsx', '', raw).code).toContain('aria-label="Write your review"');
    expect(labelAuthoredFields('src/App.tsx', '', raw, {AGENTV3_LABEL_REPAIR:'off'}).code).toBe(raw);
    expect(labelAuthoredFields('src/App.tsx', raw, raw).code).toBe(raw);
    expect(labelAuthoredFields('src/App.tsx', raw, raw+raw).code).toBe(raw+raw);
    expect(labelAuthoredFields('src/App.tsx', null, raw).code).toBe(raw);
    const old = '<textarea placeholder="Old user field" />';
    const mixed = old + '<textarea placeholder="New review" />';
    const normalized = labelAuthoredFields('src/App.tsx', old, mixed).code;
    expect(normalized.startsWith(old)).toBe(true);
    expect(normalized).toContain('aria-label="New review"');
    expect(normalized).not.toContain('aria-label="Old user field"');
  });
  it('does not guess absent/dynamic/component labels, overwrite explicit names or rewrite fixtures', () => {
    for (const code of ['<textarea />','<textarea placeholder={hint} />','<Textarea placeholder="Hint" />', '<textarea placeholder="Hint" aria-label="Explicit" />', '<label>Comment<textarea placeholder="Hint" /></label>']) {
      expect(labelAuthoredFields('src/App.tsx', '', code).code).toBe(code);
    }
    for (const path of ['tests/App.tsx','src/App.test.tsx','node_modules/x/App.tsx','dist/App.html','src/data.json']) expect(labelAuthoredFields(path,'',raw).code).toBe(raw);
  });
  it('the real one-shot writer acknowledges normalized bytes, preserves old fields, and preserves steering-yield ownership', async () => {
    const written: Array<{path:string;content:string}> = [];
    const old = '<textarea placeholder="User owned" />';
    const result = await runOneShot({prompt:'Continue review app',framework:'vite-react',scaffoldPaths:['src/App.tsx'], readExisting:async()=>old,
      generate:async()=>`<<<FILE src/App.tsx>>>\n${old}${raw}\n<<<ENDFILE>>>`,writeFiles:async files=>{written.push(...files);}});
    expect(result.ok).toBe(true);
    expect(written[0].content).toContain('aria-label="Write your review"');
    expect(written[0].content).not.toContain('aria-label="User owned"');
    let cancelled = false, writes = 0;
    const cancelledResult = await runOneShot({prompt:'review',framework:'vite-react',scaffoldPaths:['src/App.tsx'],
      readExisting:async()=>{cancelled=true;return '';},yieldRequested:()=>cancelled,
      generate:async()=>`<<<FILE src/App.tsx>>>\n${raw}\n<<<ENDFILE>>>`,writeFiles:async()=>{writes++;}});
    expect(cancelledResult.ok).toBe(false);
    expect(writes).toBe(0);
  });
  it('the real manifest lane writes labelled acknowledged bytes and never mutates unchanged user fields', async () => {
    const written: Array<{path:string;content:string}> = [];
    const old = '<textarea placeholder="User owned" />';
    const result = await runSimpleBuild({prompt:'Review app',framework:'vite-react',scaffoldPaths:['src/App.tsx'], shareContract:false,
      readExisting:async()=>old,
      generate:async(_sys,user)=> {
        if(user.includes('Plan the file list')) return 'src/App.tsx :: review app\nsrc/Review.tsx :: review fields';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)||[])[1]?.trim()||'src/App.tsx';
        return `<<<FILE ${path}>>>\n${path==='src/App.tsx' ? old : ''}${raw}\n<<<ENDFILE>>>`;
      },writeFiles:async files=>{written.push(...files);}});
    expect(result.ok).toBe(true);
    expect(written.length).toBeGreaterThan(0);
    expect(written.every(f=>f.content.includes('aria-label="Write your review"'))).toBe(true);
    expect(written.find(f=>f.path==='src/App.tsx')?.content).not.toContain('aria-label="User owned"');
  });
  it('manifest lane also yields if steering arrives during the new source-read await', async () => {
    let requested=false,writes=0;
    const result=await runSimpleBuild({prompt:'Review app',framework:'vite-react',scaffoldPaths:['src/App.tsx'],shareContract:false,
      yieldRequested:()=>requested,readExisting:async()=>{requested=true;return '';},
      generate:async(_sys,user)=> {
        if(user.includes('Plan the file list')) return 'src/App.tsx :: review app\nsrc/Review.tsx :: review fields';
        const file=(user.match(/write THIS file in full:\s*\n\s*([^\n]+)/)||[])[1]?.trim()||'src/App.tsx';
        return `<<<FILE ${file}>>>\n${raw}\n<<<ENDFILE>>>`;
      },writeFiles:async()=>{writes++;}});
    expect(result.ok).toBe(false);expect(writes).toBe(0);
  });
  it('actual guarded tool writes and edit siblings use the shared normalizer, including explicit remove controls', async () => {
    const store = new Map<string,string>();
    const actuator: ActuatorPort = {readFile:async(_workspace:string,path:string)=>{if(!store.has(path)) throw Object.assign(new Error('ENOENT file not found'),{code:'ENOENT'});return store.get(path)!;},
      writeFile:async(_workspace:string,path:string,content:string)=>{store.set(path,content);},listFiles:async()=>[],runCommand:async()=>({stdout:'',stderr:'',exitCode:0})};
    const dispatcher = new ToolDispatcher(actuator,'br1956-label');
    await (dispatcher as any).guardedWrite('src/App.tsx',raw,{agent:'engineer',source:'br1956-label-fixture'});
    expect(store.get('src/App.tsx')).toContain('aria-label="Write your review"');
    const original=store.get('src/App.tsx')!;
    const edit = await dispatcher.dispatch({id:'label-edit',name:'edit_file',input:{path:'src/App.tsx',old_string:original,new_string:original+'<input placeholder="Question feedback" />'}},'engineer');
    expect(edit.is_error).not.toBe(true);
    expect(store.get('src/App.tsx')).toContain('aria-label="Question feedback"');
    const toolSource = fs.readFileSync(path.join(__dirname,'../src/server/AgentV3/ToolDispatcher.ts'),'utf8');
    expect(toolSource).toContain('const labels = labelAuthoredFields(rel, existingContent, content)');
    expect(toolSource).toContain('const labels = labelAuthoredFields(path, existing, editKit.content)');
  });
});
