import { describe, it, expect } from 'vitest';
import {
  sanitizeGeminiSchema,
  toolDefsToGemini,
  transcriptToGemini,
  mapGeminiFinish,
  parseGeminiResponse,
} from './GeminiToolAdapter';
import type { ClaudeToolDef } from '../ClaudeClient';

const TOOLS: ClaudeToolDef[] = [
  { name: 'write_file', description: 'Write a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
];

describe('sanitizeGeminiSchema', () => {
  it('strips Gemini-rejected keys recursively but keeps the shape', () => {
    const out = sanitizeGeminiSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'string', default: 'x' }, nested: { type: 'object', additionalProperties: true, properties: {} } },
      required: ['a'],
    });
    expect(out).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, nested: { type: 'object', properties: {} } },
      required: ['a'],
    });
  });

  it('returns an empty object schema for non-objects', () => {
    expect(sanitizeGeminiSchema(null)).toEqual({ type: 'object', properties: {} });
  });
});

describe('toolDefsToGemini', () => {
  it('wraps tool defs in functionDeclarations with sanitized parameters', () => {
    const out = toolDefsToGemini(TOOLS);
    expect(out).toEqual([
      { functionDeclarations: [{ name: 'write_file', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }] },
    ]);
  });
  it('returns undefined for no tools', () => {
    expect(toolDefsToGemini(undefined)).toBeUndefined();
    expect(toolDefsToGemini([])).toBeUndefined();
  });
});

describe('transcriptToGemini', () => {
  it('maps the system prompt to systemInstruction and a user string to a user/text content', () => {
    const req = transcriptToGemini([{ role: 'user', content: 'make a calculator' }], 'You build apps.');
    expect(req.systemInstruction).toBe('You build apps.');
    expect(req.contents).toEqual([{ role: 'user', parts: [{ text: 'make a calculator' }] }]);
  });

  it('maps an assistant text+tool_use turn to model role with text + functionCall parts', () => {
    const req = transcriptToGemini([
      { role: 'assistant', content: [
        { type: 'text', text: 'Creating it.' },
        { type: 'tool_use', id: 'tu_1', name: 'write_file', input: { path: 'a.js' } },
      ] },
    ]);
    expect(req.contents).toEqual([
      { role: 'model', parts: [{ text: 'Creating it.' }, { functionCall: { name: 'write_file', args: { path: 'a.js' } } }] },
    ]);
  });

  it('resolves tool_use_id -> name for the functionResponse (Gemini matches by name)', () => {
    const req = transcriptToGemini([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_42', name: 'write_file', input: { path: 'a.js' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_42', content: 'wrote a.js' }] },
    ]);
    expect(req.contents[1]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'write_file', response: { result: 'wrote a.js' } } }] });
  });

  it('passes through an object tool_result as the response object', () => {
    const req = transcriptToGemini([
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'evaluate', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: { score: 90 } }] },
    ]);
    expect(req.contents[1].parts[0].functionResponse?.response).toEqual({ score: 90 });
  });
});

describe('mapGeminiFinish', () => {
  it('forces tool_use when there are tool calls, else maps the reason', () => {
    expect(mapGeminiFinish('STOP', true)).toBe('tool_use');
    expect(mapGeminiFinish('STOP', false)).toBe('end_turn');
    expect(mapGeminiFinish('MAX_TOKENS', false)).toBe('max_tokens');
    expect(mapGeminiFinish(undefined, false)).toBe('end_turn');
  });
});

describe('parseGeminiResponse', () => {
  it('parses a plain text response', () => {
    const r = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: 'Done!' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5 },
    });
    expect(r.text).toBe('Done!');
    expect(r.toolUses).toEqual([]);
    expect(r.stopReason).toBe('end_turn');
    expect(r.usage).toEqual({ inputTokens: 30, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect(r.rawContent).toEqual([{ type: 'text', text: 'Done!' }]);
  });

  it('UNMASKS a MAX_TOKENS truncation during a functionCall (the CargoPilot vertex case)', () => {
    const r = parseGeminiResponse({
      candidates: [{ content: { parts: [{ functionCall: { name: 'write_file', args: { path: 'big.tsx', content: 'export const A = () =>' } } }] }, finishReason: 'MAX_TOKENS' }],
    });
    expect(r.stopReason).toBe('tool_use'); // masked (the loop still runs the tool)
    expect(r.truncated).toBe(true);        // …but the truncation is now visible to the guard
  });

  it('a text-only MAX_TOKENS stop is truncated; a normal STOP is not', () => {
    const t = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'half…' }] }, finishReason: 'MAX_TOKENS' }] });
    expect(t.stopReason).toBe('max_tokens');
    expect(t.truncated).toBe(true);
    const ok = parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] });
    expect(ok.truncated).toBeUndefined();
  });

  it('parses functionCall parts into synthesized-id toolUses + Anthropic rawContent + tool_use', () => {
    const r = parseGeminiResponse({
      candidates: [{ content: { parts: [
        { text: 'building' },
        { functionCall: { name: 'write_file', args: { path: 'a.js' } } },
        { functionCall: { name: 'evaluate', args: {} } },
      ] }, finishReason: 'STOP' }],
    });
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolUses).toEqual([
      { id: 'gemcall_0', name: 'write_file', input: { path: 'a.js' } },
      { id: 'gemcall_1', name: 'evaluate', input: {} },
    ]);
    expect(r.rawContent).toEqual([
      { type: 'text', text: 'building' },
      { type: 'tool_use', id: 'gemcall_0', name: 'write_file', input: { path: 'a.js' } },
      { type: 'tool_use', id: 'gemcall_1', name: 'evaluate', input: {} },
    ]);
  });

  it('handles an empty/blocked response without throwing', () => {
    const r = parseGeminiResponse({});
    expect(r.text).toBe('');
    expect(r.toolUses).toEqual([]);
    expect(r.usage.inputTokens).toBe(0);
  });
});
