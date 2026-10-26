#!/usr/bin/env node
// Install read-only at /opt/nbai-canary/run in the separately reviewed offline template.
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);
const ROOT = '/home/user/canary-app';
const TRUSTED = '/opt/nbai-canary';
const LIMIT = 100_000;
async function sourceDigest(root) {
  const digest = createHash('sha256');
  let entries = 0; let bytes = 0;
  async function visit(relative) {
    if (++entries > 256) throw Error('Too many source entries');
    const target = path.join(root, relative); const info = await lstat(target);
    if (info.isSymbolicLink()) throw Error('Symlink source forbidden');
    if (info.isDirectory()) { for (const name of (await readdir(target)).sort()) await visit(path.join(relative, name)); }
    else if (info.isFile()) {
      bytes += info.size;
      if (info.size > LIMIT || bytes > 2_000_000) throw Error('Source exceeds envelope');
      const f = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const data = await f.readFile(); digest.update(JSON.stringify([relative, data.length])); digest.update(data); } finally { await f.close(); }
    } else throw Error('Unsupported source entry');
  }
  for (const name of ['index.html', 'src', 'public']) await visit(name);
  return digest.digest('hex');
}
export async function runCanaryBuildStep(tool, root, execute = exec) {
  if (!tool || !['build', 'test'].includes(tool.name)) throw Error('Invalid build operation');
  const keys = Object.keys(tool).sort().join(',');
    if (keys !== (tool.name === 'test' ? 'expectedSourceDigest,name' : 'name')) throw Error('Command overrides forbidden');
    const before = await sourceDigest(root);
    if (tool.name === 'test' && tool.expectedSourceDigest !== before) throw Error('Build/source provenance changed');
    // These binaries/configs are template artifacts, not writable project scripts.
    const args = tool.name === 'build'
      ? [`${TRUSTED}/node_modules/vite/bin/vite.js`, 'build', '--config', `${TRUSTED}/vite.config.mjs`]
      : [`${TRUSTED}/verify-todo.mjs`];
    const result = await execute(process.execPath, args, { cwd: root, timeout: 55_000, maxBuffer: 100_000,
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/user', NODE_ENV: 'production' } });
    const after = await sourceDigest(root);
    if (before !== after) throw Error('Source changed during execution');
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0, sourceDigest: after };
}
export async function runCanaryTool(tool, root = ROOT) {
  if (!tool || typeof tool !== 'object') throw Error('Invalid tool');
  const keys = Object.keys(tool).sort().join(',');
  if (tool.name === 'build' || tool.name === 'test') {
    if (root !== ROOT) throw Error('Command root overrides forbidden');
    return runCanaryBuildStep(tool, root);
  }
  if (!['read_file', 'write_file', 'list_files'].includes(tool.name)
    || keys !== (tool.name === 'write_file' ? 'content,name,path' : 'name,path')
    || typeof tool.path !== 'string' || !/^(?:src|public)(?:\/[A-Za-z0-9_.-]+)*$/.test(tool.path)
    || tool.path.split('/').some(p => p === '.' || p === '..')) throw Error('Path/tool outside envelope');
  const canonicalRoot = await realpath(root);
  const parts = tool.path.split('/');
  let current = canonicalRoot;
  for (const [i, part] of parts.entries()) {
    current = path.join(current, part);
    let info;
    try { info = await lstat(current); } catch (e) {
      if (e.code !== 'ENOENT' || tool.name !== 'write_file') throw e;
      if (i < parts.length - 1) { await mkdir(current); info = await lstat(current); }
    }
    if (info?.isSymbolicLink()) throw Error('Symlinks forbidden');
    if (i < parts.length - 1 && !info?.isDirectory()) throw Error('Invalid directory');
  }
  if (tool.name === 'list_files') return { files: (await readdir(current)).slice(0, 200) };
  if (tool.name === 'write_file' && (typeof tool.content !== 'string' || Buffer.byteLength(tool.content) > LIMIT)) throw Error('File too large');
  const flags = tool.name === 'write_file' ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW : constants.O_RDONLY | constants.O_NOFOLLOW;
  const handle = await open(current, flags, 0o600);
  try {
    if (tool.name === 'write_file') { await handle.writeFile(tool.content, 'utf8'); return { written: true }; }
    if ((await handle.stat()).size > LIMIT) throw Error('File too large');
    return { content: await handle.readFile('utf8') };
  } finally { await handle.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || !/^[A-Za-z0-9+/]+=*$/.test(process.argv[2]) || process.argv[2].length > 140_000) throw Error('Invalid payload');
    console.log(JSON.stringify(await runCanaryTool(JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8')))));
  } catch { console.error('Restricted sandbox operation refused'); process.exitCode = 1; }
}
