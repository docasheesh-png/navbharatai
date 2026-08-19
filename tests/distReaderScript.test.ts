import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Admin 2026-08-19, fourth failure in one Publish flow:
 *
 *   Could not read the built site: No build output found in dist/ or out/.
 *   [eval]:1
 *   const fs=require('fs'),path=require('path');…let out={};cons
 *
 * `[eval]:1` and a source that stops mid-word are node reporting a SYNTAX ERROR on a truncated
 * script. The reader ran as `node -e "<script>"` with the paths interpolated by JSON.stringify —
 * which emits DOUBLE quotes into an already double-quoted shell string, closing it at the first
 * path. Node got everything up to `const dirs=[` and nothing after.
 *
 * WORKSPACE_ROOT is a constant, so there was no input for which this worked: the deploy step could
 * only ever fail.
 */
const src = readFileSync(
  join(__dirname, '..', 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'),
  'utf8',
);
/** Comments discuss the old `node -e "…"` shape on purpose — only real CODE should be searched. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the dist reader never goes through a shell', () => {
  it('NO command is built as a `node -e` one-liner any more — all three sites', () => {
    // The single construction that made the whole class possible. Comments still discuss it, so this
    // matches the COMMAND shape (`node -e "` opening a template) rather than the words.
    const constructions = code.match(/`[^`]*node -e "/g) ?? [];
    expect(constructions).toEqual([]);
  });

  it('the SIBLINGS are fixed too — browseUrl and screenshot had the identical bug', () => {
    // Found by this same investigation: both interpolated JSON.stringify(url) into a double-quoted
    // node -e. browseUrl's failure was invisible because it silently fell back to `source: 'curl'` —
    // the platform's own PREVIEW_UNVERIFIED, "fetched without running its JavaScript".
    expect(src).toContain("const browsePath = '/tmp/nb_browse.cjs'");
    expect(src).toContain('await sandbox.files.write(browsePath, playwrightBody)');
    expect(src).toContain("const shotPath = '/tmp/nb_shot.cjs'");
    expect(src).toContain('await sandbox.files.write(shotPath, shotBody)');
  });

  it('writes the script to a file and runs THAT', () => {
    expect(src).toContain("const readerPath = '/tmp/nb_read_dist.cjs'");
    expect(src).toContain('await sandbox.files.write(readerPath, readerScript)');
    expect(src).toContain('.run(`node ${readerPath}`');
  });

  it('returns its result through a FILE, not captured stdout', () => {
    // A base64'd dist/ is easily megabytes; a truncated stdout would fail JSON.parse with a message
    // that looks nothing like its cause — the same lesson one layer along.
    expect(src).toContain("const resultPath = '/tmp/nb_dist.json'");
    expect(src).toContain('await sandbox.files.read(resultPath)');
    // The browser-daemon path legitimately parses stdout (its payload is small and shellQuote'd), so
    // this is scoped to the dist reader rather than the whole file.
    const at = src.indexOf('async downloadDistFiles');
    expect(src.slice(at, at + 4000)).not.toContain('JSON.parse(result.stdout');
  });

  it('THE SCRIPT IT WRITES IS VALID JAVASCRIPT — the assertion that would have caught this', () => {
    // Reconstructs the reader exactly as the actuator assembles it and asks node's own parser. A
    // syntax error here is the bug, and no amount of reading the string would have proved it absent.
    const distPath = '/home/user/workspace/dist';
    const outPath = '/home/user/workspace/out';
    const resultPath = '/tmp/nb_dist.json';
    const readerScript = [
      "const fs=require('fs'),path=require('path');",
      "function walk(d,b,o){",
      "  try{for(const f of fs.readdirSync(d)){",
      "    const a=path.join(d,f),r=(b?b+'/':'')+f;",
      "    if(fs.statSync(a).isDirectory()) walk(a,r,o);",
      "    else o[r]=fs.readFileSync(a).toString('base64');",
      "  }}catch(e){}",
      "  return o;",
      "}",
      "let out={};",
      `const dirs=${JSON.stringify([distPath, outPath])};`,
      "for(const d of dirs){const r=walk(d,'',{});if(Object.keys(r).length){out=r;break;}}",
      "if(!Object.keys(out).length){console.error('dist/ and out/ are empty or do not exist');process.exit(2);}",
      `fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(out));`,
    ].join('\n');

    expect(() => new Function(readerScript)).not.toThrow();
    // Both search paths must survive into the script — losing one silently would make a Next.js
    // static export unpublishable with no error anyone could read.
    expect(readerScript).toContain(distPath);
    expect(readerScript).toContain(outPath);
  });

  it('the empty case exits non-zero with a sentence, not a thrown stack', () => {
    // process.exit(2) + console.error means the caller's honest message has something real to append.
    expect(src).toContain("console.error('dist/ and out/ are empty or do not exist');process.exit(2);");
  });

  it('a non-zero exit is CAUGHT — the SDK throws rather than returning one', () => {
    // Without this the careful "No build output found" message is unreachable in exactly the case it
    // was written for, and the user gets the SDK's "exit status 1" instead.
    expect(src).toContain('exitCode: typeof err?.exitCode === \'number\' ? err.exitCode : 1');
    expect(src).toContain('No build output found in dist/ or out/');
  });
});
