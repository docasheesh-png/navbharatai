/**
 * PUBLISH — the button that actually publishes.
 *
 * ADMIN REPORT 2026-08-11: "publish button kisi kaam ka nahi hai."
 *
 * The root cause was architectural, not a bug in any one line: publishing was driven by asking the
 * MODEL to do it. The button sent the chat prompt "run npm run build, then call the deploy tool" and
 * hoped. Publishing is DETERMINISTIC — build, collect dist, upload, return a URL — so routing it
 * through a language model made it non-deterministic (one recorded build had the model running
 * `ls -la dist/` trying to work out what had happened), slow, and BILLED for work that should cost the
 * user nothing. A button that MIGHT publish is not a Publish button.
 *
 * These tests lock the properties that make the new path trustworthy, and — just as important — the
 * ones that stop it becoming the old dead button again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Comments discuss the old behaviour on purpose; matching prose would fail on the explanation. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const routes = read('../src/server/routes/agentv3.ts');
const panel = read('../src/components/agentv3/AgentV3Panel.tsx');
const chooser = read('../src/components/agentv3/HostingChooser.tsx');

/** One handler's body — to the next route registration, never a fixed character count. */
function handlerOf(path: string): string {
  const i = routes.indexOf(`app.post('${path}'`);
  if (i === -1) return '';
  const next = routes.slice(i + 1).search(/\n\s{2}app\.(post|get|put|patch|delete)\s*\(/);
  return next === -1 ? routes.slice(i) : routes.slice(i, i + 1 + next);
}

const publish = handlerOf('/api/agentv3/publish');

describe('🔒 publishing no longer goes through the model', () => {
  it('the client calls the publish endpoint directly', () => {
    const code = codeOnly(panel);
    expect(code).toContain("fetch('/api/agentv3/publish'");
  });

  it('🔒 the Publish button no longer sends a chat prompt asking the model to deploy', () => {
    // This exact string WAS the whole publish mechanism. If it returns, the button is a lottery again.
    // Comments are stripped: the file deliberately EXPLAINS the old prompt, and asserting against prose
    // is how a test fails on its own explanation (the third time that trap has been hit in this repo).
    const code = codeOnly(panel);
    expect(code).not.toContain('then call the deploy tool');
    expect(code).not.toContain('Deploy this app to a permanent public live URL');
  });

  it('the endpoint exists, and is a POST that writes — so it verifies ownership strictly', () => {
    expect(publish).not.toBe('');
    // Publishing pushes files to a PUBLIC host; a claimed uid is not good enough.
    expect(publish).toContain('assertVerifiedWorkspaceOwner');
    expect(publish).toContain('res.status(403)');
  });
});

describe('🔒 it builds before it publishes, and reports the real reason when it cannot', () => {
  it('runs the build itself rather than trusting a dist/ that may not exist', () => {
    expect(publish).toContain("runCommand(workspaceId, 'npm run build')");
    expect(publish).toContain('build.exitCode !== 0');
  });

  it('🔒 a failed build returns the compiler output, not "publish failed"', () => {
    // The generic message is what made this button useless: the user had nothing to act on.
    expect(publish).toContain('build.stderr');
    expect(publish).toContain('detail');
    expect(publish).toMatch(/did not build/);
  });

  it('refuses an unconfigured host with an actionable sentence', () => {
    expect(publish).toContain('isConfigured');
    expect(publish).toMatch(/not connected yet/);
  });

  it('refuses when there is no workspace, instead of publishing nothing', () => {
    expect(publish).toMatch(/nothing to publish yet/);
  });
});

describe('🔒 the deploy implementation is shared, not copied', () => {
  it('both the endpoint and the build path use makeDeployFn', () => {
    // Two copies would drift, and the pieces that would silently go missing from one of them are the
    // custom-domain republish and the durable deployment record.
    expect(routes).toContain('const makeDeployFn =');
    expect(publish).toContain('makeDeployFn({');
    const uses = (codeOnly(routes).match(/makeDeployFn\(\{/g) || []).length;
    expect(uses, 'both the publish endpoint and the build path must call it').toBeGreaterThanOrEqual(2);
  });

  it('🔒 the custom-domain republish lives inside that ONE shared function', () => {
    // A user who connected their own domain must get the fresh build on it. This is the line that does
    // it, and it must not be duplicated into a second path where it can be forgotten.
    const fn = routes.slice(routes.indexOf('const makeDeployFn ='), routes.indexOf("app.post('/api/agentv3/publish'"));
    expect(fn).toContain('publishToCustomDomainSite');
    expect(fn).toContain('deployToSite');
    expect(fn).toContain('withDeploymentPersistence');
  });

  it('reuses the SAME deploy tool the agent calls, so migrations and liveness still run', () => {
    // Reimplementing the deploy body here is how the production-database migration would quietly stop
    // happening for anyone who published with the button.
    expect(publish).toContain("name: 'deploy'");
    expect(publish).toContain('dispatcher.dispatch');
  });

  it('reads the live URL from the durable record, not by parsing a sentence', () => {
    expect(publish).toContain('deploymentStore.get(workspaceId)');
  });
});

describe('🔒 the surface never goes silent again', () => {
  it('the chooser stays open through the publish', () => {
    // It used to close the moment a publish STARTED. That was right while progress streamed into the
    // chat; now the progress is in this surface, so closing it hides the thing being waited for.
    const code = codeOnly(panel);
    expect(code).toContain('onDeploy={(id) => deployLive(id)}');
    expect(code).not.toContain('if (!reason) setShowHostingChooser(false);');
  });

  it('the chooser is given, and renders, the live publish status', () => {
    expect(codeOnly(panel)).toContain('publishStatus={publishMsg}');
    expect(codeOnly(chooser)).toContain('publishStatus');
    // Rendered, not merely accepted as a prop.
    expect(codeOnly(chooser)).toContain('{publishStatus}');
  });

  it('a build error keeps its line breaks, because it is compiler output', () => {
    expect(codeOnly(chooser)).toContain('whitespace-pre-wrap');
  });

  it('the buttons are disabled while a publish is running', () => {
    expect(codeOnly(panel)).toContain('busy={running || publishing}');
  });

  it('a second tap while publishing is refused with a reason, not ignored', () => {
    expect(codeOnly(panel)).toMatch(/if \(publishing\) return '/);
  });
});
