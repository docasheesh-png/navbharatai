// Autopsy dcce5d26 (2026-10-04). "I want to convert one existing website into an online APK but not
// publically." reached a fresh workspace with no URL and no code. It was built: the fast lane planned a
// wrapper for a website nobody had named, and the user stopped it at 20 s. `projectElsewhere.ts` exists
// for exactly this class ("the thing to work on is not here"), but it knew only two ways of saying so —
// a named host or "do not rebuild" — and its "existing" rule did not know the determiner "one".
//
// The same report's per-call log recorded `model: "glm"`, a vendor, where a model id belongs. The fast
// lane records through `fastLaneCallIdentity`, which the f152c1ab fix (`answeringModel`) never reached.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProjectElsewhere,
  shouldAnswerProjectElsewhere,
  projectElsewhereSteer,
  projectElsewhereFallback,
} from '../src/server/AgentV3/projectElsewhere';
import { fastLaneCallIdentity } from '../src/server/routes/agentv3';
import { looksLikeFamilyLabelOnly } from '../src/server/AgentV3/answeringModel';
import { modelAlwaysReasons } from '../src/server/AgentV3/providers/glmThinking';
import { runSimpleBuild, fileUserPrompt } from '../src/server/AgentV3/SimpleBuilder';
import { oneShotUserPrompt } from '../src/server/AgentV3/OneShotBuilder';
import { isProjectConfigPath, existingFileBlock, existingConfigsBlock, EXISTING_CONFIG_MAX_CHARS } from '../src/server/AgentV3/existingConfig';

const REAL = 'I want to convert one existing website into an online APK but not publically.';
const answered = (prompt: string) => shouldAnswerProjectElsewhere({ prompt, userAppExists: false, importing: false });

describe('§1 turning the user\'s own site into a phone app is answered, not built', () => {
  it('🔴 the real prompt, on a fresh workspace', () => {
    const v = readProjectElsewhere(REAL);
    expect(v.claimsExisting).toBe(true);
    expect(v.convertsToPhoneApp).toBe(true);
    expect(v.website).toBe(true);
    expect(v.wantsPrivate).toBe(true);
    expect(answered(REAL)).toBe(true);
  });

  it.each([
    'convert my website into an apk',
    'Turn my existing site into an Android app',
    'Wrap our web app into a mobile app',
    'make an apk of my website https://sharma-sweets.in',
    'I need an android app from my website',
    'convert sharmasweets.com to an app',
    'meri website ka apk bana do',
    'apni site ko app me convert kar do',
    'Convert an existing website into an app for personal use',
  ])('CLASS: answered — %s', (p) => {
    expect(answered(p), p).toBe(true);
  });

  it.each([
    'Build a website to sell my apps',
    'Make a mobile app for my website\'s customers',
    'build an app that converts any website into an apk',
    'Create a website to APK converter',
    'Convert currency in my app',
    'turn on dark mode in the app',
    'change my link to app store link',
    'meri website ko app jaisa design karo',
    'Build a todo app and give me the apk',
    'Convert a website into an app',
    'convert this text to an app name',
  ])('PRECISION: not intercepted — %s', (p) => {
    expect(answered(p), p).toBe(false);
  });

  it('🔒 a workspace that holds the user\'s app is never intercepted', () => {
    expect(shouldAnswerProjectElsewhere({ prompt: REAL, userAppExists: true, importing: false })).toBe(false);
  });

  it('🔒 an import on this turn is never intercepted', () => {
    expect(shouldAnswerProjectElsewhere({ prompt: REAL, userAppExists: false, importing: true })).toBe(false);
  });
});

describe('§2 the reply tells the truth about a live link and about privacy', () => {
  const v = readProjectElsewhere(REAL);

  it('the steer names the honest limit, the import routes, the APK Builder and the private file', () => {
    const steer = projectElsewhereSteer(v);
    expect(steer).toMatch(/cannot turn a live website LINK into an app/);
    expect(steer).toContain('"Import Repo"');
    expect(steer).toContain('Download APK');
    expect(steer).toMatch(/not published on the Play Store/);
  });

  it('the fallback says the same facts in fixed words', () => {
    const text = projectElsewhereFallback(v);
    expect(text).toMatch(/cannot turn a live website link into an app/);
    expect(text).toMatch(/not published on the Play Store/);
  });

  it('a plain "my existing app is on GitHub" reply does not gain the website lines', () => {
    const plain = projectElsewhereSteer(readProjectElsewhere('My existing app is on GitHub, please fix the login page'));
    expect(plain).not.toMatch(/live website LINK/);
    expect(plain).not.toMatch(/Play Store or anywhere else/);
  });

  it('🔒 White-Label: neither text names an AI vendor or model', () => {
    const both = projectElsewhereSteer(v) + projectElsewhereFallback(v);
    expect(both).not.toMatch(/\b(?:glm|kimi|claude|anthropic|gemini|grok|openai|nemotron)\b/i);
  });
});

describe('§3 a fast-lane call records the model that answered, not the vendor', () => {
  it('🔴 the real call: GLM answered as glm-4.7-flashx', () => {
    const who = fastLaneCallIdentity(true, 'GLM', 'claude-sonnet-4-6', 'glm-4.7-flashx');
    expect(who).toEqual({ provider: 'glm', model: 'glm-4.7-flashx' });
    expect(looksLikeFamilyLabelOnly(who.model)).toBe(false);
  });

  it('a runner that reports no model still falls back to the family, never an invented id', () => {
    expect(fastLaneCallIdentity(true, 'KIMI', 'claude-sonnet-4-6').model).toBe('kimi');
    expect(fastLaneCallIdentity(true, 'KIMI', 'claude-sonnet-4-6', '  ').model).toBe('kimi');
  });

  it('a Claude delivery prefers what answered over the planned Claude-tier id', () => {
    expect(fastLaneCallIdentity(true, 'CLAUDE_HAIKU', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001').model).toBe('claude-haiku-4-5-20251001');
    expect(fastLaneCallIdentity(true, 'CLAUDE', 'claude-sonnet-4-6').model).toBe('claude-sonnet-4-6');
  });

  it('SIBLING WOKEN: the lane\'s "fell to a reasoning engine" check can now see one (a family label never reasons)', () => {
    expect(modelAlwaysReasons('kimi')).toBe(false);
    expect(modelAlwaysReasons(fastLaneCallIdentity(true, 'KIMI', 'claude-sonnet-4-6', 'kimi-k2.7-code').model)).toBe(true);
  });

  it('nobody reported ⇒ unknown, whatever answered claims', () => {
    expect(fastLaneCallIdentity(false, 'GLM', 'claude-sonnet-4-6', 'glm-4.7-flashx')).toEqual({ provider: 'unknown', model: 'unknown' });
  });

  it('REVERSION GUARD: the success path passes what answered', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toContain('fastLaneCallIdentity(providerReported, usedProvider, fbModel, t.model)');
    // The vendor-as-model expression is gone from the helper.
    const helper = src.slice(src.indexOf('export function fastLaneCallIdentity('), src.indexOf('export function fastLaneCallIdentity(') + 1600);
    expect(helper).not.toMatch(/claudeTierModel : String\(usedProvider \|\| ''\)\.toLowerCase\(\) \}/);
  });
});

describe('§4 a config file the starter already has is edited, never rewritten blind', () => {
  it('only project CONFIG files qualify — the starter page is meant to be replaced', () => {
    for (const p of ['package.json', 'index.html', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.cjs']) {
      expect(isProjectConfigPath(p), p).toBe(true);
    }
    for (const p of ['src/App.tsx', 'src/main.tsx', 'public/index.html', 'src/config.ts', 'src/package.json']) {
      expect(isProjectConfigPath(p), p).toBe(false);
    }
  });

  it('the per-file prompt carries the current content, and an oversized file is left to today\'s behaviour', () => {
    const spec = { path: 'vite.config.ts', purpose: 'Vite config' };
    const current = "export default defineConfig({ server: { host: true, allowedHosts: true } })";
    const text = fileUserPrompt('a notes app', spec, [spec], undefined, undefined, undefined, current);
    expect(text).toContain('THIS FILE ALREADY EXISTS');
    expect(text).toContain('allowedHosts: true');
    expect(existingFileBlock('vite.config.ts', 'x'.repeat(EXISTING_CONFIG_MAX_CHARS + 1))).toBe('');
    expect(fileUserPrompt('a notes app', spec, [spec])).not.toContain('ALREADY EXISTS');
  });

  it('🔴 the lane shows a planned starter config its current content, and never shows the starter page', async () => {
    const seen: Record<string, string> = {};
    const read: string[] = [];
    await runSimpleBuild({
      prompt: 'a notes app', framework: 'vite-react', overallTimeoutMs: 5_000,
      scaffoldPaths: ['package.json', 'tsconfig.json', 'vite.config.ts', 'src/App.tsx', 'src/main.tsx'],
      readExisting: async (p) => { read.push(p); return `CURRENT-${p}`; },
      generate: async (_system, user) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Notes.tsx :: notes list\nvite.config.ts :: vite config\ntsconfig.json :: ts config';
        const p = /Now write THIS file in full:\n {2}(\S+)/.exec(user)?.[1] ?? '';
        if (p) seen[p] = user;
        return `<<<FILE ${p}>>>\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
    });
    expect(seen['vite.config.ts']).toContain('CURRENT-vite.config.ts');
    expect(seen['tsconfig.json']).toContain('CURRENT-tsconfig.json');
    expect(seen['src/App.tsx']).not.toContain('ALREADY EXISTS');
    expect(read).not.toContain('src/App.tsx');
  });

  it('the one-shot lane shows every existing config under the same rule', () => {
    const text = oneShotUserPrompt('a notes app', ['package.json', 'src/App.tsx'], { 'package.json': '{"scripts":{"build":"vite build"}}', 'src/App.tsx': 'starter' });
    expect(text).toContain('<<<CURRENT package.json>>>');
    expect(text).not.toContain('<<<CURRENT src/App.tsx>>>');
    expect(existingConfigsBlock({})).toBe('');
  });

  it('REVERSION GUARD: both lanes are wired to read the project file', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    expect(src).toContain('readExisting: readExistingProjectFile,');
    expect(src).toContain('runOneShot({ prompt, framework, scaffoldPaths: scaffold, readExisting: readExistingProjectFile,');
    expect(src).toMatch(/withoutPreviewBridge\(p, raw\)/);
  });
});
