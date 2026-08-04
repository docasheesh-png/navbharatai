// Tests for the AI repair tier (tier 2 of the self-healing APK/AAB loop).
//
// The deterministic tier's tests lock "each named class is repaired correctly". This file locks the
// opposite concern: an LLM is UNTRUSTED input, so what matters is that every hard gate around its reply
// actually holds — invented paths, secrets, empty edits, junk replies, oversized files — and that a miss
// is a miss (honest "could not fix"), never a partial or empty commit.

import { describe, it, expect } from 'vitest';
import {
  AI_REPAIR_MAX_FILE_CHARS, AI_REPAIR_SYSTEM_PROMPT,
  aiRepairAllowedPaths, aiRepairEnabled, aiRepairModelChain,
  buildAiRepairPrompt, filesNamedInLog, parseAiRepairReply, runAiRepair, sanitizeAiText,
} from './mobileBuildAiRepair';

const WF = '.github/workflows/android-apk.yml';
const CURRENT = {
  [WF]: 'name: build',
  'package.json': '{"name":"app"}',
  'src/App.tsx': 'export const App = () => <div/>;',
};
const ALLOWED = Object.keys(CURRENT);

describe('which files the model may see', () => {
  it('extracts the source files the failing log names', () => {
    const log = [
      'error during build:',
      'src/App.tsx (12:8): "useTodos" is not exported by "src/hooks/useTodos.ts"',
    ].join('\n');
    expect(filesNamedInLog(log)).toEqual(['src/App.tsx', 'src/hooks/useTodos.ts']);
  });

  it('caps the count and deduplicates', () => {
    const log = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts error`).join('\n') + '\nsrc/f0.ts again';
    expect(filesNamedInLog(log).length).toBeLessThanOrEqual(4);
  });

  it('never offers secrets, lock files or traversal paths, whatever the log says', () => {
    const log = 'src/.env.production failed\napp/release.keystore broken\nsrc/../../etc/passwd.ts\npackage-lock.json mismatch';
    for (const p of filesNamedInLog(log)) {
      expect(p).not.toMatch(/\.env|keystore|\.\.|package-lock/);
    }
    const allowed = aiRepairAllowedPaths(WF, log);
    expect(allowed).toContain(WF);
    expect(allowed.some((p) => /keystore|\.env|package-lock/.test(p))).toBe(false);
  });
});

describe('the reply gates — every one is load-bearing', () => {
  const fix = (files: Record<string, string>) =>
    JSON.stringify({ fixable: true, explanation: 'Corrected the build step.', files });

  it('accepts a valid fix, including one wrapped in markdown fences', () => {
    const raw = '```json\n' + fix({ [WF]: 'name: build\nfixed: yes' }) + '\n```';
    const r = parseAiRepairReply(raw, ALLOWED, CURRENT);
    expect(r && 'files' in r && r.files[WF]).toContain('fixed: yes');
  });

  it('rejects a path the model invented', () => {
    expect(parseAiRepairReply(fix({ 'src/Evil.ts': 'x' }), ALLOWED, CURRENT)).toBeNull();
  });

  it('rejects secrets and traversal even if somehow allow-listed', () => {
    const dirty = [...ALLOWED, 'release.keystore', 'src/../.env'];
    expect(parseAiRepairReply(fix({ 'release.keystore': 'k' }), dirty, CURRENT)).toBeNull();
    expect(parseAiRepairReply(fix({ 'src/../.env': 'k' }), dirty, CURRENT)).toBeNull();
  });

  it('THE LOOP GUARD: a reply whose files are all identical to what is there is a miss', () => {
    expect(parseAiRepairReply(fix({ [WF]: CURRENT[WF] }), ALLOWED, CURRENT)).toBeNull();
  });

  it('rejects junk, non-JSON, oversized and empty content', () => {
    expect(parseAiRepairReply('I think the problem is gradle.', ALLOWED, CURRENT)).toBeNull();
    expect(parseAiRepairReply('{"fixable": true, "files": "not an object"}', ALLOWED, CURRENT)).toBeNull();
    expect(parseAiRepairReply(fix({ [WF]: '' }), ALLOWED, CURRENT)).toBeNull();
    expect(parseAiRepairReply(fix({ [WF]: 'x'.repeat(AI_REPAIR_MAX_FILE_CHARS + 1) }), ALLOWED, CURRENT)).toBeNull();
  });

  it('honours an honest fixable:false from the model', () => {
    const r = parseAiRepairReply('{"fixable": false, "explanation": "The signing key is missing."}', ALLOWED, CURRENT);
    expect(r && !('files' in r) && r.fixable).toBe(false);
  });
});

describe('what the user is told (White-Label Law)', () => {
  it('strips every vendor and model name from the explanation', () => {
    const s = sanitizeAiText('Claude fixed it after GLM glm-5.2 and Kimi failed; Gemini agreed.');
    expect(s).not.toMatch(/claude|glm|kimi|gemini|sonnet|opus/i);
    expect(s).toContain("NavBharatAI's engine");
  });

  it('a sanitized explanation flows through the accepted fix', () => {
    const raw = JSON.stringify({ fixable: true, explanation: 'Sonnet rewrote the gradle step.', files: { [WF]: 'name: b2' } });
    const r = parseAiRepairReply(raw, ALLOWED, CURRENT);
    expect(r && 'files' in r ? r.explanation : '').not.toMatch(/sonnet/i);
  });

  it('the system prompt itself forbids naming tools to the user', () => {
    expect(AI_REPAIR_SYSTEM_PROMPT).toMatch(/no tool or vendor names/);
    expect(AI_REPAIR_SYSTEM_PROMPT).toMatch(/fixable.*false/i);
  });
});

describe('the model chain (heal-gate policy: flagship cheap coders, never Sonnet/Opus)', () => {
  it('is empty with no keys — the route then reports honestly instead of pretending', () => {
    expect(aiRepairModelChain({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('GLM flagship leads, Kimi coder follows; comma key-pools take the first key', () => {
    const chain = aiRepairModelChain({ GLM_API_KEY: 'k1,k2,k3', KIMI_API_KEY: 'm1' } as NodeJS.ProcessEnv);
    expect(chain.map((c) => c.provider)).toEqual(['GLM', 'KIMI']);
    expect(chain[0].apiKey).toBe('k1');
    expect(chain[0].model).toBe('glm-5.2');
    expect(chain[1].model).toBe('kimi-k2.7-code');
    for (const rung of chain) expect(rung.model).not.toMatch(/claude|sonnet|opus/i);
  });

  it('the kill switch works', () => {
    expect(aiRepairEnabled({ MOBILE_AUTOFIX_AI: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(aiRepairEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('running the chain', () => {
  const ctx = { log: 'error at src/App.tsx', files: CURRENT, ruleSummary: 'Unknown failure.' };

  it('the first model whose reply validates wins', async () => {
    const replies = [
      'garbage that fails validation',
      JSON.stringify({ fixable: true, explanation: 'Fixed the import.', files: { 'src/App.tsx': 'export const App = () => <span/>;' } }),
    ];
    let call = 0;
    const r = await runAiRepair(async () => replies[call++], [
      { provider: 'GLM', model: 'glm-5.2', baseURL: 'x', apiKey: 'k' },
      { provider: 'KIMI', model: 'kimi-k2.7-code', baseURL: 'x', apiKey: 'k' },
    ], ctx);
    expect(call).toBe(2);
    expect(r && 'files' in r && r.files['src/App.tsx']).toContain('<span/>');
  });

  it('a model that throws falls through; all rungs missing yields an honest null', async () => {
    const r = await runAiRepair(async () => { throw new Error('429'); }, [
      { provider: 'GLM', model: 'glm-5.2', baseURL: 'x', apiKey: 'k' },
    ], ctx);
    expect(r).toBeNull();
  });

  it('the prompt carries the rule verdict, the log and every offered file', () => {
    const prompt = buildAiRepairPrompt(ctx);
    expect(prompt).toContain('Unknown failure.');
    expect(prompt).toContain('error at src/App.tsx');
    for (const path of Object.keys(CURRENT)) expect(prompt).toContain(`--- ${path} ---`);
  });

  it('a huge log is cut to its TAIL — failures live at the end', () => {
    // The unique marker at the START must be trimmed away; the error at the END must survive.
    const prompt = buildAiRepairPrompt({ ...ctx, log: 'FIRST-LINE-MARKER\n' + 'noise '.repeat(5000) + 'THE-REAL-ERROR' });
    expect(prompt).toContain('THE-REAL-ERROR');
    expect(prompt).not.toContain('FIRST-LINE-MARKER');
  });
});
