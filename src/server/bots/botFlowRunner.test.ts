import { describe, it, expect } from 'vitest';
import { runBotTurn, evalCondition, pickEdge, type BotFlow, type BotSession } from './botFlowRunner';

const FLOW: BotFlow = {
  platform: 'telegram',
  nodes: [
    { id: 'n1', type: 'start', data: {} },
    { id: 'n2', type: 'message', data: { text: 'Welcome!' } },
    { id: 'n3', type: 'menu', data: { text: 'Choose:', options: ['Track Order', 'Support'] } },
    { id: 'n4', type: 'message', data: { text: 'Your order ships in 2 days.' } },
    { id: 'n5', type: 'message', data: { text: 'Connecting to support…' } },
    { id: 'n6', type: 'end', data: { text: 'Bye!' } },
  ],
  edges: [
    { id: 'e1', from: 'n1', to: 'n2' },
    { id: 'e2', from: 'n2', to: 'n3' },
    { id: 'e3', from: 'n3', to: 'n4', label: 'Track Order' },
    { id: 'e4', from: 'n3', to: 'n5', label: 'Support' },
    { id: 'e5', from: 'n4', to: 'n6' },
    { id: 'e6', from: 'n5', to: 'n6' },
  ],
};

const fresh = (): BotSession => ({ nodeId: null, vars: {} });

describe('runBotTurn — a real conversation', () => {
  it('first turn: START → Welcome → menu with buttons, then awaits input', async () => {
    const r = await runBotTurn(FLOW, fresh(), '');
    expect(r.replies.map(x => x.text)).toEqual(['Welcome!', 'Choose:']);
    expect(r.replies[1].buttons).toEqual(['Track Order', 'Support']); // edge labels drive the quick replies
    expect(r.ended).toBe(false);
    expect(r.session.nodeId).toBe('n3'); // awaiting the menu choice
  });

  it('picks the branch by the tapped button and reaches END', async () => {
    const afterMenu = await runBotTurn(FLOW, fresh(), '');
    const r = await runBotTurn(FLOW, afterMenu.session, 'Track Order');
    expect(r.replies.map(x => x.text)).toEqual(['Your order ships in 2 days.', 'Bye!']);
    expect(r.ended).toBe(true);
    expect(r.session.nodeId).toBeNull();
  });

  it('matches a button case-insensitively / by partial text', async () => {
    const afterMenu = await runBotTurn(FLOW, fresh(), '');
    const r = await runBotTurn(FLOW, afterMenu.session, 'support');
    expect(r.replies.map(x => x.text)).toContain('Connecting to support…');
    expect(r.ended).toBe(true);
  });

  it('unknown input falls back to the first branch (never dead-ends)', async () => {
    const afterMenu = await runBotTurn(FLOW, fresh(), '');
    const r = await runBotTurn(FLOW, afterMenu.session, 'blah blah');
    expect(r.ended).toBe(true);
    expect(r.replies.length).toBeGreaterThan(0);
  });
});

describe('a MESSAGE node with buttons (admin 2026-07-23)', () => {
  const BFLOW: BotFlow = {
    nodes: [
      { id: 's', type: 'start', data: {} },
      { id: 'm', type: 'message', data: { text: 'Namaste! How can I help?', options: ['Appointment', 'Services'] } },
      { id: 'a', type: 'end', data: { text: 'Booking your appointment…' } },
      { id: 'b', type: 'end', data: { text: 'Here are our services…' } },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'm' },
      { id: 'e2', from: 'm', to: 'a', label: 'Appointment' },
      { id: 'e3', from: 'm', to: 'b', label: 'Services' },
    ],
  };

  it('shows the message with its buttons and awaits the tap', async () => {
    const r = await runBotTurn(BFLOW, { nodeId: null, vars: {} }, '');
    expect(r.replies[0].text).toBe('Namaste! How can I help?');
    expect(r.replies[0].buttons).toEqual(['Appointment', 'Services']);
    expect(r.ended).toBe(false);
    expect(r.session.nodeId).toBe('m');
  });

  it('routes on the tapped button', async () => {
    const after = await runBotTurn(BFLOW, { nodeId: null, vars: {} }, '');
    const r = await runBotTurn(BFLOW, after.session, 'Appointment');
    expect(r.replies.map(x => x.text)).toContain('Booking your appointment…');
    expect(r.ended).toBe(true);
  });

  it('a Message WITHOUT buttons still just flows to the next node', async () => {
    const plain: BotFlow = {
      nodes: [{ id: 's', type: 'start', data: {} }, { id: 'm', type: 'message', data: { text: 'hi' } }, { id: 'e', type: 'end', data: { text: 'bye' } }],
      edges: [{ id: 'e1', from: 's', to: 'm' }, { id: 'e2', from: 'm', to: 'e' }],
    };
    const r = await runBotTurn(plain, { nodeId: null, vars: {} }, '');
    expect(r.replies.map(x => x.text)).toEqual(['hi', 'bye']);
    expect(r.ended).toBe(true);
  });
});

describe('CONDITION + API nodes run for real', () => {
  const CFLOW: BotFlow = {
    nodes: [
      { id: 's', type: 'start', data: {} },
      { id: 'ask', type: 'menu', data: { text: 'Yes or No?', options: ['yes', 'no'] } },
      { id: 'cond', type: 'condition', data: { condition: 'input == "yes"' } },
      { id: 'y', type: 'end', data: { text: 'You said yes' } },
      { id: 'n', type: 'end', data: { text: 'You said no' } },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'ask' },
      { id: 'e2', from: 'ask', to: 'cond' },
      { id: 'e3', from: 'cond', to: 'y', label: 'true' },
      { id: 'e4', from: 'cond', to: 'n', label: 'false' },
    ],
  };

  it('routes a condition on the user input', async () => {
    const after = await runBotTurn(CFLOW, { nodeId: null, vars: {} }, '');
    expect(after.session.nodeId).toBe('ask');
    const yes = await runBotTurn(CFLOW, after.session, 'yes');
    expect(yes.replies.map(x => x.text)).toContain('You said yes');
    const after2 = await runBotTurn(CFLOW, { nodeId: null, vars: {} }, '');
    const no = await runBotTurn(CFLOW, after2.session, 'no');
    expect(no.replies.map(x => x.text)).toContain('You said no');
  });

  it('an API node actually fetches and stores the response', async () => {
    const AFLOW: BotFlow = {
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'api', type: 'api', data: { apiUrl: 'https://api.example.com/x', method: 'GET', responseVar: 'result' } },
        { id: 'end', type: 'end', data: { text: 'done' } },
      ],
      edges: [{ id: 'e1', from: 's', to: 'api' }, { id: 'e2', from: 'api', to: 'end' }],
    };
    let called = '';
    const fetchImpl = async (url: string) => { called = url; return { ok: true, status: 200, text: async () => '{"ok":1}' }; };
    const r = await runBotTurn(AFLOW, { nodeId: null, vars: {} }, '', fetchImpl);
    expect(called).toBe('https://api.example.com/x');
    expect(r.session.vars.result).toBe('{"ok":1}');
    expect(r.ended).toBe(true);
  });

  it('an API failure degrades gracefully (honest message, continues)', async () => {
    const AFLOW: BotFlow = {
      nodes: [
        { id: 's', type: 'start', data: {} },
        { id: 'api', type: 'api', data: { apiUrl: 'https://x', responseVar: 'r' } },
        { id: 'end', type: 'end', data: { text: 'done' } },
      ],
      edges: [{ id: 'e1', from: 's', to: 'api' }, { id: 'e2', from: 'api', to: 'end' }],
    };
    const fetchImpl = async () => { throw new Error('network'); };
    const r = await runBotTurn(AFLOW, { nodeId: null, vars: {} }, '', fetchImpl);
    expect(r.replies.some(x => /couldn't reach/i.test(x.text))).toBe(true);
    expect(r.replies.map(x => x.text)).toContain('done');
  });
});

describe('evalCondition + pickEdge units', () => {
  it('evalCondition supports ==, !=, contains', () => {
    expect(evalCondition('input == "yes"', 'YES')).toBe(true);
    expect(evalCondition('input != "yes"', 'no')).toBe(true);
    expect(evalCondition('input contains "order"', 'track my order')).toBe(true);
    expect(evalCondition('garbage', 'x')).toBe(true); // unparseable → first branch
  });

  it('a mis-wired node with no edges never throws', async () => {
    const bad: BotFlow = { nodes: [{ id: 's', type: 'start', data: {} }], edges: [] };
    const r = await runBotTurn(bad, { nodeId: null, vars: {} }, '');
    expect(r.ended).toBe(true);
    expect(pickEdge(bad, bad.nodes[0], '')).toBeNull();
  });
});
