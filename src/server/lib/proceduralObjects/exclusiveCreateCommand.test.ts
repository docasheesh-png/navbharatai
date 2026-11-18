import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm,symlink,writeFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {exclusiveCreateCommand} from './exclusiveCreateCommand';
const exec=promisify(execFile);
it('real simultaneous creates have one winner and never overwrite',async()=>{const root=await mkdtemp(join(tmpdir(),'procedural-exclusive-'));try{const results=await Promise.allSettled(['first','second'].map(content=>exec('bash',['-c',exclusiveCreateCommand(root,'src/generated/object.ts',content)])));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const winner=await readFile(join(root,'src/generated/object.ts'),'utf8');expect(['first','second']).toContain(winner);await expect(exec('bash',['-c',exclusiveCreateCommand(root,'src/generated/object.ts','replacement')])).rejects.toThrow();expect(await readFile(join(root,'src/generated/object.ts'),'utf8')).toBe(winner);expect(await readdir(join(root,'src/generated'))).toEqual(['object.ts']);}finally{await rm(root,{recursive:true,force:true});}});
it('symlink parent and leaf cannot redirect writes',async()=>{const root=await mkdtemp(join(tmpdir(),'procedural-symlink-'));try{await mkdir(join(root,'outside'));await writeFile(join(root,'outside','kept'),'keep');await symlink(join(root,'outside'),join(root,'linked'));await expect(exec('bash',['-c',exclusiveCreateCommand(root,'linked/new','bad')])).rejects.toThrow();await symlink(join(root,'outside','kept'),join(root,'leaf'));await expect(exec('bash',['-c',exclusiveCreateCommand(root,'leaf','bad')])).rejects.toThrow();expect(await readFile(join(root,'outside','kept'),'utf8')).toBe('keep');}finally{await rm(root,{recursive:true,force:true});}});
it('source shell characters stay literal data',async()=>{const root=await mkdtemp(join(tmpdir(),'procedural-data-'));try{const content='"; $(echo BAD);\nUnicode: पानी';await exec('bash',['-c',exclusiveCreateCommand(root,'source.ts',content)]);expect(await readFile(join(root,'source.ts'),'utf8')).toBe(content);}finally{await rm(root,{recursive:true,force:true});}});
it('rejects traversal and oversized payload before command emission',()=>{expect(()=>exclusiveCreateCommand('/tmp/work','../x','x')).toThrow();expect(()=>exclusiveCreateCommand('/tmp/work','x','x'.repeat(1048577))).toThrow();});

it('repeated failed publications clean owned staging links and preserve final file',async()=>{const root=await mkdtemp(join(tmpdir(),'procedural-cleanup-'));try{await writeFile(join(root,'kept.ts'),'user source');for(let i=0;i<8;i++)await expect(exec('bash',['-c',exclusiveCreateCommand(root,'kept.ts','rejected '+i)])).rejects.toThrow();expect(await readdir(root)).toEqual(['kept.ts']);expect(await readFile(join(root,'kept.ts'),'utf8')).toBe('user source');}finally{await rm(root,{recursive:true,force:true});}});
it('write/fsync exceptions clean unpublished staging and never create final path',async()=>{for(const method of ['write','fsync']){const root=await mkdtemp(join(tmpdir(),'procedural-io-failure-'));try{const script=exclusiveCreateCommand(root,'object.ts','source').replace("v=json.loads",`os.${method}=lambda *args: (_ for _ in ()).throw(OSError('fixture failure'))\nv=json.loads`);await expect(exec('bash',['-c',script])).rejects.toThrow();expect(await readdir(root)).toEqual([]);}finally{await rm(root,{recursive:true,force:true});}}});
it('publication uses pinned descriptor with no replaceable staging pathname',async()=>{const root=await mkdtemp(join(tmpdir(),'procedural-pinned-'));try{const inject=`original_link=os.link
def inspect_then_link(src,dst,src_dir_fd=None,dst_dir_fd=None,follow_symlinks=False):
 assert src.startswith('/proc/self/fd/')
 assert os.listdir(v['root'])==[]
 # Other sandbox processes cannot replace a procfs descriptor entry with a symlink.
 try: os.unlink(src)
 except OSError: pass
 else: raise AssertionError('descriptor entry unexpectedly mutable')
 original_link(src,dst,dst_dir_fd=dst_dir_fd,follow_symlinks=follow_symlinks)
os.link=inspect_then_link
v=json.loads`;const script=exclusiveCreateCommand(root,'object.ts','pinned original').replace('v=json.loads',inject);await exec('bash',['-c',script]);expect(await readdir(root)).toEqual(['object.ts']);expect(await readFile(join(root,'object.ts'),'utf8')).toBe('pinned original');}finally{await rm(root,{recursive:true,force:true});}});
it('unsupported anonymous files fail closed without final or named staging',async()=>{const root=await mkdtemp(join(tmpdir(),'procedural-unsupported-'));try{const inject=`original_open=os.open
def reject_anonymous(path,flags,*args,**kwargs):
 if flags & os.O_TMPFILE == os.O_TMPFILE: raise OSError('anonymous files unsupported')
 return original_open(path,flags,*args,**kwargs)
os.open=reject_anonymous
v=json.loads`;await expect(exec('bash',['-c',exclusiveCreateCommand(root,'object.ts','source').replace('v=json.loads',inject)])).rejects.toThrow();expect(await readdir(root)).toEqual([]);}finally{await rm(root,{recursive:true,force:true});}});
