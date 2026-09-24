import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { gunzipSync } from 'zlib';
import { distReaderScript } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

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
    //
    // ⚠️ UPDATED 2026-09-20, and the RULE in this case's own name is unchanged: the script goes to a
    // FILE rather than into a shell string. What changed is WHICH file.
    //
    // 🔴 This used to assert the literal `/tmp/nb_browse_…` path — STRICTER than the rule it encodes,
    // and the stricter half turned out to be pinning a SECOND bug in place. Playwright installs into
    // TOOLS_DIR, and Node resolves `require()` from the SCRIPT'S OWN DIRECTORY, never from `cwd`, so a
    // body written to /tmp could never find it: `browseUrl` failed 100% of the time and fell back to
    // curl, exactly as it had under the quoting bug this case was written for. Report 31dc61fd shows
    // thirteen consecutive failures in one build. Moving the body into a file fixed the quoting and
    // moved the resolution root from `cwd` (which `node -e` does use, and which was already TOOLS_DIR)
    // to `/tmp` — one problem traded for another.
    //
    // So this now pins the rule and NOT the address: a file, written through the one shared helper.
    // Where that helper points is `sandboxBrowsersPath.test.ts`'s business, and it is reversion-proven
    // there — never restated here, or the two copies drift and only one of them is right.
    expect(src).toContain("const browsePath = toolsScriptPath('browse')");
    expect(src).toContain('await sandbox.files.write(browsePath, playwrightBody)');
    expect(src).toContain("const shotPath = toolsScriptPath('shot')");
    expect(src).toContain('await sandbox.files.write(shotPath, shotBody)');
    // The unique-per-call property is the reason these left a fixed path at all — it must survive.
    expect(src).toMatch(/function toolsScriptPath[\s\S]{0,240}Math\.random\(\)/);
  });

  it('writes the script to a file and runs THAT', () => {
    expect(src).toContain('const readerPath = `/tmp/nb_read_dist_${runId}.cjs`');
    expect(src).toContain('await sandbox.files.write(readerPath, readerScript)');
    expect(src).toContain('.run(`node ${readerPath}`');
  });

  it('returns its result through a FILE, not captured stdout', () => {
    // A base64'd dist/ is easily megabytes; a truncated stdout would fail JSON.parse with a message
    // that looks nothing like its cause — the same lesson one layer along.
    // 2026-09-24: the file is GZIPPED JSON, read back as bytes (a dist/ is mostly text and packs 3–4×).
    expect(src).toContain('const resultPath = `/tmp/nb_dist_${runId}.json.gz`');
    expect(src).toContain("await sandbox.files.read(resultPath, { format: 'bytes' })");
    // The browser-daemon path legitimately parses stdout (its payload is small and shellQuote'd), so
    // this is scoped to the dist reader rather than the whole file.
    const at = src.indexOf('async downloadDistFiles');
    expect(src.slice(at, at + 4000)).not.toContain('JSON.parse(result.stdout');
  });

  it('NO SCRIPT PATH IS SHARED BETWEEN RUNS — the re-publish failure (admin 2026-08-27)', () => {
    // "open /tmp/nb_read_dist.cjs: permission denied" on the SECOND publish of an app. A sandbox is
    // resumed across sessions, so a leftover from an earlier run only has to be un-writable once for
    // every later run to fail. All three helper scripts had fixed names; all three now carry a unique
    // suffix. A new one added with a fixed name fails here.
    const fixed = [...src.matchAll(/const \w*Path = '\/tmp\/[^']+'/g)].map((m) => m[0]);
    expect(fixed).toEqual([]);
  });

  it('THE SCRIPT IT WRITES IS VALID JAVASCRIPT — and, since 2026-09-24, it is RUN, not re-typed', () => {
    // This used to rebuild the script by hand inside the test — a second copy that could drift from
    // the one the actuator ships. The actuator now exports the ONE builder, and this runs it for real
    // in node against a real directory, then decodes exactly what the actuator decodes.
    const root = mkdtempSync(join(tmpdir(), 'dist-reader-'));
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<div id="root"></div>');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("नमस्ते")'.repeat(200));
    writeFileSync(join(dist, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
    const out = join(root, 'out.json.gz');
    const scriptPath = join(root, 'reader.cjs');
    const script = distReaderScript([join(root, 'missing'), dist], out);
    expect(() => new Function(script)).not.toThrow();
    writeFileSync(scriptPath, script);
    execFileSync(process.execPath, [scriptPath]);
    const map = JSON.parse(gunzipSync(readFileSync(out)).toString('utf8')) as Record<string, string>;
    expect(Object.keys(map).sort()).toEqual(['assets/app.js', 'index.html', 'logo.png']);
    expect(Buffer.from(map['assets/app.js'], 'base64').toString('utf8')).toBe('console.log("नमस्ते")'.repeat(200));
    expect(Buffer.from(map['logo.png'], 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]));
    // And it really is smaller than the plain JSON it replaced.
    expect(readFileSync(out).length).toBeLessThan(Buffer.byteLength(JSON.stringify(map)) / 2);
  });

  it('an empty build exits 2 — the code the caller turns into "No build output found"', () => {
    const root = mkdtempSync(join(tmpdir(), 'dist-reader-empty-'));
    const scriptPath = join(root, 'reader.cjs');
    writeFileSync(scriptPath, distReaderScript([join(root, 'dist')], join(root, 'o.gz')));
    let code = 0;
    try { execFileSync(process.execPath, [scriptPath], { stdio: 'pipe' }); } catch (e) { code = (e as { status: number }).status; }
    expect(code).toBe(2);
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
