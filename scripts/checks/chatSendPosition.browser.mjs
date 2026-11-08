// Offline regression: node scripts/checks/chatSendPosition.browser.mjs /path/to/playwright /tmp/send-evidence
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
const {chromium}=await import(pathToFileURL(resolve(process.argv[2],'index.mjs')).href);
const output=resolve(process.argv[3]);await mkdir(output,{recursive:true});
const scratch=await mkdtemp(join(tmpdir(),'chat-send-'));
const source=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ComposerShell,COMPOSER_TEXTAREA_CLASS,COMPOSER_SEND_CLASS,COMPOSER_STOP_CLASS,COMPOSER_ICON_CLASS}from'./src/components/chat/ComposerShell';
import{ChatToolbar}from'./src/components/chat/ChatToolbar';
import{enterShouldSend}from'./src/lib/chatToolbar';import{autoGrow}from'./src/lib/autoGrowTextarea';
function App(){const[input,setInput]=useState('');const[busy,setBusy]=useState(false);const[attached,setAttached]=useState(false);const[tools,setTools]=useState(true);const[position,setPosition]=useState('bottom-right');const[sendOnEnter,setSendOnEnter]=useState(true);
window.actions??=[];window.fixture={setInput,setBusy,setAttached,setTools,setPosition};const send=()=>{window.actions.push('send');setInput('');setAttached(false)};
return <div style={{height:'100dvh',display:'flex',flexDirection:'column',paddingBottom:'var(--nb-safe-bottom,0px)'}}><div style={{flex:1}}>AI chat</div><div style={{padding:12}}>
<ChatToolbar messageCount={0} sendOnEnter={sendOnEnter} onSendOnEnterChange={setSendOnEnter} searchQuery="" onSearchQueryChange={()=>{}} searchOpen={false} onSearchOpenChange={()=>{}} />
<ComposerShell sendPosition={position} controls={tools?<>{['Attach','Microphone','Speaker'].map(name=><button key={name} aria-label={name} className={COMPOSER_ICON_CLASS} onClick={()=>{window.actions.push(name);if(name==='Attach')setAttached(v=>!v)}}><span style={{width:16,height:16}}>{name==='Attach'?'＋':name==='Microphone'?'♪':'◖'}</span></button>)}</>:null}
send={<>{busy&&<button aria-label="Queue question" disabled={!input.trim()||attached} onClick={()=>window.actions.push('queue')}>Queue</button>}{busy?<button aria-label="Stop" className={COMPOSER_STOP_CLASS} onClick={()=>{window.actions.push('stop');setBusy(false)}}>■</button>:<button aria-label="Send message" className={COMPOSER_SEND_CLASS} disabled={!input.trim()&&!attached} onClick={send}>↑</button>}</>}>
<textarea aria-label="Message" rows={1} placeholder="Ask NavBharatAI..." value={input} className={COMPOSER_TEXTAREA_CLASS} onChange={e=>{setInput(e.target.value);autoGrow(e.target,240)}} onKeyDown={e=>{if(enterShouldSend({key:e.key,shiftKey:e.shiftKey,sendOnEnter,hasContent:!!input.trim()||attached,isBusy:busy,isComposing:e.nativeEvent.isComposing})){e.preventDefault();send()}}}/>
</ComposerShell></div></div>};createRoot(document.getElementById('root')).render(<App/>);`;
await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'esm',outfile:join(scratch,'fixture.js'),jsx:'automatic'});
const css=(await Promise.all((await readdir('dist/assets')).filter(f=>f.endsWith('.css')).map(f=>readFile(join('dist/assets',f),'utf8')))).join('\n');
const js=await readFile(join(scratch,'fixture.js'));
const server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script>')}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const box=()=>page.locator('.nb-composer-box'), text=()=>page.getByRole('textbox',{name:'Message'}), send=()=>page.getByRole('button',{name:'Send message',exact:true});
 async function geometry(label='Send message'){
  const b=await box().boundingBox(),s=await page.getByRole('button',{name:label,exact:true}).boundingBox(),t=await text().boundingBox();
  assert(b.x+b.width-s.x-s.width>=9&&b.x+b.width-s.x-s.width<=13,'right inset');
  assert(b.y+b.height-s.y-s.height>=9&&b.y+b.height-s.y-s.height<=13,'bottom inset');
  assert(t.y+t.height<=s.y,'text never overlaps action');
  const toolbar=page.locator('[data-composer-toolbar]');const tools=toolbar.locator('.overflow-x-auto');
  const c=await tools.boundingBox(),slot=await page.locator('.nb-composer-send-slot').boundingBox();assert(c.x+c.width<=slot.x,'tools reserve entire send/queue slot');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert(b.y>=0&&b.y+b.height<=page.viewportSize().height,'composer fits viewport');
 }
 for(const [width,height]of[[320,800],[390,800],[390,320],[768,800],[1280,800]]){
  await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${server.address().port}`);await send().waitFor();
  await page.evaluate(()=>document.documentElement.style.setProperty('--nb-safe-bottom','34px'));
  assert.equal(await send().isDisabled(),true);await geometry();
  await text().fill('A short public question');await geometry();assert.equal(await send().isEnabled(),true);
  if(width===390&&height===800)await page.screenshot({path:join(output,'mobile-short.png')});
  await text().fill('A long public question. '.repeat(100)+'\nLast line.');await geometry();
  const grown=await text().boundingBox();assert(grown.height>44);assert(await text().evaluate(el=>el.scrollHeight>el.clientHeight),'long text scrolls internally');
  if(height===320)await page.screenshot({path:join(output,'mobile-keyboard-height.png')});
  await page.evaluate(()=>window.fixture.setBusy(true));await page.getByRole('button',{name:'Stop',exact:true}).waitFor();await geometry('Stop');
  assert.equal(await page.getByRole('button',{name:'Queue question'}).isEnabled(),true);
  await page.getByRole('button',{name:'Queue question'}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.actions.slice(-2)),['queue','stop']);
  await text().fill('');await page.getByRole('button',{name:'Attach',exact:true}).click();assert.equal(await send().isEnabled(),true);await send().click();
  assert.equal(await send().isDisabled(),true);
  for(const name of['Microphone','Speaker'])await page.getByRole('button',{name,exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.actions.slice(-2)),['Microphone','Speaker']);
  await text().fill('Enter sends');await text().press('Enter');assert.equal(await text().inputValue(),'');
  await text().fill('Shift adds a line');await text().press('Shift+Enter');assert.match(await text().inputValue(),/\n/);
  if(width<640){const preference=page.locator('.nb-send-enter-toggle');await preference.click();assert.equal(await preference.getAttribute('aria-pressed'),'false');await text().fill('Enter adds a line');await text().press('Enter');assert.match(await text().inputValue(),/\n/);await text().press('Shift+Enter');assert.equal(await text().inputValue(),'');}
  await page.evaluate(()=>window.fixture.setTools(false));await geometry();
  await page.evaluate(()=>{window.fixture.setTools(true);window.fixture.setPosition('text')});
  await page.waitForFunction(()=>!document.querySelector('[data-composer-send-position]'));
  const s=await send().boundingBox(),t=await text().boundingBox(),bar=await page.locator('[data-composer-toolbar]').boundingBox();
  assert(s.y+s.height<=bar.y+2,'other surfaces keep send on textarea row');assert(s.y<t.y+t.height);
 }
 assert.deepEqual(errors,[]);await writeFile(join(output,'results.json'),JSON.stringify({passed:true,viewports:[[320,800],[390,800],[390,320],[768,800],[1280,800]],externalRequestsAllowed:false},null,2));
 console.log('PASS: inset lower-right Send/Stop, dynamic Queue width, text/tool clearance, auto-grow, preferences, keyboard, disabled/attachment states and unchanged default surface.');
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(scratch,{recursive:true,force:true})}
