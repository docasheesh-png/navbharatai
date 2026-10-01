// Autopsy bee95692 (2026-09-30) — "Social media app", Weak, 14.5 min, green. Four defects, four locks. Plus: the lean reviewer answers in one call.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixNodeModulesTypo } from '../src/server/AgentV3/nodeModulesTypo';
import { classifyDevServerFailure, planDevServerRecovery } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/DevServerRecovery';
import { analyzeHooksRules } from '../src/server/AgentV3/HooksRulesAnalysis';
import { STABLE_SNAPSHOT_RULE } from '../src/server/AgentV3/noEvalRule';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { fileSystemPrompt } from '../src/server/AgentV3/SimpleBuilder';
import { sharedDataNeed } from '../src/server/AgentV3/sharedDataNeed';
import { leanReviewAnswersInOneCall, leanReviewInline, reviewerInstruction } from '../src/server/AgentV3/ReviewerAgent';
import { catalogForTools } from '../src/server/AgentV3/ToolCatalog';

describe('.node_modules is a typo, never a folder', () => {
  it('corrects only a path that starts with it', () => {
    expect(fixNodeModulesTypo('.node_modules/.bin/vite --host 0.0.0.0 --port 5173')).toEqual({ command: './node_modules/.bin/vite --host 0.0.0.0 --port 5173', fixed: true });
    expect(fixNodeModulesTypo('.node_modules/.bin/tsc --noEmit 2>&1 | head -40').command).toBe('./node_modules/.bin/tsc --noEmit 2>&1 | head -40');
    expect(fixNodeModulesTypo('npm i && .node_modules/.bin/vite').command).toBe('npm i && ./node_modules/.bin/vite');
    for (const ok of ['./node_modules/.bin/vite', '../node_modules/x', 'ls node_modules', 'echo my.node_modules/x']) {
      expect(fixNodeModulesTypo(ok)).toEqual({ command: ok, fixed: false });
    }
  });
  it('the bash tool runs the corrected command and says so', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(src).toMatch(/const typoFix = fixNodeModulesTypo\((?:reqStr\(input, 'command'\)|rawCommand)\);\s*const command = typoFix\.command;/);
    expect(src).toMatch(/if \(typoFix\.fixed\) out = /);
  });
});

describe('a command that does not exist is never restarted', () => {
  const LOG = '[preview-bridge] index.html now reports …\n/bin/bash: line 1: .node_modules/.bin/vite: No such file or directory\n';
  it('is a code error with the path named, on the first attempt', () => {
    const d = classifyDevServerFailure(LOG);
    expect(d.cause).toBe('code_error');
    expect(d.detail).toMatch(/\.node_modules\/\.bin\/vite/);
    expect(d.detail).toMatch(/\.\/node_modules\/\.bin\/vite/);
    expect(planDevServerRecovery(LOG, 1, 2).recovery).toBe('code_fix');
  });
  it('a bad cd keeps its own, more specific sentence', () => {
    expect(classifyDevServerFailure('/bin/bash: line 1: cd: vpn-app: No such file or directory').detail).toMatch(/changed directory into "vpn-app"/);
  });
});

describe('a hook that IS the return value is not after a return', () => {
  it('return useSyncExternalStore(...) is clean; a real early return still is not', async () => {
    const ok = `import { useSyncExternalStore } from 'react';\nexport function usePosts() {\n  return useSyncExternalStore((cb) => s.subscribe(cb), () => s.get());\n}\n`;
    expect((await analyzeHooksRules({ 'src/hooks/a.ts': ok })).violations).toEqual([]);
    const bad = `import { useState } from 'react';\nexport function useX(a: boolean) {\n  if (!a) return null;\n  return useState(0);\n}\n`;
    expect((await analyzeHooksRules({ 'src/hooks/b.ts': bad })).counts['hook-after-return']).toBe(1);
  });
});

describe('a store snapshot is stable, and a social app is offered a database', () => {
  it('both lanes carry the snapshot rule', () => {
    expect(architectSystemPrompt()).toContain(STABLE_SNAPSHOT_RULE);
    expect(fileSystemPrompt('vite-react')).toContain(STABLE_SNAPSHOT_RULE);
  });
  it('social media app needs shared data; social-media marketing does not', () => {
    expect(sharedDataNeed('Social media app').needed).toBe(true);
    expect(sharedDataNeed('build a social network for my college').needed).toBe(true);
    expect(sharedDataNeed('landing page with links to our social media accounts').needed).toBe(false);
  });
  it('the offer reads the whole request, not only the last message', () => {
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/const need = sharedDataNeed\(planning\.text\);/);
  });
});

describe('a lean review handed all the changed code answers in ONE call', () => {
  const content: Record<string, string> = { 'src/App.tsx': 'export default function App() { return null; }', 'src/components/Feed.tsx': 'export const Feed = () => null;' };
  const base = { userRequest: 'Social media app', fileTree: Object.keys(content), fileSample: [] as { path: string; content: string }[] };

  it('every changed file inline ⇒ one call; anything left out or nothing inlined ⇒ it may read', () => {
    const all = leanReviewInline(Object.keys(content), (p) => content[p]);
    expect(leanReviewAnswersInOneCall(all)).toBe(true);
    expect(leanReviewAnswersInOneCall({ files: all.files, omitted: ['src/huge.ts'] })).toBe(false);
    expect(leanReviewAnswersInOneCall({ files: [], omitted: [] })).toBe(false);
    expect(leanReviewAnswersInOneCall(undefined)).toBe(false);
  });

  it('the instruction says it has no tools only when it has none', () => {
    const all = leanReviewInline(Object.keys(content), (p) => content[p]);
    expect(reviewerInstruction({ ...base, mode: 'suggest', inlineFiles: all })).toMatch(/You have NO tools in this review/);
    const partial = { files: all.files, omitted: ['src/huge.ts'] };
    const text = reviewerInstruction({ ...base, mode: 'suggest', inlineFiles: partial });
    expect(text).not.toMatch(/NO tools/);
    expect(text).toMatch(/Read each file you need ONCE/);
  });

  it('an empty override is a real "no tools", and both the spawn and the route use it', () => {
    expect(catalogForTools([])).toEqual([]);
    const sub = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');
    expect(sub).toContain('tools: catalogForTools(deps.toolsOverride ?? cfg.tools),');
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('const reviewOneCall = leanReviewAnswersInOneCall(reviewInline);');
    expect(route).toContain('...(reviewOneCall ? { toolsOverride: [] } : {}),');
  });
});
