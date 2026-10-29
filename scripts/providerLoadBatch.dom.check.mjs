import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
if(!process.argv[2])throw Error('Pass installed Happy DOM entry; no software is installed.');
const {Window}=await import(pathToFileURL(resolve(process.argv[2])).href),window=new Window({url:'http://localhost'});
for(const name of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','MouseEvent'])Object.defineProperty(globalThis,name,{configurable:true,value:name==='window'?window:window[name]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const require=createRequire(resolve('package.json')),React=require('react'),{createRoot}=require('react-dom/client');
const output=resolve('node_modules/.cache/providerLoadBatch.dom.mjs');require('esbuild').buildSync({entryPoints:['src/components/admin/ProviderLoadBatchPanel.tsx'],outfile:output,bundle:true,platform:'node',format:'esm',external:['react','react/jsx-runtime']});
const {ProviderLoadBatchPanel}=await import(pathToFileURL(output).href);
let calls=[],reply={batch:null,settings:null},ok=true,resolveWave;
globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/advance')&&resolveWave===null)return new Promise(resolve=>{resolveWave=()=>resolve({ok:true,json:async()=>({batch:{...batch,next:2,completed:2,count:2}})});});return {ok,json:async()=>reply};};
let node,root;async function mount(token){node=document.createElement('div');document.body.append(node);root=createRoot(node);await React.act(async()=>root.render(React.createElement(ProviderLoadBatchPanel,{adminToken:token})));}
async function click(text){const b=[...node.querySelectorAll('button')].find(b=>b.textContent===text);assert(b,text);await React.act(async()=>{b.click();b.click();});}
async function unmount(){await React.act(async()=>root.unmount());node.remove();}
const batch={scopeId:'original-scope',revision:1,next:0,count:2,active:0,completed:0,concurrency:2,stopped:false,spentNanoUsd:48822000,heldNanoUsd:0,model:'configured',authority:{totalBudgetNanoUsd:10000000000,priorAttempts:640,priorCostNanoUsd:48822000,maxOutputTokens:2048,maxAttemptNanoUsd:1000}};
await mount('');assert.equal(node.innerHTML,'');assert.equal(calls.length,0);await unmount();
await mount('synthetic-admin');assert.equal(calls.length,0);reply={batch,settings:{budgetPaise:100000,allInPaisePerUsd:10000}};
await click('Read original batch');assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');
assert(node.textContent.includes('Operator-entered prior spend'));reply={batch:{...batch,revision:2}};
await click('Save approved batch configuration');assert.equal(calls.length,2);const body=JSON.parse(calls.at(-1).options.body);assert.equal(body.expectedRevision,1);assert.equal(body.attempts,2);assert.equal(body.budgetInr,'1000');
resolveWave=null;await click('Run configured batch');assert.equal(calls.length,3);const wave=JSON.parse(calls.at(-1).options.body);assert.match(wave.waveId,/^[0-9a-f-]{36}$/i);
reply={batch:{...batch,revision:3,stopped:true}};await click('Abort unsent work');assert(calls.at(-1).url.endsWith('/stop'));const before=calls.length;
await React.act(async()=>resolveWave());assert.equal(calls.length,before,'abort prevents another wave');assert(node.textContent.includes('Revision: 3'),'late wave acknowledgement cannot overwrite stop revision');assert([...node.querySelectorAll('button')].find(b=>b.textContent==='Run configured batch').disabled);
reply={item:{requestId:'safe-id',provider:'cheaperinference',quality:'fail',actualNanoUsd:null}};await click('Read item receipt');assert.equal(calls.at(-1).options.method,'GET');assert(node.textContent.includes('safe-id'));
await unmount();const count=calls.length;await mount('synthetic-admin');assert.equal(calls.length,count,'remount never auto-dispatches');await unmount();
console.log('PASS mounted batch UI: no mount calls, non-admin exclusion, read-only recovery/receipts, versioned configuration, duplicate start suppression, durable wave identity, abort unsent, and no remount dispatch.');
await window.happyDOM.close();
