import { describe, it, expect } from 'vitest';
import {
  toolDefsToOpenAI,
  transcriptToOpenAI,
  mapFinishReason,
  parseOpenAiCompletion,
} from './OpenAiToolAdapter';
import type { ClaudeToolDef } from '../ClaudeClient';

const TOOLS: ClaudeToolDef[] = [
  {
    name: 'write_file',
    description: 'Write a file',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
];

describe('toolDefsToOpenAI', () => {
  it('maps Anthropic tool defs to OpenAI function tools', () => {
    const out = toolDefsToOpenAI(TOOLS);
    expect(out).toEqual([
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write a file',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      },
    ]);
  });

  it('returns [] for undefined', () => {
    expect(toolDefsToOpenAI(undefined)).toEqual([]);
  });
});

describe('transcriptToOpenAI', () => {
  it('prepends the system prompt', () => {
    const out = transcriptToOpenAI([], 'You are helpful.');
    expect(out[0]).toEqual({ role: 'system', content: 'You are helpful.' });
  });

  it('passes through a plain user string message', () => {
    const out = transcriptToOpenAI([{ role: 'user', content: 'build a calculator' }]);
    expect(out).toEqual([{ role: 'user', content: 'build a calculator' }]);
  });

  it('maps an assistant turn with text + tool_use to content + tool_calls', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Creating the file.' },
          { type: 'tool_use', id: 'tu_1', name: 'write_file', input: { path: 'index.js' } },
        ],
      },
    ];
    const out = transcriptToOpenAI(msgs);
    expect(out).toEqual([
      {
        role: 'assistant',
        content: 'Creating the file.',
        tool_calls: [
          { id: 'tu_1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'index.js' }) } },
        ],
      },
    ]);
  });

  it('maps a user tool_result block to an OpenAI tool message', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'wrote index.js' }] },
    ];
    const out = transcriptToOpenAI(msgs);
    expect(out).toEqual([{ role: 'tool', tool_call_id: 'tu_1', content: 'wrote index.js' }]);
  });

  it('flattens an array tool_result content of text blocks', () => {
    const msgs = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] }] },
    ];
    expect(transcriptToOpenAI(msgs)[0]).toEqual({ role: 'tool', tool_call_id: 'x', content: 'line1\nline2' });
  });

  it('handles a user message mixing tool_result and text', () => {
    const msgs = [
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu_9', content: 'ok' },
        { type: 'text', text: 'now continue' },
      ] },
    ];
    const out = transcriptToOpenAI(msgs);
    expect(out).toEqual([
      { role: 'tool', tool_call_id: 'tu_9', content: 'ok' },
      { role: 'user', content: 'now continue' },
    ]);
  });

  it('emits content:null for an assistant turn that is only tool calls', () => {
    const msgs = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'evaluate', input: {} }] }];
    const out = transcriptToOpenAI(msgs);
    expect(out[0].content).toBeNull();
    expect(out[0].tool_calls).toHaveLength(1);
  });
});

describe('mapFinishReason', () => {
  it('maps OpenAI finish reasons to Anthropic stop reasons', () => {
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
    expect(mapFinishReason('length')).toBe('max_tokens');
    expect(mapFinishReason('stop')).toBe('end_turn');
    expect(mapFinishReason(null)).toBe('end_turn');
  });
});

describe('parseOpenAiCompletion', () => {
  it('parses a plain text completion', () => {
    const r = parseOpenAiCompletion({
      choices: [{ message: { role: 'assistant', content: 'Done!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    expect(r.text).toBe('Done!');
    expect(r.toolUses).toEqual([]);
    expect(r.stopReason).toBe('end_turn');
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect(r.rawContent).toEqual([{ type: 'text', text: 'Done!' }]);
  });

  it('a text-only length stop is truncated (stopReason max_tokens + truncated flag)', () => {
    const r = parseOpenAiCompletion({
      choices: [{ message: { role: 'assistant', content: 'half a thought…' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 100, completion_tokens: 32000 },
    });
    expect(r.stopReason).toBe('max_tokens');
    expect(r.truncated).toBe(true);
  });

  it('UNMASKS a truncation that happened DURING a tool call (the CargoPilot kimi case)', () => {
    // finish_reason 'length' + a tool_call → stopReason is forced to 'tool_use', but `truncated` must
    // still be true so the guard sees the mid-write cutoff instead of being blind to it.
    const r = parseOpenAiCompletion({
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"big.tsx","content":"export const A = () =>' } }] },
        finish_reason: 'length',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 32000 },
    });
    expect(r.stopReason).toBe('tool_use'); // masked, as before (the loop still runs the tool)
    expect(r.truncated).toBe(true);        // …but the truncation is now visible
  });

  it('SALVAGES the file path from a write_file whose content was cut off at the token limit', () => {
    // The exact "Unterminated string in JSON" case: the JSON is sliced mid-content, so it no longer
    // parses — but `path` came first and survived. The salvaged input carries the path and NO content,
    // so the truncation guard can name the lost file and dispatch can only error honestly (never write).
    const r = parseOpenAiCompletion({
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"src/App.tsx","content":"import React from \\"react\\";\\nexport default function App(' } }] },
        finish_reason: 'length',
      }],
      usage: { prompt_tokens: 100, completion_tokens: 64000 },
    });
    expect(r.truncated).toBe(true);
    expect((r.toolUses[0].input as { path?: string }).path).toBe('src/App.tsx');
    expect((r.toolUses[0].input as { content?: string }).content).toBeUndefined(); // partial content never carried through
  });

  it('does NOT salvage a path from malformed args when the turn was NOT truncated (stays {})', () => {
    const r = parseOpenAiCompletion({
      choices: [{
        message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"src/App.tsx","content":"broken' } }] },
        finish_reason: 'tool_calls', // not a length stop → no salvage, preserve prior {} behavior
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    expect(r.toolUses[0].input).toEqual({});
  });

  it('a normal completed tool call is NOT truncated', () => {
    const r = parseOpenAiCompletion({
      choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.ts","content":"export const A = 1;"}' } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
    expect(r.stopReason).toBe('tool_use');
    expect(r.truncated).toBeUndefined();
  });

  it('captures the prefix-cache hit from prompt_tokens_details.cached_tokens (GLM/Kimi)', () => {
    const r = parseOpenAiCompletion({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 4200 } },
    });
    expect(r.usage.inputTokens).toBe(5000); // prompt_tokens includes the cached ones
    expect(r.usage.cacheReadInputTokens).toBe(4200);
  });

  it('falls back to a top-level cached_tokens field', () => {
    const r = parseOpenAiCompletion({
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 800, completion_tokens: 10, cached_tokens: 512 } as any,
    });
    expect(r.usage.cacheReadInputTokens).toBe(512);
  });

  it('parses tool calls into Anthropic-shaped toolUses + rawContent and forces tool_use', () => {
    const r = parseOpenAiCompletion({
      choices: [{
        message: {
          role: 'assistant',
          content: 'Writing files',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.js"}' } },
            { id: 'call_2', type: 'function', function: { name: 'evaluate', arguments: '{}' } },
          ],
        },
        finish_reason: 'tool_calls',
      }],
    });
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolUses).toEqual([
      { id: 'call_1', name: 'write_file', input: { path: 'a.js' } },
      { id: 'call_2', name: 'evaluate', input: {} },
    ]);
    // rawContent stays Anthropic-shaped so the canonical transcript is preserved.
    expect(r.rawContent).toEqual([
      { type: 'text', text: 'Writing files' },
      { type: 'tool_use', id: 'call_1', name: 'write_file', input: { path: 'a.js' } },
      { type: 'tool_use', id: 'call_2', name: 'evaluate', input: {} },
    ]);
  });

  it('tolerates malformed/empty tool-call arguments (returns {})', () => {
    const r = parseOpenAiCompletion({
      choices: [{
        message: { role: 'assistant', content: null, tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'x', arguments: 'not json' } },
          { id: 'c2', type: 'function', function: { name: 'y', arguments: '' } },
        ] },
        finish_reason: 'tool_calls',
      }],
    });
    expect(r.toolUses).toEqual([{ id: 'c1', name: 'x', input: {} }, { id: 'c2', name: 'y', input: {} }]);
  });

  it('defaults usage to zero when absent and handles an empty completion', () => {
    const r = parseOpenAiCompletion({ choices: [] });
    expect(r.text).toBe('');
    expect(r.toolUses).toEqual([]);
    expect(r.usage.inputTokens).toBe(0);
  });
});
