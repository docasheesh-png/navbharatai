/** Six isolated acceptance fixtures using reviewed local bytes, not generated user games or live publishing. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,symlink} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {generateGame3D} from '../../src/server/lib/Game3DGenerator';
import {generateGameAssetRuntime} from '../../src/server/lib/GameAssetRuntimeGenerator';
import {REVIEWED_GAME_ASSETS} from '../../src/server/AgentV3/gameAssets/providers';

async function main(){
const [output,admitted,playwrightPath,chromiumPath]=process.argv.slice(2);assert.ok(output&&admitted&&playwrightPath&&chromiumPath,'Supply output, reviewed bytes directory, Playwright module and Chromium executable');const {chromium}=await import(pathToFileURL(resolve(playwrightPath)).href);const root=resolve(output);await mkdir(root,{recursive:true});try{await symlink(resolve('node_modules'),join(root,'node_modules'))}catch{}
const write=async(p:string,s:any)=>{await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),s)};
for(const [p,s] of Object.entries(generateGame3D(['objects']).files))await write(p,s);
await write('runtime.ts',generateGameAssetRuntime());
for(const c of REVIEWED_GAME_ASSETS)await write('public/game-assets/'+c.sha256+'.glb',await readFile(join(resolve(admitted),c.sha256+'.glb')));
await write('public/game-assets/manifest.json',JSON.stringify(REVIEWED_GAME_ASSETS));
await write('public/game-assets/ATTRIBUTION.txt',REVIEWED_GAME_ASSETS.map(c=>c.license.attribution+'\n'+c.license.evidenceUrl).join('\n\n'));
await write('index.html','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px sans-serif;background:#edf6ff}canvas{display:block}header{position:fixed;top:0;padding:12px;background:#fffffff0;width:100%;box-sizing:border-box}button{font:inherit;padding:12px;margin-top:8px}a{background:white;padding:5px;font:11px sans-serif;max-width:95%}</style></head><body><header><div id="title"></div><button id="move">Move forward</button><div id="score">Distance: 0</div></header><script type="module" src="/main.ts"></script></body></html>');
await write('main.ts',`import * as THREE from 'three';import {loadGameAsset} from './runtime';import {createAnimal,createTree,createRoad} from './src/game/three/objects';
const catalog=${JSON.stringify(REVIEWED_GAME_ASSETS)};const mode=new URLSearchParams(location.search).get('scene')||'human';
const c=catalog[mode==='human'?0:mode==='car'?1:mode==='train'?4:mode==='ship'?5:mode==='bird'?6:3];
const h=await loadGameAsset({sha256:c.sha256,height:c.height,yaw:c.yaw,animation:c.animationRoles?.walk??c.animationRoles?.fly,attributionCredit:c.license.spdx==='CC-BY-4.0'?c.license.author+' CC BY 4.0':undefined},()=>{throw Error('real model failed')});
const scene=new THREE.Scene();scene.background=new THREE.Color(0xd9edff);scene.add(new THREE.HemisphereLight(0xffffff,0x658456,3));const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(4,8,6);scene.add(sun);
scene.add(h.root);const procedural=[];
let station=false;
if(mode==='bird')h.root.position.y=2;
if(mode==='train'){station=true;const box=(x,y,z,w,height,d,color)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,height,d),new THREE.MeshStandardMaterial({color}));o.position.set(x,y,z);scene.add(o)};box(3,.25,0,2,.5,16,0xaaa99b);box(3,3.8,0,2.8,.2,16,0x356c78);for(const z of [-6,-2,2,6])box(3,2,z,.15,3.5,.15,0xc2b59e);for(const x of [-.7,.7])box(x,.02,0,.08,.08,30,0x444444);for(let z=-14;z<=14;z+=1)box(0,-.02,z,2,.08,.16,0x694e37);}

if(mode==='animals'){h.root.position.set(-1.8,0,1.5);for(const [i,kind] of ['dog','cow','horse'].entries()){const a=createAnimal({kind});a.root.position.set(i===0?1.8:i===1?-1.8:1.8,0,i===0?1.5:-2);scene.add(a.root);procedural.push(a)}const tree=createTree({height:4});tree.position.set(0,0,-5);scene.add(tree);}
if(mode==='car'){const road=createRoad({length:18,width:5});road.position.y=-.03;scene.add(road)}
const floor=new THREE.Mesh(new THREE.PlaneGeometry(35,35),new THREE.MeshStandardMaterial({color:mode==='ship'?0x348ab4:mode==='car'?0x6b9864:0x8fbf76}));floor.rotation.x=-Math.PI/2;floor.position.y=-.06;scene.add(floor);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.01,200);camera.position.set(...(mode==='animals'?[8,10,15]:mode==='train'?[-20,14,26]:mode==='ship'?[18,12,24]:mode==='bird'?[8,6,12]:mode==='car'?[7,5,10]:[6,3.5,8]));camera.lookAt(mode==='animals'?0:0,mode==='bird'?2.2:mode==='animals'?1.2:.9,0);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
const pose=()=>{h.root.updateMatrixWorld(true);const p=[];h.root.traverse(o=>p.push(...o.matrixWorld.elements));return p};const before=pose();for(let i=0;i<5;i++)h.update(.1);const after=pose();let moves=0;
function move(){h.root.position.z+=.3;moves++;document.querySelector('#score').textContent='Distance: '+(moves*.3).toFixed(1)}addEventListener('keydown',e=>{if(e.key==='ArrowUp')move()});document.querySelector('#move').addEventListener('click',move);document.querySelector('#title').textContent=mode==='human'?'Walking character fixture':mode==='car'?'Driving car fixture':mode==='train'?'Train and procedural station fixture':mode==='ship'?'Moving ship fixture':mode==='bird'?'Flying eagle fixture':'Animals and environment fixture';
function tick(){h.update(.016);procedural.forEach(a=>a.update(.016,1));renderer.render(scene,camera);requestAnimationFrame(tick)}tick();window.__scenario=()=>({mode,source:h.source,moves,z:h.root.position.z-(mode==='animals'?1.5:0),animated:after.some((v,i)=>Math.abs(v-before[i])>1e-6),triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,overflow:document.documentElement.scrollWidth>innerWidth,procedural:procedural.length,station});`);
execFileSync(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'build','--base=/published/','--target=es2022'],{cwd:root,stdio:'inherit',timeout:60000});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url??'/','http://localhost');assert.ok(url.pathname.startsWith('/published/')&&!url.pathname.includes('..'));const p=url.pathname.slice(11)||'index.html';res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.glb')?'model/gltf-binary':'text/plain');res.end(await readFile(join(root,'dist',p)))}catch{res.statusCode=404;res.end()}});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address()as any).port;
const browser=await chromium.launch({executablePath:resolve(chromiumPath),headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
try{const page=await browser.newPage({viewport:{width:390,height:844}});const external:string[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort()}return route.continue()});
const results=[];for(const mode of ['human','car','animals','train','ship','bird']){for(let reload=0;reload<2;reload++){await page.goto(origin+'/published/?scene='+mode);await page.waitForFunction('Boolean(window.__scenario)');await page.keyboard.press('ArrowUp');await page.locator('#move').click();const p=await page.evaluate('window.__scenario()');assert.equal(p.source,'model');assert.equal(p.moves,2);assert.ok(Math.abs(p.z-.6)<1e-6);assert.equal(p.overflow,false);assert.ok(p.triangles>0&&p.triangles<60000);if(['human','animals','bird'].includes(mode))assert.equal(p.animated,true);if(mode==='train')assert.equal(p.station,true);if(mode==='animals')assert.equal(p.procedural,3);results.push({...p,reload});}await page.screenshot({path:join(root,mode+'.png')});}assert.deepEqual(external,[]);assert.deepEqual(errors,[]);await write('results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));console.log('PASS six isolated local playable fixtures: real reviewed human/car/fox/train/ship/eagle; procedural station/dog/cow/horse/tree. Keyboard/button movement, animation and production artifact reload. Not six generated user games, physical mobile or live publication.');}
finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()))}
}
main().catch(e=>{console.error(e);process.exitCode=1});
