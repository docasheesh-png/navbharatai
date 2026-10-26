import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { confirmedFreeAnswerSettlement, FREE_ANSWER_SETTLEMENT_MS, stageFreeAnswerCompletion } from './freeAnswerCompletion';

function response() {
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, writableEnded: false, writableFinished: false, headersSent: false,
    status: vi.fn(), json: vi.fn(), removeHeader: vi.fn(), write: vi.fn<(...args: unknown[]) => boolean>(() => true),
    end: vi.fn(function (this: unknown, ...args: unknown[]) {
      const callback = args.at(-1);
      if (typeof callback === 'function') callback();
      return this;
    }),
  });
  res.status.mockReturnValue(res);
  return res;
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('admitted Free answer terminal publication', () => {
  it.each(['body-only', 'callback-only', 'body-callback', 'body-encoding-callback'] as const)('preserves native end overload %s, binding and callback exactly once', kind => {
    const res = response(); const end = res.end; const callback = vi.fn();
    const barrier = stageFreeAnswerCompletion(res as unknown as Response);
    const args = kind === 'body-only' ? ['body'] : kind === 'callback-only' ? [callback] : kind === 'body-callback' ? ['body', callback] : ['body', 'utf8', callback];
    expect(res.end(...args)).toBe(res);
    expect(res.writableEnded).toBe(true); expect(res.writableFinished).toBe(false);
    expect(end).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    barrier.publish(); barrier.publish(); barrier.restore();
    expect(end).toHaveBeenCalledExactlyOnceWith(...args);
    expect(end.mock.contexts[0]).toBe(res);
    expect(callback).toHaveBeenCalledTimes(kind === 'body-only' ? 0 : 1);
    expect(res.end).toBe(end); expect(res.writableEnded).toBe(false);
  });
  it('streams content before end, snapshots mutable terminal bytes, and rejects late writes without replacing first terminal', async () => {
    const res = response(); const end = res.end; const write = res.write;
    const barrier = stageFreeAnswerCompletion(res as unknown as Response);
    expect(res.write('chunk')).toBe(true);
    const bytes = Buffer.from('done');
    res.end(bytes); bytes.fill(120);
    const lateCallback = vi.fn();
    expect(res.write('late', lateCallback)).toBe(false);
    res.end('replacement');
    await Promise.resolve();
    expect(lateCallback).toHaveBeenCalledWith(expect.any(Error));
    barrier.publish();
    expect(write).toHaveBeenCalledExactlyOnceWith('chunk');
    expect(end).toHaveBeenCalledExactlyOnceWith(Buffer.from('done'));
  });
  it('replaces staged JSON on unconfirmed settlement and clears stale length/etag', () => {
    const res = response(); const end = res.end; const barrier = stageFreeAnswerCompletion(res as unknown as Response);
    res.end('{"reply":"must not publish"}'); barrier.fail(false); barrier.publish();
    expect(end).not.toHaveBeenCalled();
    expect(res.removeHeader).toHaveBeenCalledWith('Content-Length'); expect(res.removeHeader).toHaveBeenCalledWith('ETag');
    expect(res.status).toHaveBeenCalledWith(503); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FREE_ANSWER_UNAVAILABLE' }));
  });
  it('replaces staged DONE with one honest partial error after stream output', () => {
    const res = response(); res.headersSent = true; const end = res.end;
    const barrier = stageFreeAnswerCompletion(res as unknown as Response);
    res.write('data: {"c":"partial"}\n\n'); res.end('data: [DONE]\n\n'); barrier.fail(true); barrier.publish();
    expect(end).toHaveBeenCalledOnce(); expect(end.mock.calls[0][0]).toContain('"partial":true');
    expect(end.mock.calls[0][0]).not.toContain('[DONE]');
  });
  it('never publishes a staged answer after a disconnected client and restores methods', () => {
    const res = response(); const end = res.end; const write = res.write;
    const barrier = stageFreeAnswerCompletion(res as unknown as Response);
    res.end('staged'); res.destroyed = true; barrier.publish();
    expect(end).not.toHaveBeenCalled(); expect(res.end).toBe(end); expect(res.write).toBe(write);
  });
});
describe('bounded durable settlement observation', () => {
  it.each([true, false])('preserves transaction confirmation %s', async result => {
    expect(await confirmedFreeAnswerSettlement(Promise.resolve(result))).toBe(result);
  });
  it('fails closed on rejection', async () => {
    expect(await confirmedFreeAnswerSettlement(Promise.reject(new Error('storage unavailable')))).toBe(false);
  });
  it('bounds a hung transaction and ignores late success without leaking a timer', async () => {
    vi.useFakeTimers(); let resolve!: (ok: boolean) => void;
    const pending = confirmedFreeAnswerSettlement(new Promise<boolean>(done => { resolve = done; }));
    await vi.advanceTimersByTimeAsync(FREE_ANSWER_SETTLEMENT_MS);
    expect(await pending).toBe(false); expect(vi.getTimerCount()).toBe(0);
    resolve(true); await Promise.resolve(); expect(await pending).toBe(false);
  });
});

it('keeps every Chat terminal in end(), including nested entry rejection and newly added siblings', () => {
  for (const path of ['../routes/chat.ts', '../AI/FreeChain/entryAdmission.ts']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const violations: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(file) === 'res.write'
        && /\[DONE\]|\berror\s*:|\bcode\s*:/.test(node.arguments.map(arg => arg.getText(file)).join(' '))) {
        violations.push(node.getText(file));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(violations, `${path}: client-terminal frames must wait for durable completion`).toEqual([]);
  }
  const wrapper = readFileSync(new URL('./freeAnswerQuota.ts', import.meta.url), 'utf8');
  expect(wrapper.slice(wrapper.indexOf('async function runWalletPaidTurn'))).not.toContain('stageFreeAnswerCompletion');
});
