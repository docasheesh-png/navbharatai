import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCanaryTool, runCanaryBuildStep } from '../scripts/benchmark-sandbox/run.mjs';
const roots: string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(path.join(tmpdir(),'offline-canary-runner-'));roots.push(root);await mkdir(path.join(root,'src'));return root;}
describe('offline immutable sandbox runner',()=>{
  it('writes/reads/lists only bounded synthetic app files',async()=>{const root=await fixture();await runCanaryTool({name:'write_file',path:'src/App.jsx',content:'synthetic'},root);expect(await runCanaryTool({name:'read_file',path:'src/App.jsx'},root)).toEqual({content:'synthetic'});expect(await runCanaryTool({name:'list_files',path:'src'},root)).toEqual({files:['App.jsx']});});
  it.each(['../outside','src/../outside','src//a','src/./a','/etc/passwd','src/%2e%2e/out','.env','package.json','src/a\\b'])('rejects path %s',async p=>{await expect(runCanaryTool({name:'write_file',path:p,content:'x'},await fixture())).rejects.toThrow();});
  it('rejects symlink files and ancestors without touching their targets',async()=>{const root=await fixture();await writeFile(path.join(root,'private'),'keep');await symlink('../private',path.join(root,'src','alias'));await expect(runCanaryTool({name:'write_file',path:'src/alias',content:'changed'},root)).rejects.toThrow(/Symlinks/);await symlink('..',path.join(root,'src','parent'));await expect(runCanaryTool({name:'read_file',path:'src/parent/private'},root)).rejects.toThrow(/Symlinks/);expect(await readFile(path.join(root,'private'),'utf8')).toBe('keep');});
  it('rejects arbitrary shell, environment, package script and size overrides',async()=>{const root=await fixture();for(const tool of [{name:'shell',command:'echo x'},{name:'build',command:'curl'},{name:'test',env:{SECRET:'x'}},{name:'write_file',path:'src/a',content:'x'.repeat(100001)}])await expect(runCanaryTool(tool,root)).rejects.toThrow();});
  it('binds build and journey to the actual current source hash, never stale dist',async()=>{
    const root=await fixture();await mkdir(path.join(root,'public'));await writeFile(path.join(root,'index.html'),'<div id="root"></div>');await writeFile(path.join(root,'src','a.js'),'first');
    const execute=vi.fn(async()=>({stdout:'verified',stderr:''}));
    const built=await runCanaryBuildStep({name:'build'},root,execute);
    expect(built.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    await runCanaryBuildStep({name:'test',expectedSourceDigest:built.sourceDigest},root,execute);
    expect(execute).toHaveBeenCalledTimes(2);
    await writeFile(path.join(root,'src','a.js'),'second');
    await expect(runCanaryBuildStep({name:'test',expectedSourceDigest:built.sourceDigest},root,execute)).rejects.toThrow(/provenance changed/);
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it('refuses successful execution when the source changed during that execution',async()=>{
    const root=await fixture();await mkdir(path.join(root,'public'));await writeFile(path.join(root,'index.html'),'synthetic');
    const execute=vi.fn(async()=>{await writeFile(path.join(root,'src','changed.js'),'changed');return {stdout:'exit zero',stderr:''};});
    await expect(runCanaryBuildStep({name:'build'},root,execute)).rejects.toThrow(/Source changed/);
  });

});
