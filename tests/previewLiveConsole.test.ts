import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const actuator = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');
const surface = read('src/components/agentv3/PreviewSurface.tsx');
const reactPreview = read('src/server/runtime/ReactPreview.ts');

describe('the Live preview gets a console — the gap this closes', () => {
  it('the dev-server launch injects the bridge into the sandbox entry document', () => {
    expect(actuator).toContain('injectPreviewBridge');
    // BOTH standard entry documents — a CRA app keeps its at public/index.html, and skipping it
    // would leave a whole framework silently without a console.
    expect(actuator).toContain("['index.html', 'public/index.html']");
  });

  it('the injection can never fail a dev server', () => {
    const block = actuator.slice(actuator.indexOf('THE PREVIEW BRIDGE'), actuator.indexOf('THE PREVIEW BRIDGE') + 3000);
    // Every sandbox call in the block is guarded — a console is not worth a dead preview for.
    expect(block).toContain('.catch(() => false)');
    expect(block).toMatch(/catch \{[^}]*best-effort/);
  });

  it('has a kill switch that returns today’s behaviour with no deploy', () => {
    expect(actuator).toContain('AGENTV3_PREVIEW_BRIDGE');
    // UNSET must mean ON: the whole point is that the console now works by default. Only an explicit
    // 'off' disables it, matching every other flag in this codebase.
    expect(actuator).toMatch(/AGENTV3_PREVIEW_BRIDGE[^\n]*!==\s*'off'/);
  });

  it('the panel shows the console in the LIVE branch, not just in-browser', () => {
    // The button and drawer are held as values precisely so both branches can render the same thing;
    // if either reference is lost, one mode silently goes back to having no console.
    expect(surface).toContain('const consoleButton = (');
    expect(surface).toContain('const consoleDrawer = (');
    // REPOINTED (2026-09-11, one preview pane): the in-browser branch now renders the button as
    // `{previewToolsFor(source).console && consoleButton}` — hidden only while the pane frames the
    // saved copy, a static page with no bridge to report from. Both branches still reference it.
    expect((surface.match(/consoleButton\}/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((surface.match(/\{consoleOpen && consoleDrawer\}/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('never tells a user their app printed nothing when nothing is listening', () => {
    // The honesty rule: an empty drawer on Live with no bridge is "not reporting", not "printed
    // nothing". Saying the second there is a false statement about the user's own app.
    expect(surface).toContain('__nbaiPreviewBridgeReady');
    expect(surface).toContain('liveBridgeReady');
    expect(surface).toContain('The live console is not reporting for this app');
  });
});

describe('the bridge can never reach a user’s shipped app', () => {
  /**
   * ⚠️ THESE ASSERT THE GUARD, NOT A HELPER'S NAME (updated 2026-09-14, autopsy fd021c64).
   *
   * They used to require the literal `stripPreviewBridge` + `isHtmlDocumentPath` at each site, which
   * was the guard written out by hand — and hand-written guards are exactly what the autopsy found a
   * THIRD path quietly missing. The expression now lives once in `withoutPreviewBridge`, so the rule
   * is "the read/write path applies the bridge guard", stated in a way a later refactor cannot fail
   * for the wrong reason.
   */
  const guarded = (code: string): boolean => /withoutPreviewBridge\s*\(/.test(code)
    || (/stripPreviewBridge\s*\(/.test(code) && /isHtmlDocumentPath\s*\(/.test(code));

  it('is stripped from what the model READS', () => {
    const readCase = dispatcher.slice(dispatcher.indexOf("case 'read_file'"), dispatcher.indexOf("case 'write_file'"));
    expect(guarded(readCase)).toBe(true);
  });

  it('is stripped from what the model WRITES — the guarantee, not just the likelihood', () => {
    const writeCase = dispatcher.slice(dispatcher.indexOf("case 'write_file'"));
    expect(guarded(writeCase.slice(0, 4000))).toBe(true);
  });

  it('is stripped from what our own ANALYSERS read — the third path, which nobody guarded', () => {
    // `readEvalSnapshot` reads the sandbox with the raw actuator and feeds ~30 static checks. Our
    // injected console mirror was being judged as the user's code, and one real build was headlined
    // with a security finding that belonged to us.
    const snap = dispatcher.slice(dispatcher.indexOf('private async readEvalSnapshot('));
    expect(guarded(snap.slice(0, 2500))).toBe(true);
  });

  it('is stripped from what reaches DURABLE storage, which is what a publish serves', () => {
    // Not a call site: the durable callback itself. ~24 places persist a file directly, and the
    // signature injector — which runs the instant the preview port verifies UP, i.e. once the bridge
    // is in the sandbox's index.html — read that document and persisted it.
    expect(dispatcher).toMatch(/private readonly onFileWrite = \([\s\S]{0,200}withoutPreviewBridge\(path, content\)/);
    expect(dispatcher).not.toMatch(/private readonly onFileWrite\?:\s*\(/);
  });
});

describe('one mirror, not two', () => {
  it('the in-browser document interpolates the SHARED bridge instead of its own copy', () => {
    expect(reactPreview).toContain("previewBridgeSource('in-browser')");
    // The inline copy is GONE. Two implementations of one mirror is the drift this repo has already
    // paid for (four copies of safeRelPath, retired model ids in five files) — a second copy here is
    // how the live and in-browser consoles would quietly stop agreeing.
    expect(reactPreview).not.toContain('__nbaiPreviewConsole: true, level: level');
  });
});
