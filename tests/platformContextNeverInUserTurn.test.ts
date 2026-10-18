/**
 * 🔴 PLATFORM CONTEXT NEVER RIDES IN THE USER'S TURN (admin 2026-10-17: free chat replied with
 * "[Follow-up. No greeting needed. Respond in same language as user.]").
 *
 * CLASS: platform-written context — instruction tags, conversation memory, recall, live web results, the
 * canvas, a case snapshot — concatenated into the message a model receives as the PERSON's words. The
 * model quotes it, obeys it as the person's request, or thanks them for it. One door now places it
 * (src/server/lib/platformContext.ts) and one module strips the shapes chats were saved in while it
 * leaked (src/lib/platformTags.ts). These tests fail when any of that regresses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { placePlatformContext, PLATFORM_CONTEXT_HEADER } from '../src/server/lib/platformContext';
import { containsPlatformTag, stripPlatformTags, cleanTurns } from '../src/lib/platformTags';
import { shapeSession } from '../src/lib/sessionShape';
import { checkChatInput } from '../src/server/lib/chatInputLimits';

// ── the door ────────────────────────────────────────────────────────────────────────────────────────
describe('placePlatformContext — the one door', () => {
  const saved = process.env.PLATFORM_CONTEXT_IN_SYSTEM;
  afterEach(() => { if (saved === undefined) delete process.env.PLATFORM_CONTEXT_IN_SYSTEM; else process.env.PLATFORM_CONTEXT_IN_SYSTEM = saved; });

  it('default ON: the user turn is byte-identical to what was typed; context goes to the system prompt', () => {
    delete process.env.PLATFORM_CONTEXT_IN_SYSTEM;
    const out = placePlatformContext({ system: 'SYS', user: 'kal ka score?', blocks: [{ label: 'Live web results', body: 'LIVE WEB RESULTS …' }] });
    expect(out.user).toBe('kal ka score?');
    expect(out.system.startsWith('SYS')).toBe(true);
    expect(out.system).toContain(PLATFORM_CONTEXT_HEADER);
    expect(out.system).toContain('### Live web results');
    expect(out.system).toContain('LIVE WEB RESULTS …');
    expect(containsPlatformTag(out.user)).toBe(false);
  });

  it('empty blocks change nothing at all', () => {
    const out = placePlatformContext({ system: 'SYS', user: 'hi', blocks: [null, undefined, false, '', { label: 'x', body: '   ' }] });
    expect(out).toEqual({ system: 'SYS', user: 'hi' });
  });

  it('kill switch PLATFORM_CONTEXT_IN_SYSTEM=off restores the old placement (context before the message)', () => {
    process.env.PLATFORM_CONTEXT_IN_SYSTEM = 'off';
    const out = placePlatformContext({ system: 'SYS', user: 'hi', blocks: [{ label: 'm', body: 'MEM' }] });
    expect(out.system).toBe('SYS');
    expect(out.user).toBe('MEM\n\n---\nhi');
  });
});

// ── strip-on-read ───────────────────────────────────────────────────────────────────────────────────
describe('stripPlatformTags — chats saved while tags leaked show only the person\'s words', () => {
  const cases: Array<[string, string, string]> = [
    ['the leaked follow-up tag (in a reply)', '[Follow-up. No greeting needed. Respond in same language as user.]\n\nHaan, bilkul!', 'Haan, bilkul!'],
    ['client session memory', '[SESSION MEMORY]\nUser is building a shop app\n\n---\n\nprice add karo', 'price add karo'],
    ['server conversation memory', '[CONVERSATION MEMORY — summary of earlier discussion:\nwe discussed GST]\n\nCurrent message: aur batao', 'aur batao'],
    ['server canvas memory', '[MEMORY: a todo app]\n\nmake it blue', 'make it blue'],
    ['mode tag line', '[FIX MODE] User is reporting a bug or error. Focus ONLY on the specific issue.\n\nbutton kaam nahi karta', 'button kaam nahi karta'],
    ['stacked tag lines', '[EDIT MODE] User wants to MODIFY existing code.\n[COMPONENT FOCUS] User mentions: Header — target these specifically.\n[ERROR DETECTED] User has pasted a runtime error.\n\nHeader fix karo', 'Header fix karo'],
    ['SDA case context', '[CASE_CONTEXT]\n{"a":1}\n[/CASE_CONTEXT]\nContinue the clinical assessment. Do NOT re-ask anything.\nfever 3 days', 'fever 3 days'],
    ['live web results', 'LIVE WEB RESULTS (fetched just now, 2026-10-17):\n1. x\n\n---\naaj ka score', 'aaj ka score'],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(containsPlatformTag(input)).toBe(true);
      expect(stripPlatformTags(input)).toBe(expected);
      expect(containsPlatformTag(stripPlatformTags(input))).toBe(false);
    });
  }

  it('a clean message is returned as the SAME string, and ordinary brackets are not touched', () => {
    for (const t of ['namaste', '[link](https://x.in)', 'arr[0] = 1', 'Use [FIX] in the title', 'mode: [EDIT MODE] is a button label in my app']) {
      expect(stripPlatformTags(t)).toBe(t);
    }
  });

  it('never turns a message into nothing', () => {
    const only = '[Follow-up. No greeting needed. Respond in same language as user.]';
    expect(stripPlatformTags(only)).toBe(only);
  });

  it('cleanTurns keeps identity when nothing matched and rewrites only tagged turns (both stored shapes)', () => {
    const clean = [{ sender: 'user', text: 'hi' }, { role: 'assistant', content: 'hello' }];
    expect(cleanTurns(clean)).toBe(clean);
    const dirty = [{ sender: 'user', text: 'hi' }, { role: 'assistant', content: '[Follow-up. No greeting needed. Respond in same language as user.]\nok' }];
    const out = cleanTurns(dirty);
    expect(out).not.toBe(dirty);
    expect(out[0]).toBe(dirty[0]);
    expect((out[1] as { content: string }).content).toBe('ok');
  });

  it('the session door (shapeSession) strips a saved chat, and leaves a clean one untouched', () => {
    const clean = { id: 'a', messages: [{ sender: 'user', text: 'hi' }] };
    expect(shapeSession(clean)).toBe(clean);
    const saved = { id: 'b', messages: [{ sender: 'ai', text: '[Follow-up. No greeting needed. Respond in same language as user.]\n\nJi haan' }] };
    expect(shapeSession(saved).messages[0].text).toBe('Ji haan');
  });

  it('the chat input door strips history before it is re-sent to the model', () => {
    const v = checkChatInput({ message: 'aur?', fileAttachments: undefined, history: [{ sender: 'ai', text: '[Follow-up. No greeting needed. Respond in same language as user.]\nPehla jawab' }] });
    expect(v.ok).toBe(true);
    if (v.ok) expect((v.history[0] as { text: string }).text).toBe('Pehla jawab');
  });
});

// ── behaviour: the free chat route ──────────────────────────────────────────────────────────────────
const routed: Array<{ message: string; system: string }> = [];
vi.mock('../src/server/lib/aiRouter', () => ({
  aiRouter: {
    routeDetailed: vi.fn(async (message: string, _h: unknown, _t: unknown, _x: unknown, system: string) => {
      routed.push({ message, system });
      return { response: { content: 'ok', provider: 'test', model: 'test' }, telemetry: {} };
    }),
    routeStream: vi.fn(async (message: string, _h: unknown, _t: unknown, system: string, onChunk: (c: string) => void) => {
      routed.push({ message, system });
      onChunk('ok');
      return { provider: 'test', model: 'test', content: 'ok' };
    }),
  },
}));
vi.mock('../src/server/lib/liveSearchContext', async (orig) => ({
  ...(await orig<typeof import('../src/server/lib/liveSearchContext')>()),
  liveSearchContext: vi.fn(async () => 'LIVE WEB RESULTS (fetched just now, 2026-10-17):\n1. result'),
}));

describe('free chat route — what the model receives as the user turn is what the person typed', () => {
  beforeEach(() => { routed.length = 0; delete process.env.PLATFORM_CONTEXT_IN_SYSTEM; process.env.VITEST = 'true'; });

  it('memory and live results go to the system prompt; the message is untouched', async () => {
    const { registerChatRoutes } = await import('../src/server/routes/chat');
    const { captureRoutes, mockReq, mockRes } = await import('./helpers/routeTestUtils');
    const handler = captureRoutes(registerChatRoutes, () => {}).get('POST /api/chat/navbharat')!;
    const typed = 'aaj India ka match kaisa raha?';
    const res = mockRes();
    await handler(mockReq({ body: { message: typed, history: [], memorySummary: 'The user follows Indian cricket closely and asked about the squad earlier.' } }), res);
    expect(routed.length).toBeGreaterThan(0);
    const call = routed[routed.length - 1];
    expect(call.message).toBe(typed);
    expect(containsPlatformTag(call.message)).toBe(false);
    expect(call.system).toContain('follows Indian cricket closely');
    expect(call.system).toContain('LIVE WEB RESULTS');
    expect(call.system).toContain(PLATFORM_CONTEXT_HEADER);
  });
});

// ── static guard: no new site may prepend platform context onto a message ───────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('guard — no source file builds user content with platform context in it', () => {
  const files = [...walk('src/server'), ...walk('src/hooks'), 'server.ts'];
  const CONTEXT_VARS = 'liveBlock|recalled|memorySummary|mem|clinicalSnapshot|roleRecall|chatSessionRecall|sessionRecall|appKnowledge';
  const MESSAGE_VARS = 'message|prompt|chatPrompt|contextualMessage|userMessage|userText|userContent|promptWithContext';
  // `${context}…${message}` in one template, or `message = \`${context}…`
  const PREPEND = new RegExp(`(\\b(?:${MESSAGE_VARS})\\s*=\\s*\`\\$\\{(?:${CONTEXT_VARS})\\b)|(\`\\$\\{(?:${CONTEXT_VARS})\\}[^\`]*\\$\\{(?:${MESSAGE_VARS})\\})`);
  // Legacy literal tags. sda.ts keeps them ONLY inside its kill-switch branch; platformTags.ts lists them to strip.
  const LEGACY = /\[(?:CONVERSATION MEMORY|MEMORY: |SESSION MEMORY\]|CASE_CONTEXT\]|EARLIER SESSION —|FIX MODE\]|ADD MODE\]|EDIT MODE\]|CREATE MODE\]|FOLLOW-UP\]|COMPONENT FOCUS\]|ERROR DETECTED\])|Follow-up\. No greeting needed/;
  const LEGACY_ALLOWED = new Set(['src/server/routes/sda.ts']);

  it('scans a real tree', () => { expect(files.length).toBeGreaterThan(100); });

  it('no template prepends memory / recall / live results onto the user\'s message', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        if (PREPEND.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    expect(hits, 'route platform context through placePlatformContext (src/server/lib/platformContext.ts)').toEqual([]);
  });

  it('no legacy instruction/memory tag literal is written anywhere outside the kill-switch branch', () => {
    const hits: string[] = [];
    for (const f of [...files, ...walk('src/lib').filter((p) => !p.endsWith('platformTags.ts'))]) {
      if (LEGACY_ALLOWED.has(f)) continue;
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        if (LEGACY.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('sda.ts writes its legacy fake turns only when the kill switch is off', () => {
    const src = readFileSync('src/server/routes/sda.ts', 'utf8');
    expect(src).toMatch(/!contextInSystem && clinicalSnapshot/);
    expect(src).toMatch(/!contextInSystem && olderMsgs\.length > 0/);
  });
});
