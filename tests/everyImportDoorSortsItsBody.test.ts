// EVERY DOOR THAT LANDS FILES SORTS ITS BODY FIRST (single-file game autopsy, 2026-11-14).
// The three server doors that write imported or pasted files into a workspace must hand them to `prepareImportBody` before
// writing — otherwise a page that carries its media lands as megabytes of text (dropped by the durable store) and a logo lands
// as a text file of base64. A NEW door that writes files must be added here with its reason, or be shown to sort.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

/** The source between a marker and the next `app.` route or the end of the function, enough to see its calls. */
function around(marker: string, span = 6000): string {
  const at = route.indexOf(marker);
  expect(at, marker + ' not found').toBeGreaterThan(-1);
  return route.slice(at, at + span);
}

describe('the doors', () => {
  it('POST /api/agentv3/import-files sorts the body, writes assets as bytes and merges only text', () => {
    const body = around("app.post('/api/agentv3/import-files'", 5000);
    expect(body).toContain('prepareImportBody(files');
    expect(body).toMatch(/writeWorkspaceFiles\(actuator, workspaceId, textFiles\)/);
    expect(body).toMatch(/materializeAssets\(actuator, workspaceId, assetFiles\)/);
    expect(body).toMatch(/saveWorkspaceAssets\(workspaceId, assetFiles/);
    expect(body).toMatch(/mergeWorkspaceFiles\(workspaceId, textFiles\)/);
    expect(body).not.toMatch(/writeWorkspaceFiles\(actuator, workspaceId, files as/);
  });

  it('the zip / GitHub landing lifts media before it validates and writes', () => {
    const body = around('const landImportedProject = async', 6000);
    expect(body).toContain('prepareImportBody(importedFiles)');
    expect(body.indexOf('prepareImportBody(importedFiles)')).toBeLessThan(body.indexOf('validateImportedProject(importedFiles)'));
  });

  it('a pasted one-file page is seeded as code, with its media written as assets', () => {
    const body = around('const pastedFull = pastedHtmlDocument(prompt)', 3500);
    expect(body).toContain("prepareImportBody({ 'index.html': pastedFull })");
    expect(body).toMatch(/materializeAssets\(actuator, workspaceId, pastedPrepared\.assets\)/);
  });

  it('the model-facing door: every tool result and the request pass through elideEmbeddedMedia', () => {
    const runner = readFileSync(join(__dirname, '..', 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).toMatch(/elideEmbeddedMedia\(r\.content\)/);
    expect(runner).toMatch(/elideEmbeddedMedia\(userPrompt\)/);
    expect(runner).toMatch(/elideEmbeddedMedia\(repairUserPrompt\(/);
  });

  it('both model-driven write doors run the page guard', () => {
    const d = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    const calls = d.match(/await this\.refuseBrokenPageEdit\(/g) ?? [];
    expect(calls.length).toBe(2); // write_file (guardedWrite) and edit_file
  });
});
