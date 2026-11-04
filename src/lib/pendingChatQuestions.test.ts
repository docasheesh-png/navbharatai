import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { PendingChatQuestions } from './pendingChatQuestions';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('bounds three pending short questions and preserves FIFO',()=>{
 const queue=new PendingChatQuestions();for(const text of ['one','two','three'])expect(queue.enqueue('scope',text)).toBe(true);
 expect(queue.enqueue('scope','four')).toBe(false);expect(queue.take('scope')).toBe('one');expect(queue.take('scope')).toBe('two');expect(queue.take('scope')).toBe('three');expect(vi.getTimerCount()).toBe(0);
 expect(queue.enqueue('scope','x'.repeat(16001))).toBe(false);expect(queue.enqueue('scope',' ')).toBe(false);
});
it('expires pending work and clears it on scope change or stop',async()=>{
 const queue=new PendingChatQuestions();queue.enqueue('account1/session1','one');expect(queue.take('account2/session2')).toBeUndefined();expect(queue.size).toBe(0);
 queue.enqueue('scope','two');await vi.advanceTimersByTimeAsync(90000);expect(queue.take('scope')).toBeUndefined();
 queue.enqueue('scope','three');queue.clear();expect(queue.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
});
it('checks elapsed expiry even before throttled timer callbacks run',()=>{
 const queue=new PendingChatQuestions();queue.enqueue('scope','expired');vi.setSystemTime(Date.now()+90001);expect(queue.take('scope')).toBeUndefined();expect(vi.getTimerCount()).toBe(0);
});
