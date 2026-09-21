/**
 * ONE CHAT'S WORDS STAY IN THAT CHAT — the leak lock for five concurrent professional windows
 * (admin 2026-09-21, verbatim: *"chat leak na ho … kabhi kabhi ek hi professional 2 chat me baat karega,
 * to aisi sthiti me ek chat ki baat/memory 2nd me na jaye … text reply idhar ka udhar na ho,
 * gpt/claude/gemini jaisa banao"*).
 *
 * THE LEAK, named so it is recognised again: semantic memory was scoped per PROFESSIONAL and holds
 * the user's sentences and the assistant's replies VERBATIM, and the attachment recall was keyed per
 * professional too. Two Teacher AI windows therefore shared one memory: chat B's prompt carried chat
 * A's actual words. The profile (facts) is the ONE thing that may cross — and, since this change, it
 * crosses every expert deliberately (see `SHARED_MEMORY_FIELDS`).
 *
 * Three layers are locked here: the pure helpers, the engine threading the id into BOTH memory calls,
 * and a SOURCE-level guard on the filter itself — `tsc` and `vitest` cannot see that a filter line was
 * deleted, because every behavioural test in this repo passes with recall wide open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const getRouterMock = vi.fn();
vi.mock('../src/server/AI/AIRouterManager', () => ({
  AIRouterManager: { getRouter: (ns: string) => getRouterMock(ns) },
}));
vi.mock('../src/server/professionals/ClientProfileStore', () => ({
  clientProfileStore: { load: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue(undefined) },
}));
const retrieveMock = vi.fn();
const rememberMock = vi.fn();
vi.mock('../src/server/memory/conversationMemory', () => ({
  retrieveMemoryBlock: (...args: unknown[]) => retrieveMock(...args),
  rememberTurn: (...args: unknown[]) => rememberMock(...args),
}));

import { runProfessionalChat } from '../src/server/professionals/engine';
import { conversationIdFromBody, attachmentRecallKey } from '../src/server/professionals/conversationId';
import type { ProfessionalConfig } from '../src/server/professionals/types';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TEACHER: ProfessionalConfig = {
  id: 'teacher_ai',
  name: 'Teacher AI',
  systemPrompt: 'You are Teacher AI.',
  memory: { subject: 'student', intake: 'Learn their name.', fields: [{ key: 'name', label: 'Name' }] },
};

describe('the pure helpers', () => {
  it('conversationIdFromBody accepts a plausible client-minted id and nothing else', () => {
    expect(conversationIdFromBody('c_9f2a-b')).toBe('c_9f2a-b');
    expect(conversationIdFromBody('  c1  ')).toBe('c1');
    for (const bad of [undefined, null, 42, '', ' ', 'has space', 'x'.repeat(65), 'a/b', { id: 'c' }]) {
      expect(conversationIdFromBody(bad), String(bad)).toBeUndefined();
    }
  });

  it('attachmentRecallKey differs per conversation, and the legacy conversation has a key of its own', () => {
    const a = attachmentRecallKey('uid', 'teacher_ai', 'conv-A');
    const b = attachmentRecallKey('uid', 'teacher_ai', 'conv-B');
    const legacy = attachmentRecallKey('uid', 'teacher_ai', undefined);
    expect(new Set([a, b, legacy]).size).toBe(3);
    // Still under the user and the professional FIRST — a key that dropped either would be the IDOR
    // the route's own comment was written against.
    for (const k of [a, b, legacy]) expect(k.startsWith('uid:teacher_ai')).toBe(true);
  });
});

describe('the engine hands the conversation id to BOTH memory calls', () => {
  beforeEach(() => {
    getRouterMock.mockReset().mockReturnValue({
      routeRaced: vi.fn().mockResolvedValue({ response: { content: 'ok' }, telemetry: { success: true } }),
    });
    retrieveMock.mockReset().mockResolvedValue('');
    rememberMock.mockReset().mockResolvedValue(undefined);
  });

  it('recall and remember both carry the id of the window that is talking', async () => {
    await runProfessionalChat(TEACHER, 'mera makaan-malik ne notice bheja hai', [], 'uid-1', 'paid', { conversationId: 'conv-A' });
    expect(retrieveMock).toHaveBeenCalledTimes(1);
    expect(retrieveMock.mock.calls[0][0]).toBe('uid-1');
    expect(retrieveMock.mock.calls[0][1]).toBe('professional:teacher_ai');
    expect(retrieveMock.mock.calls[0][4]).toBe('conv-A');
    expect(rememberMock).toHaveBeenCalledTimes(1);
    expect(rememberMock.mock.calls[0][1]).toBe('professional:teacher_ai');
    expect(rememberMock.mock.calls[0][4]).toBe('conv-A');
  });

  it('with no id the engine names the LEGACY conversation (undefined) on both calls — never a made-up one', async () => {
    await runProfessionalChat(TEACHER, 'hello there, teacher', [], 'uid-1');
    expect(retrieveMock.mock.calls[0][4]).toBeUndefined();
    expect(rememberMock.mock.calls[0][4]).toBeUndefined();
  });
});

describe('🔒 source-level guards — what tsc and vitest cannot see', () => {
  it('selectRelevant filters by conversation BEFORE scoring, with the uniform rule (no "undefined means all")', () => {
    const src = codeOnly(read('src/server/memory/semanticMemory.ts'));
    const fn = src.slice(src.indexOf('export function selectRelevant'), src.indexOf('export function formatMemoryBlock'));
    expect(fn).toContain('if (c.conversationId !== conversationId) continue;');
    // The first draft read `conversationId !== undefined && …` — under which an id-less caller (an old
    // client, a voice path) recalled EVERY window's words. That shape must not come back.
    expect(fn).not.toContain('conversationId !== undefined &&');
    const filterAt = fn.indexOf('c.conversationId !== conversationId');
    const scoreAt = fn.indexOf('cosineSimilarity(queryEmbedding, c.embedding)');
    expect(filterAt).toBeGreaterThan(0);
    expect(filterAt).toBeLessThan(scoreAt);
  });

  it('mergeChunks keys a chunk by conversation AND text — the same sentence in two chats is two chunks', () => {
    const src = codeOnly(read('src/server/memory/semanticMemory.ts'));
    expect(src).toContain("const key = `${c.conversationId ?? ''}|${c.role}:${normalizeText(c.text)}`;");
  });

  it('rememberTurn stamps the id and never writes `conversationId: undefined` (Firestore refuses it)', () => {
    const src = codeOnly(read('src/server/memory/conversationMemory.ts'));
    expect(src).toContain('...(conversationId ? { conversationId } : {})');
    expect(src).toContain('selectRelevant(queryVec, chunks, { excludeTexts, conversationId })');
  });

  it('the route keys attachment recall by the conversation and passes the id to the engine', () => {
    const src = codeOnly(read('src/server/routes/professionals.ts'));
    expect(src).toContain('attachmentRecallKey(verifiedUserId, config.id, conversationId)');
    expect(src).toContain("verifiedUserId || undefined, gate.tier, { conversationId })");
    // The old per-professional key must be gone — it was the second leak.
    expect(src).not.toContain('`${verifiedUserId}:${config.id}`');
  });

  it('the client sends the id with every turn, from the ONE professional chat component', () => {
    const src = codeOnly(read('src/components/professionals/ProfessionalChat.tsx'));
    expect(src).toContain('conversationId: serverConversationId(conversationId)');
  });

  // ── THE SIBLING LANE (review finding, same day): voice memory holds spoken turns verbatim ─────────
  it('the VOICE lane carries the id too — into the init message, the load and the append', () => {
    const chat = codeOnly(read('src/components/professionals/ProfessionalChat.tsx'));
    expect(chat).toMatch(/<ProfessionalVoiceButton[\s\S]{0,120}?conversationId=\{serverConversationId\(conversationId\)\}/);
    const btn = codeOnly(read('src/components/sonic/ProfessionalVoiceButton.tsx'));
    expect(btn).toMatch(/<SonicChat[\s\S]{0,160}?conversationId=\{conversationId\}/);
    const sonic = codeOnly(read('src/components/sonic/SonicChat.tsx'));
    expect(sonic).toContain("{ type: 'init', professionalId, conversationId, history: history?.slice(-12) }");
    const ws = codeOnly(read('src/server/sonic/sonicWs.ts'));
    expect(ws).toContain('conversationId = conversationIdFromBody(msg.conversationId);');
    expect(ws).toContain("voiceMemoryStore.load(uid || '', professionalId, conversationId)");
    expect(ws).toContain('voiceMemoryStore.append(uid, professionalId, transcript.slice(), conversationId)');
  });
});
