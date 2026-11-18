/** E2B Linux descriptor-pinned atomic create. Fixed Python, encoded data only.
 * O_TMPFILE creates an anonymous inode: no attacker-replaceable staging pathname and no cleanup
 * unlink race. Publication hard-links /proc/self/fd/N with AT_SYMLINK_FOLLOW into the held parent
 * directory, failing atomically if the final entry exists. Unsupported kernels/filesystems/procfs
 * fail closed, never fall back to ordinary writes or named staging files.
 * This guards filesystem namespace races, not a hostile process with debugger/kernel authority
 * or authorized later writes to the published project file.
 */
export function exclusiveCreateCommand(root:string,relative:string,content:string):string {
 if(typeof root!=='string'||!root.startsWith('/')||root.includes('\0')||root.length>1024)throw Error('Invalid workspace root.');
 if(typeof relative!=='string'||relative.length>512||!relative.split('/').every(p=>/^[A-Za-z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..'))throw Error('Invalid relative file path.');
 if(typeof content!=='string'||content.length>1024*1024||Buffer.byteLength(content)>1024*1024)throw Error('Exclusive source size exceeded.');
 const data=Buffer.from(JSON.stringify({root,relative,content})).toString('base64');
 return `python3 - <<'NBI_EXCLUSIVE_SOURCE'
import os, json, base64
v=json.loads(base64.b64decode('${data}'))
fds=[]
try:
 d=os.open(v['root'],os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);fds.append(d)
 parts=v['relative'].split('/')
 for part in parts[:-1]:
  try: os.mkdir(part,dir_fd=d)
  except FileExistsError: pass
  d=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=d);fds.append(d)
 f=os.open('.',os.O_TMPFILE|os.O_RDWR,0o600,dir_fd=d);fds.append(f)
 b=v['content'].encode('utf-8');offset=0
 while offset<len(b):
  n=os.write(f,b[offset:])
  if n<=0: raise OSError('incomplete exclusive source write')
  offset+=n
 os.fsync(f)
 os.link('/proc/self/fd/'+str(f),parts[-1],dst_dir_fd=d,follow_symlinks=True)
 print('NBI_EXCLUSIVE_CREATED')
finally:
 for fd in reversed(fds): os.close(fd)
NBI_EXCLUSIVE_SOURCE`;
}
