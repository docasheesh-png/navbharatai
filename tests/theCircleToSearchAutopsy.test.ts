/**
 * AUTOPSY a9f8d186 (2026-09-30) — "circle to search" app, Weak tier, 17.5 min, rendered, made free.
 *
 * One test per class the report surfaced (the sandbox half is in aStaleHandleIsNotAnOutage.test.ts):
 *   • a link is not words — the Play Store URL made a search app a shop;
 *   • a feature named inside an app order is not the task — "screen translation" made it `translate`;
 *   • a repair must never invent the result — a missing microphone became a "demo track";
 *   • the fast lane's handoff after a verify failure carries its files and the compiler's words;
 *   • a mechanical error a model repair reintroduces is fixed for free, every round;
 *   • replace_symbol refuses an edit that would duplicate the file;
 *   • a bare Capacitor plugin follows the project's Capacitor major.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { withoutUrls } from '../src/server/lib/promptUrls';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { explorerRepairFindings, needsAbsentDevice } from '../src/server/AgentV3/explorerRepair';
import { NO_FAKED_RESULT_RULE } from '../src/server/AgentV3/noEvalRule';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import type { OneShotFile } from '../src/server/AgentV3/OneShotBuilder';
import { NATIVE_CAPABILITIES } from '../src/server/AgentV3/nativeCapabilities';
import { fixReactUmdGlobal } from '../src/server/AgentV3/EndgameRepair';
import { replaceSymbol } from '../src/server/AppMakerLab/generator/ASTPatching';
import { pinKnownDepsInInstallCommand } from '../src/server/AgentV3/DependencyAutoFix';
import type { PressResult } from '../src/server/AgentV3/clickExplorer';

const REPORT_PROMPT = 'Create circle to search app from scratch add features like qr scanner, screen translation , music recognition, ai overview use google, duckduckgo, bing search engine result in app. \n \nMake this app layout like this app with all this features i mention \n\nApp link = https://play.google.com/store/apps/details?id=com.circletosearch.android';

describe('a link is not words', () => {
  it('🔴 the report prompt: the Play Store link no longer makes a search app a shop', () => {
    expect(analyzeRequirementGaps(REPORT_PROMPT).domain).not.toBe('ecommerce');
    expect(analyzeRequirementGaps(REPORT_PROMPT).likelyMissing).not.toContain('cart & checkout');
  });

  it('the words of a prompt still decide: a real shop is still a shop', () => {
    expect(analyzeRequirementGaps('build an online store with cart and checkout for my clothes').domain).toBe('ecommerce');
  });

  it('removes scheme URLs, www hosts and host-with-path links, and nothing else', () => {
    expect(withoutUrls('see https://play.google.com/store/apps x')).not.toMatch(/store/);
    expect(withoutUrls('see www.shop.com/cart x')).not.toMatch(/cart/);
    expect(withoutUrls('like play.google.com/store/apps/details')).not.toMatch(/store/);
    expect(withoutUrls('a store app with a cart')).toBe('a store app with a cart');
  });
});

describe('a feature named inside an app order is not the task', () => {
  it('🔴 the report prompt is not a translation task', () => {
    expect(analyzeRequest({ prompt: REPORT_PROMPT }).taskType).not.toBe('translate');
  });

  it('an app WITH translation or a summary is an app; a request TO translate or summarise is not', () => {
    expect(analyzeRequest({ prompt: 'create a translation app for tourists' }).taskType).not.toBe('translate');
    expect(analyzeRequest({ prompt: 'build an expense app that shows a monthly summary' }).taskType).not.toBe('summary');
    expect(analyzeRequest({ prompt: 'translate this paragraph in hindi' }).taskType).toBe('translate');
    expect(analyzeRequest({ prompt: 'summarize this article in key points' }).taskType).toBe('summary');
  });

  it('a link to a translator is not an order to translate', () => {
    expect(analyzeRequest({ prompt: 'what is https://translate.google.com' }).taskType).not.toBe('translate');
  });
});

describe('a repair must never invent the result', () => {
  const press = (errors: string[]): PressResult => ({ label: 'Start Recognition', verdict: 'error', errors, via: '🎵 Music', kind: 'press' } as unknown as PressResult);

  it('🔴 the report case: a missing microphone is handled honestly, never faked', () => {
    const err = 'Microphone permission denied: NotFoundError: Requested device not found';
    expect(needsAbsentDevice([err])).toBe(true);
    const [finding] = explorerRepairFindings([press([err])]);
    expect(finding).toMatch(/No microphone found/);
    expect(finding).toMatch(/Never make the control appear to work by showing sample, demo or random data/);
    expect(finding).not.toMatch(/does what its label says/);
  });

  it('every repair instruction forbids an invented result, device or not', () => {
    const [finding] = explorerRepairFindings([press(['TypeError: x is undefined'])]);
    expect(needsAbsentDevice(['TypeError: x is undefined'])).toBe(false);
    expect(finding).toMatch(/does what its label says/);
    expect(finding).toMatch(/Never make the control appear to work/);
  });

  it('the upstream half: both build prompts and writing specialists carry the no-faked-result rule', () => {
    expect(NO_FAKED_RESULT_RULE).toMatch(/song recogniser, a QR\/barcode scanner/);
    expect(architectSystemPrompt('vite-react')).toContain(NO_FAKED_RESULT_RULE);
    expect(readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8')).toMatch(/BUILD_WHAT_WAS_ASKED_RULE,\n\s*NO_FAKED_RESULT_RULE,/);
    expect(readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8')).toContain('contextBlocks.push(`${NO_EVAL_RULE}\\n${NO_FAKED_RESULT_RULE}\\n${NO_FAKE_FEATURE_RULE}`)');
  });
});

describe('the fast lane', () => {
  function lane(over: Partial<Parameters<typeof runSimpleBuild>[0]>) {
    const disk = new Map<string, string>();
    const deps = {
      prompt: 'build a todo app', framework: 'vite-react', scaffoldPaths: ['index.html', 'src/App.tsx'],
      generate: async (_system: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/TodoList.tsx :: the list\nsrc/index.css :: styles';
        const path = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'src/App.tsx';
        return `<<<FILE ${path}>>>\n// ${path}\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async (f: OneShotFile[]) => { for (const x of f) disk.set(x.path, x.content); },
      ...over,
    };
    return { deps, disk };
  }

  it('🔴 a verify failure hands its files over, not only a timeout', async () => {
    let v = 0;
    const { deps } = lane({
      verify: async () => ({ ok: false, errors: `error TS2339: broken #${++v}` }),
      repair: async (_e, files) => [{ path: files[0].path, content: `// attempt ${v}` }],
      maxRepairs: 1,
    });
    const r = await runSimpleBuild(deps);
    expect(r.reason).toBe('verify_failed');
    expect(r.salvagedPaths).toEqual(expect.arrayContaining(['src/App.tsx', 'src/TodoList.tsx']));
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("? 'and they do not compile yet'");
    expect(route).toContain("The compiler's errors on them right now:");
  });

  it('🔴 a mechanical error a model repair reintroduces is fixed for free, before the next round', async () => {
    const { deps, disk } = lane({
      verify: async () => {
        const app = disk.get('src/App.tsx') ?? '';
        if (/React\.useState/.test(app) && !/import React/.test(app)) {
          return { ok: false, errors: "src/App.tsx(1,40): error TS2686: 'React' refers to a UMD global, but the current file is a module. Consider adding an import instead." };
        }
        if (/React\.useState/.test(app)) return { ok: true, errors: '' };
        return { ok: false, errors: 'src/App.tsx(1,1): error TS2339: Property input does not exist' };
      },
      repair: async () => [{ path: 'src/App.tsx', content: 'export default function App(){ const [a] = React.useState(0); return a; }' }],
      maxRepairs: 1,
    });
    const r = await runSimpleBuild(deps);
    expect(r.ok).toBe(true);
    expect(disk.get('src/App.tsx')).toMatch(/^import React from 'react';/);
  });

  it('the React fix joins an existing named import, and leaves a file that imports React alone', () => {
    const err = [{ file: 'a.tsx', line: 1, col: 1, code: 'TS2686', message: "'React' refers to a UMD global" }];
    expect(fixReactUmdGlobal({ 'a.tsx': "import { useState } from 'react';\nReact.useRef" }, err).files['a.tsx'])
      .toMatch(/^import React, \{ useState \} from 'react';/);
    expect(fixReactUmdGlobal({ 'a.tsx': "import * as React from 'react';" }, err).fixed).toEqual([]);
  });
});

describe('replace_symbol refuses to duplicate a file', () => {
  const FILE = "import React from 'react';\nimport { X } from './x';\n\nconst AIOverview = () => null;\nexport default AIOverview;\n";

  it('🔴 the report case: a whole file passed as one symbol is refused, with the way out named', () => {
    const r = replaceSymbol(FILE, 'AIOverview', "import React from 'react';\nconst AIOverview = () => 1;\nexport default AIOverview;");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/declared twice|two default exports/);
    expect(r.error).toMatch(/use write_file/);
  });

  it('a plain declaration still replaces cleanly', () => {
    const r = replaceSymbol(FILE, 'AIOverview', 'const AIOverview = () => 1;');
    expect(r.ok).toBe(true);
    expect(r.content).toContain('const AIOverview = () => 1;');
  });

  it('overload signatures elsewhere in the file are not a clash', () => {
    const src = 'function f(a: string): string;\nfunction f(a: number): number;\nfunction f(a: any) { return a; }\nconst g = 1;\n';
    expect(replaceSymbol(src, 'g', 'const g = 2;').ok).toBe(true);
  });
});

describe('a Capacitor plugin follows the project major', () => {
  it('🔴 the report command: a bare plugin beside core@7 is pinned to 7', () => {
    const out = pinKnownDepsInInstallCommand('npm install @capacitor/core@7.6.9 @capacitor-mlkit/barcode-scanning@7.5.0 @capacitor/haptics');
    const haptics = NATIVE_CAPABILITIES.find((c) => c.pkg === '@capacitor/haptics')!.version;
    expect(out).toContain(`@capacitor/haptics@${haptics}`);
    expect(out).not.toContain('@capacitor/core@7.6.9@');
    expect(out).toContain('@capacitor/core@7.6.9');
    expect(out).toContain('@capacitor-mlkit/barcode-scanning@7.5.0');
  });

  it('the project range decides when the command does not install core', () => {
    expect(pinKnownDepsInInstallCommand('npm install @capacitor/camera', { capacitorRange: '^8.1.0' })).toBe('npm install @capacitor/camera@^8.0.0');
    expect(pinKnownDepsInInstallCommand('npm install @capacitor/core')).toBe('npm install @capacitor/core');
  });
});
