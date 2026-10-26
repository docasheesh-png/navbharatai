import { describe, expect, it, vi } from 'vitest';
import { mockRes } from './helpers/routeTestUtils';

describe('route response terminal payload contract', () => {
  it('writes the final SSE frame through the installed writer before finish and callback', () => {
    const res = mockRes(); const events: string[] = [];
    res.write = chunk => { events.push(String(chunk)); return true; };
    res.on('finish', () => events.push('finish'));
    res.on('close', () => events.push('close'));
    expect(res.end('data: [DONE]\n\n', 'utf8', () => events.push('callback'))).toBe(res);
    expect(events).toEqual(['data: [DONE]\n\n', 'finish', 'callback', 'close']);
    expect(res.ended).toBe(true); expect(res.writableFinished).toBe(true);
  });

  it('preserves binary end(payload, callback) without inventing another write', () => {
    const res = mockRes(); const chunk = Buffer.from('terminal bytes'); const done = vi.fn();
    res.write = vi.fn(() => true);
    res.end(chunk, done);
    expect(res.write).toHaveBeenCalledExactlyOnceWith(chunk, undefined);
    expect(done).toHaveBeenCalledOnce();
  });

  it('does not mistake end(callback) for a payload', () => {
    const res = mockRes(); const done = vi.fn(); res.write = vi.fn(() => true);
    res.end(done);
    expect(res.write).not.toHaveBeenCalled(); expect(done).toHaveBeenCalledOnce();
    expect(res.ended).toBe(true);
  });

  it('captures a terminal payload even when the fixture did not install a stream writer', () => {
    const res = mockRes();
    res.end('terminal body');
    expect(res.sent).toBe('terminal body'); expect(res.body).toBe('terminal body');
  });
});
