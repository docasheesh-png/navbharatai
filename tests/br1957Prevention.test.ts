import { describe, it, expect, vi, afterEach } from 'vitest';
import ts from 'typescript';
import fs from 'node:fs';
import { createSandboxAdmissionBudget, sandboxAdmissionActuator, SANDBOX_ADMISSION_BLOCKED, SANDBOX_ADMISSION_OPERATIONS } from '../src/server/AgentV3/sandboxAdmissionBudget';
import { seedSourceInventory, srcHoldsOnlyOurStarter } from '../src/server/AgentV3/starterFragment';
import { roadmapStandDownMessage, projectModeDiagnosis } from '../src/server/AgentV3/ProjectPlan';
import { lintBuiltApp, designLintSummary, a11yLintSummary } from '../src/server/AgentV3/buildQualityLint';
import { panchangAppTsx, kundaliAppTsx } from '../src/server/AgentV3/goldenScaffolds/indiaPanchang';
import { proUiTsx } from '../src/server/AgentV3/goldenScaffolds/proShell';
import { goldenComponentHarness } from './helpers/goldenComponentHarness';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

const CAPACITY = 'Rate limit exceeded, please try again later - you have reached the maximum number of concurrent E2B sandboxes (20).';
const deferred = () => { let resolve!:()=>void; const promise=new Promise<void>(r=>{resolve=r}); return {promise,resolve}; };
const fail = async () => { throw new Error(CAPACITY); };
function wrapped(methods: Record<string,unknown>) { const budget=createSandboxAdmissionBudget(); const actuator=sandboxAdmissionActuator(methods as never,'mine',budget) as unknown as Record<string,any>;return {budget,actuator}; }
afterEach(()=>vi.unstubAllGlobals());

describe('BR1957 F1 direct admission: setup/list/seed/tools have one build-scoped owner',()=>{
  it('bounds concurrent setup and inventory/seed probes to initial+one real recovery',async()=>{
    const gate=deferred();let attempts=0;
    const op=async()=>{attempts++;await gate.promise;throw new Error(CAPACITY)};
    const {budget,actuator:a}=wrapped({ensureWorkspace:op,listFiles:op,writeFile:op});
    const pending=[a.ensureWorkspace('mine'),a.listFiles('mine'),a.writeFile('mine','src/App.tsx','x')];
    await Promise.resolve();expect(attempts).toBe(1);gate.resolve();
    const results=await Promise.allSettled(pending);
    expect(attempts).toBe(2);expect(budget.exhausted).toBe(true);
    expect((results[2] as PromiseRejectedResult).reason.message).toBe(SANDBOX_ADMISSION_BLOCKED);
  });
  it('recovers once then lets independent writes remain parallel with their own results',async()=>{
    let failures=1;const gate=deferred();let entered=0;
    const {budget,actuator:a}=wrapped({ensureWorkspace:async()=>{if(failures--)throw new Error(CAPACITY);return 'admitted'},writeFile:async(_w:string,p:string)=>{entered++;await gate.promise;return p}});
    await expect(a.ensureWorkspace('mine')).rejects.toThrow(CAPACITY);expect(await a.ensureWorkspace('mine')).toBe('admitted');
    const writes=[a.writeFile('mine','A'),a.writeFile('mine','B')];await Promise.resolve();expect(entered).toBe(2);gate.resolve();
    expect(await Promise.all(writes)).toEqual(['A','B']);expect(budget.exhausted).toBe(false);
  });
  it('does not count a rendered tool error twice or reset admission with a non-sandbox tool',async()=>{
    const {budget,actuator:a}=wrapped({listFiles:fail});
    const call={id:'c',name:'glob',input:{pattern:'*'}};
    const run=async()=>{try{await a.listFiles('mine');return{tool_use_id:'c',is_error:false,content:'files'}}catch(e){return{tool_use_id:'c',is_error:true,content:String(e)}}};
    await budget.dispatch(call,run);expect(budget.exhausted).toBe(false);
    await budget.dispatch(call,run);expect(budget.exhausted).toBe(true);
    const nonSandbox=vi.fn(async()=>({tool_use_id:'t',is_error:false,content:'todo'}));await budget.dispatch({...call,name:'update_todo'},nonSandbox);
    expect(nonSandbox).toHaveBeenCalledOnce();expect(budget.exhausted).toBe(true);
    const third=vi.fn(run);expect((await budget.dispatch(call,third)).content).toBe(SANDBOX_ADMISSION_BLOCKED);expect(third).not.toHaveBeenCalled();
  });
  it.each(['Stopped — the build was asked to stop.','network timeout','npm registry rate limit exceeded'])('does not retry or poison admission on %s',async message=>{
    const op=vi.fn(async()=>{throw new Error(message)});const {budget,actuator:a}=wrapped({ensureWorkspace:op});
    for(let i=0;i<3;i++)await expect(a.ensureWorkspace('mine')).rejects.toThrow(message);
    expect(op).toHaveBeenCalledTimes(3);expect(budget.exhausted).toBe(false);
  });
  it('preserves metadata, synchronous this, lifecycle and another workspace without sharing budgets',async()=>{
    const methods={label:'real',getSandboxId(){return this.label},pause:vi.fn(async()=>true),listFiles:vi.fn(fail)};
    const {budget,actuator:a}=wrapped(methods);await expect(a.listFiles('mine')).rejects.toThrow();await expect(a.listFiles('mine')).rejects.toThrow();
    expect(a.getSandboxId('mine')).toBe('real');expect(await a.pause('mine')).toBe(true);
    await expect(a.listFiles('other')).rejects.toThrow(CAPACITY);expect(methods.listFiles).toHaveBeenCalledTimes(3);expect(budget.exhausted).toBe(true);
    const other=wrapped({listFiles:async()=>['src/App.tsx']});expect(await other.actuator.listFiles('mine')).toEqual(['src/App.tsx']);
  });
  it('a pre-exhausted direct setup budget prevents a real inherited runner buying even one model call',async()=>{
    const {budget,actuator:a}=wrapped({ensureWorkspace:fail});for(let i=0;i<2;i++)await expect(a.ensureWorkspace('mine')).rejects.toThrow();
    const events=new AgentEventStream();const runTurn=vi.fn();const runner=new AgentRunner({client:{runTurn},dispatcher:{dispatch:vi.fn(),changeCount:()=>0,frameworkId:'vite-react'} as never,state:new WorkspaceState(events),events,model:'fixture',system:'fixture',tools:defaultToolCatalog(),maxSteps:9,sandboxAdmissionBudget:budget});
    const result=await runner.run('Build a panchang app');expect(result.ok).toBe(false);expect(result.summary).toBe(SANDBOX_ADMISSION_BLOCKED);expect(runTurn).not.toHaveBeenCalled();
  });
  it('all direct public getSandbox owners are guarded, without guarding lifecycle/synchronous observers',()=>{
    const src=fs.readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts','utf8');
    const file=ts.createSourceFile('e.ts',src,ts.ScriptTarget.Latest,true);const direct=new Set<string>();
    const visit=(n:ts.Node):void=>{if(ts.isMethodDeclaration(n)&&n.name&&n.body&&/\bthis\.getSandbox\(/.test(n.body.getText(file))&&!n.modifiers?.some(x=>x.kind===ts.SyntaxKind.PrivateKeyword)){direct.add(n.name.getText(file))}ts.forEachChild(n,visit)};visit(file);
    expect([...direct].filter(x=>x!=='getSandbox')).not.toEqual([]);
    for(const name of direct)expect(SANDBOX_ADMISSION_OPERATIONS.has(name),name).toBe(true);
    for(const name of ['ensureWorkspace','runCommand','writeFile','writeBinaryFile','readFile','listFiles'])expect(SANDBOX_ADMISSION_OPERATIONS.has(name)).toBe(true);
    for(const name of ['getSandboxId','pause','destroy','release','getObservation'])expect(SANDBOX_ADMISSION_OPERATIONS.has(name)).toBe(false);
    const route=fs.readFileSync('src/server/routes/agentv3.ts','utf8');expect(route).toContain('const actuator = sandboxAdmissionActuator(');expect(route).toContain('intentWorkspaceId, sandboxAdmissionBudget)');
  });
});

describe('BR1957 F2 inventory failures are not empty-workspace proof',()=>{
  it.each([null,{},['src/App.tsx',null]])('refuses malformed inventory %j',async raw=>{expect(await seedSourceInventory(async()=>raw as never)).toBeNull()});
  it('preserves unknown failure, known empty and actual user-source outcomes',async()=>{
    expect(await seedSourceInventory(async()=>{throw new Error('capacity')})).toBeNull();
    expect(await seedSourceInventory(async()=>['package.json','index.html'])).toEqual([]);
    const files=await seedSourceInventory(async()=>['src/App.tsx','package.json']);expect(files).toEqual(['src/App.tsx']);
    expect(await srcHoldsOnlyOurStarter(files!,async()=>'<main>user data</main>')).toBe(false);
  });
  it('golden and game-kit doors both require positively known inventories and preserve source-owner reads',()=>{
    const route=fs.readFileSync('src/server/routes/agentv3.ts','utf8');expect(route.match(/const existingSrc = await seedSourceInventory\(/g)).toHaveLength(2);
    expect(route.match(/existingSrc !== null && \(existingSrc.length === 0 \|\| await srcHoldsOnlyOurStarter\(/g)).toHaveLength(2);
    expect(route).not.toMatch(/const existingSrc = [^;]*listFiles\(workspaceId\)\.catch\(/);
  });
});

describe('BR1957 F3 selection is not delivery, in both planner diagnostics',()=>{
  it('retains optimized selection but never claims an already-seeded app',()=>{
    const roadmap=roadmapStandDownMessage('template-is-the-app' as never);expect(roadmap).toContain('verify and polish');expect(roadmap).toContain('must still confirm successful seeding');expect(roadmap).not.toMatch(/already seeded|whole app exists/);
    const s=fs.readFileSync('src/server/AgentV3/ProjectPlan.ts','utf8');expect(s).not.toContain('already seeded and is the finished app');
    expect(projectModeDiagnosis).toBeTypeOf('function');
  });
});

describe('BR1957 F4 advisory scope must not award a perfect page to four hooks/types',()=>{
  it('emits no perfect design/WCAG claim for logic-only sources, including TSX type parameters',()=>{
    const r=lintBuiltApp({'src/types.ts':'export interface City {name:string}', 'src/hooks/useTheme.ts':'const theme="light"','src/hooks/useCityStorage.tsx':'const city=useState<City>(null)', 'src/hooks/useCalculation.ts':'export const answer=42'})!;
    expect(r.markupObserved).toBe(false);expect(r.designObserved).toBe(false);
    expect(a11yLintSummary(r)).toMatch(/not scored.*no UI markup/);expect(designLintSummary(r)).toMatch(/not scored.*no UI markup/);
    expect(a11yLintSummary(r)+designLintSummary(r)).not.toMatch(/100\/100|cohesive palette|no common WCAG/);
  });
  it.each(['tsx','jsx','html','vue','svelte','astro'])('still measures actual markup and reports real faults in %s',ext=>{
    const r=lintBuiltApp({['src/App.'+ext]:'<main><img src="x"/><button>Save</button></main>'})!;expect(r.markupObserved).toBe(true);expect(a11yLintSummary(r)).not.toContain('not scored');expect(r.a11y.violations.length).toBeGreaterThan(0);
  });
  it('stylesheet-only design is measured while accessibility remains unknown; comments and injected markup cannot manufacture evidence',()=>{
    const r=lintBuiltApp({'src/style.css':'body { color: red; }'})!;expect(r.designObserved).toBe(true);expect(r.markupObserved).toBe(false);expect(designLintSummary(r)).not.toContain('not scored');expect(a11yLintSummary(r)).toContain('not scored');
    const comment=lintBuiltApp({'src/App.tsx':'// <main>Hello</main>\nexport type T = string;'})!;expect(comment.markupObserved).toBe(false);
  });
  it('no absence flag suppresses actual positive lint findings or changes the raw score rules',()=>{
    const r=lintBuiltApp({'src/helper.ts':'const html = "<img src=\"x\"/>";'})!;expect(r.a11y.violations.length).toBeGreaterThan(0);expect(a11yLintSummary(r)).not.toContain('not scored');
    const ui=lintBuiltApp({'src/App.tsx':'export default ()=> <main><h1>Hello</h1></main>'})!;expect(ui.a11y.score).toBe(100);expect(a11yLintSummary(ui)).toContain('100/100');
  });
});

// Independent full Meeus series, PyMeeus0.5.12 geocentric_ecliptical_pos; also matches the public
// 1992Apr12 example133.162655 at https://pymeeus.readthedocs.io/en/stable/examples/ex-Moon.html.
const lunarReference = [[2415020.5,272.41227018231774],[2433447.5,75.94197446838609],[2448724.5,133.162654685159],[2451544.5,217.28831538603117],[2461353.5,223.23353262999115],[2462580.5,182.84697147861132],[2470171.5,132.42689815997718],[2488069.5,157.40005092888782]];
function generatedMath(source:string) {
  const exports:Record<string,any>={};
  const extra='\nexport {moonLon,civilDate,coordinateText,validCoordinates'+(source.includes('function chartFor(')?',chartFor':'')+'};';
  const js=ts.transpileModule(source+extra,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','exports',js)(()=>({}),exports);return exports;
}
describe.each([['Panchang',panchangAppTsx],['Kundali sibling',kundaliAppTsx]])('BR1957 F5/F6 exact generated %s mathematics and admission',(_name,source)=>{
  const math=generatedMath(source);
  it.each(lunarReference)('uses the independent lunar longitude near JD%s', (jd,expected)=>{
    const error=Math.abs(((math.moonLon(jd)-expected+540)%360)-180);expect(error).toBeLessThan(0.1);
  });
  it.each(['2026-02-30','2023-02-29','0000-01-01','2026-13-01','2026-00-01','2026-01-00','2026-1-01','garbage'])('rejects impossible or partial civil date %s',value=>expect(math.civilDate(value)).toBeNull());
  it('keeps leap days and years1–99 without the native Date1900 offset',()=>{expect(math.civilDate('2024-02-29').weekday).toBe(4);expect(math.civilDate('0001-01-01')).toMatchObject({y:1,weekday:1});expect(math.civilDate('0099-01-01').y).toBe(99)});
  it.each([['',77],['bad',77],['91',77],['28',181],['Infinity',0],['28x',77]])('rejects invalid coordinates %s %s instead of silently calculating at zero', (lat,lon)=>expect(math.validCoordinates(math.coordinateText(String(lat)),Number(lon))).toBe(false));
  it('accepts real equator/prime-meridian zero and the documented coordinate boundaries',()=>{expect(math.validCoordinates(math.coordinateText('0'),0)).toBe(true);expect(math.validCoordinates(-90,180)).toBe(true);expect(math.validCoordinates(90,-180)).toBe(true)});
});
describe('BR1957 rendered-seed behavior, not only presence of helper functions',()=>{
  it('Panchang hides results on invalid custom coordinates and restores valid zero inputs/date',()=>{
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});const h=goldenComponentHarness(panchangAppTsx);
    h.nodes().find(n=>n.type==='button'&&String(n.props.onClick).includes('setManual'))!.props.onClick();h.flush();
    const coordinates=()=>h.nodes().filter(n=>n.type==='input'&&n.props['aria-label']);
    coordinates()[0].props.onChange({target:{value:''}});h.flush();expect(h.text()).toContain('valid date and coordinates');
    coordinates()[0].props.onChange({target:{value:'0'}});coordinates()[1].props.onChange({target:{value:'0'}});h.flush();expect(h.text()).not.toContain('valid date and coordinates');
    h.nodes().find(n=>n.type==='input'&&n.props.type==='date')!.props.onChange({target:{value:'2026-02-30'}});h.flush();expect(h.text()).toContain('valid date and coordinates');
    h.dispose();
  });
  it('Kundali chart admission rejects malformed date/time/position instead of fabricating a chart',()=>{
    const {chartFor}=generatedMath(kundaliAppTsx);const good={dob:'1992-04-12',tob:'06:30',lat:28.6,lon:77.2};expect(chartFor(good)?.houses).toHaveLength(12);
    for(const change of [{dob:'2026-02-30'},{tob:'24:01'},{tob:'06:99'},{tob:'6:30'},{lat:91},{lon:-181},{lat:NaN}])expect(chartFor({...good,...change})).toBeNull();
  });
});


describe('BR1957 F7 shared select names exclude their option inventory',()=>{
  it('the actual standalone shared Select exposes exactly the requested label',()=>{
    const exports:Record<string,any>={};const jsx=(type:unknown,props:Record<string,unknown>)=>({type,props});
    const js=ts.transpileModule(proUiTsx,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    new Function('require','exports',js)((name:string)=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:{},exports);
    const tree=exports.Select({label:'जन्म स्थान',value:'0',onChange:()=>{},options:[{value:'0',label:'Delhi'},{value:'1',label:'Mumbai'}]});
    const select=tree.props.children.find((n:any)=>n.type==='select');expect(select.props['aria-label']).toBe('जन्म स्थान');
    expect(select.props.children).toHaveLength(2);expect(select.props.value).toBe('0');
  });
});
