// Mounted presentation checks. Request cancellation/race semantics live in gatewayChatHookTerminal.test.ts.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
const require=createRequire(join(process.cwd(),'package.json'));
const React=require('react');const {createRoot}=require('react-dom/client');
if(!process.argv[2])throw Error('Provide the existing Happy DOM module path; this script installs nothing.');
const {Window}=await import(pathToFileURL(resolve(process.argv[2])).href);
const window=new Window();Object.assign(globalThis,{window,document:window.document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const cache=join(process.cwd(),'node_modules','.cache');mkdirSync(cache,{recursive:true});const temp=mkdtempSync(join(cache,'reply-pending-'));
let root;let checks=0;
const originalSetTimeout=globalThis.setTimeout, originalClearTimeout=globalThis.clearTimeout;
const timers=new Map();let nextTimer=0;
globalThis.setTimeout=(callback,delay,...args)=>{
 if(delay!==10000)return originalSetTimeout(callback,delay,...args);
 const id=++nextTimer;timers.set(id,callback);return id;
};
globalThis.clearTimeout=id=>{if(timers.has(id))timers.delete(id);else originalClearTimeout(id);};
try{
 const output=join(temp,'pending.cjs');
 buildSync({entryPoints:['src/components/chat/ReplyPendingStatus.tsx'],outfile:output,bundle:true,platform:'node',format:'cjs',external:['react']});
 const {ReplyPendingStatus}=require(output);
 const element=document.createElement('div');document.body.append(element);root=createRoot(element);
 const check=(condition,message)=>{assert.ok(condition,message);checks++};
 const render=async(pending,key='turn-1')=>React.act(async()=>root.render(React.createElement(ReplyPendingStatus,{pending,key})));
 await render(false);check(!element.querySelector('[role=status]'),'idle empty');
 await render(true);check(element.textContent==='Preparing your reply… 🤔','English UI status');
 check(element.querySelector('[role=status]')?.getAttribute('aria-live')==='polite','accessible polite status');
 check(timers.size===1,'one 10000ms timer for the active request');
 const firstTimer=[...timers.values()][0];
 await React.act(async()=>firstTimer());
 check(element.textContent==='Your reply is taking a little longer. Please wait.','ten-second delay is truthful');
 check(!/busy|overload|try again/i.test(element.textContent),'no invented cause or premature retry');
 await render(true,'turn-2');check(element.textContent==='Preparing your reply… 🤔','new request resets timer and copy');
 await React.act(async()=>firstTimer());check(element.textContent==='Preparing your reply… 🤔','old timer cannot affect new request');
 check(timers.size===1,'old request timer cleaned up');
 await render(true);check(element.querySelectorAll('[role=status]').length===1,'repeat render no duplicate');
 for(const outcome of ['success','error','cancel']){await render(false);check(!element.querySelector('[role=status]'),outcome+' clears when pending ends');await render(true);}
 const stale=[...timers.values()][0];
 await React.act(async()=>root.unmount());root=null;check(!element.querySelector('[role=status]'),'navigation unmount clears');
 check(timers.size===0,'navigation clears timer');await React.act(async()=>stale());check(!element.querySelector('[role=status]'),'late timer cannot revive unmounted status');
 console.log(JSON.stringify({mountedPresentationChecksPassed:checks,networkRequests:0}));
}finally{globalThis.setTimeout=originalSetTimeout;globalThis.clearTimeout=originalClearTimeout;if(root)await React.act(async()=>root.unmount());await window.happyDOM.close();rmSync(temp,{recursive:true,force:true});}
