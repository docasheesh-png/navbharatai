import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { nextUserMessageTs } from '../src/components/agentv3/conversationClock';
import { withoutStaleLiveStatus } from '../src/lib/liveStatusLine';

const source = readFileSync(resolve(__dirname, '../src/components/ide/AgentV3MiniChat.tsx'), 'utf8');
const sendBody = source.slice(source.indexOf('  const send = () => {'), source.indexOf('\n  const convo:', source.indexOf('  const send = () => {')));

describe('Code Studio Pro uses the same submission boundary', () => {
  it('preserves prior replies and blocks same-render duplicate prompt inserts', () => {
    let users = [{ role: 'user', text: 'Earlier prompt', ts: 100 }];
    let history: any[] = [];
    let input = 'Next prompt';
    let busy = false;
    const start = vi.fn(() => { busy = true; });
    const bindings = {
      input, running: false, isBusy: () => busy, userId: 'owner', email: undefined, sessionId: 'session123',
      userMsgs: users, agentHistory: history, state: { narration: [{ agent: 'architect', text: 'Earlier answer', ts: Date.now() + 100_000 }], activity: [], activityLog: [] },
      nextUserMessageTs, withoutStaleLiveStatus,
      setAgentHistory: (update: any) => { history = update(history); },
      setUserMsgs: (update: any) => { users = update(users); },
      setInput: (value: string) => { input = value; }, start,
    };
    const code = transformSync(`${sendBody}\nreturn send;`, { loader: 'ts', target: 'es2022' }).code;
    const send = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
    send(); send();
    expect(start).toHaveBeenCalledOnce();
    expect(users).toHaveLength(2);
    expect(history).toHaveLength(1);
    expect(users[1].ts).toBeGreaterThan(history[0].ts);
    expect(start.mock.calls[0][1].userMessageTs).toBe(users[1].ts);
    expect(input).toBe('');
  });
});
