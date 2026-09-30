// THE PROMPT NAMED TOOLS THE MODEL WAS NEVER GIVEN (2026-09-29, found while building payment verification).
//
// The architect prompt says "payments → generate_payment", "your own DB → generate_db_config", and "ask the
// user for a key with request_secrets". None of them was in any role's tool list, and `catalogForTools`
// silently drops what a role does not list — so the model was told to call tools it could not call. The key
// popup built on 2026-08-08 had never once been reachable. This test holds the prompt and the lists together.
//
// 🔒 A RATCHET. NOT_YET_OFFERED is the debt measured today, and it may only SHRINK: a name leaves it when its
// tool is offered (the stale-entry check fails until it is removed), and a new name the prompt promises
// without offering fails CI immediately. It is not a list of things that are fine.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { roleConfig } from '../src/server/AgentV3/AgentRegistry';
import { projectHasServer, noServerPaymentGuidance } from '../src/server/lib/PaymentGenerator';

const NOT_YET_OFFERED: readonly string[] = [
  'find_ui_element',
  'generate_ai',
  'generate_analytics',
  'generate_architecture_docs',
  'generate_cache',
  'generate_captcha',
  'generate_cors',
  'generate_csv',
  'generate_currency',
  'generate_datetime',
  'generate_email',
  'generate_email_template',
  'generate_env_validation',
  'generate_error_tracking',
  'generate_feature_flags',
  'generate_file_upload',
  'generate_game_controller',
  'generate_game_runtime',
  'generate_game_shell',
  'generate_game_systems',
  'generate_game_vfx',
  'generate_geocoding',
  'generate_graceful_shutdown',
  'generate_http_client',
  'generate_ids',
  'generate_image',
  'generate_indian_validators',
  'generate_jobs',
  'generate_logging',
  'generate_map',
  'generate_markdown',
  'generate_melody',
  'generate_moderation',
  'generate_money_format',
  'generate_newsletter',
  'generate_notify',
  'generate_otp',
  'generate_pagination',
  'generate_password',
  'generate_pdf',
  'generate_qr',
  'generate_ratelimit',
  'generate_realtime',
  'generate_retry',
  'generate_sanitize_html',
  'generate_scheduler',
  'generate_search',
  'generate_security_headers',
  'generate_seo',
  'generate_slug',
  'generate_sms',
  'generate_storage',
  'generate_translation',
  'generate_validation',
  'generate_weather',
  'write_files_batch',
];

const catalog = readFileSync('src/server/AgentV3/ToolCatalog.ts', 'utf8');
const catalogNames = new Set([...catalog.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1]));
const prompt = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
const promised = new Set([...prompt.matchAll(/\b([a-z]+(?:_[a-z]+)+)\b/g)].map((m) => m[1]).filter((n) => catalogNames.has(n)));
const architect = new Set<string>(roleConfig('architect').tools as string[]);

describe('every tool the architect prompt names is one it can call', () => {
  it('no NEW promise without the tool', () => {
    const missing = [...promised].filter((n) => !architect.has(n) && !NOT_YET_OFFERED.includes(n));
    expect(missing).toEqual([]);
  });
  it('the debt list holds no stale entry (offered now, or no longer named)', () => {
    const stale = NOT_YET_OFFERED.filter((n) => architect.has(n) || !promised.has(n));
    expect(stale).toEqual([]);
  });
  it('the payment, webhook, database and key-popup tools are offered', () => {
    for (const t of ['generate_payment', 'generate_webhook', 'generate_idempotency', 'generate_db_config', 'request_secrets']) {
      expect(architect.has(t), t).toBe(true);
    }
  });
  it('the key popup is the architect\'s alone — a sub-agent never opens a popup in front of the user', () => {
    for (const role of ['frontend', 'backend', 'fullstack', 'database'] as const) {
      expect(roleConfig(role).tools as string[]).not.toContain('request_secrets');
    }
  });
});

describe('generate_payment never pretends on an app with no server', () => {
  const vite = JSON.stringify({ dependencies: { react: '^18' }, devDependencies: { vite: '^8' } });
  it('a Vite/React app with no server folder has no server', () => {
    expect(projectHasServer(vite, ['src/App.tsx', 'src/utils/razorpay.ts', 'index.html'])).toBe(false);
  });
  it('an Express dependency, or a server folder, is a server', () => {
    expect(projectHasServer(JSON.stringify({ dependencies: { express: '^4' } }), [])).toBe(true);
    expect(projectHasServer(vite, ['server/index.ts'])).toBe(true);
    expect(projectHasServer('{ broken', ['api/pay.js'])).toBe(true);
  });
  it('the guidance forbids "paid" from the browser and writes nothing', () => {
    const g = noServerPaymentGuidance('razorpay');
    expect(g).toMatch(/no files were written/);
    expect(g).toMatch(/payment pending/);
    expect(g).toMatch(/NOT proof/);
    expect(g).not.toMatch(/will set up/);
  });
  it('the handler asks before it writes', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const at = src.indexOf("case 'generate_payment': {");
    const body = src.slice(at, at + 2500);
    expect(body.indexOf('projectHasServer(pkgText, paths)')).toBeGreaterThan(0);
    expect(body.indexOf('projectHasServer(pkgText, paths)')).toBeLessThan(body.indexOf('generatePaymentIntegration(pProvider)'));
  });
  it('the prompt states the rule once, beside the payment recipe', () => {
    expect(prompt).toMatch(/A payment is PAID only when a SERVER verified the gateway signature/);
  });
});
