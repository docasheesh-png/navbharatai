import { describe, it, expect } from 'vitest';
import { botFlowToBuildPrompt, type BotFlowNode, type BotFlowEdge } from '../src/lib/botFlowPrompt';

/**
 * Bot Builder → real build handoff (admin autopsy 2026-07-20): the designer previously ended at a
 * JSON export and never built anything. These tests lock the pure flow→prompt conversion that
 * powers the "Build Bot App" handoff to Pro v5.0.
 */

const nodes: BotFlowNode[] = [
  { id: 'n1', type: 'start', data: { text: 'Start' } },
  { id: 'n2', type: 'menu', data: { text: 'Choose:', options: ['Track Order', 'Support'] } },
  { id: 'n3', type: 'api', data: { apiUrl: 'https://api.example.com/track', method: 'get', responseVar: 'order' } },
  { id: 'n4', type: 'condition', data: { condition: 'order.status == "shipped"' } },
  { id: 'n5', type: 'end', data: { text: 'Bye!' } },
];
const edges: BotFlowEdge[] = [
  { id: 'e1', from: 'n1', to: 'n2' },
  { id: 'e2', from: 'n2', to: 'n3', label: 'Track Order' },
  { id: 'e3', from: 'n3', to: 'n4' },
  { id: 'e4', from: 'n4', to: 'n5' },
];

describe('botFlowToBuildPrompt', () => {
  it('describes every node, transition, and the platform styling', () => {
    const p = botFlowToBuildPrompt(nodes, edges, 'whatsapp');
    expect(p).toContain('chatbot web app');
    expect(p).toContain('WhatsApp style');
    expect(p).toContain('"Track Order", "Support"');
    expect(p).toContain('GET https://api.example.com/track');
    expect(p).toContain('storing the response as "order"');
    expect(p).toContain('order.status == "shipped"');
    expect(p).toContain('n2 -> n3 (when the user picks "Track Order")');
    expect(p).toContain('Restart conversation');
  });

  it('platform variants change the theme honestly', () => {
    expect(botFlowToBuildPrompt(nodes, edges, 'telegram')).toContain('Telegram-inspired blue');
    expect(botFlowToBuildPrompt(nodes, edges, 'both')).toContain('theme switcher');
  });

  it('is deterministic — same design, same prompt', () => {
    expect(botFlowToBuildPrompt(nodes, edges, 'whatsapp')).toBe(botFlowToBuildPrompt(nodes, edges, 'whatsapp'));
  });

  it('bounds runaway node text', () => {
    const big: BotFlowNode[] = [{ id: 'n1', type: 'message', data: { text: 'x'.repeat(5000) } }];
    const p = botFlowToBuildPrompt(big, [], 'whatsapp');
    expect(p.length).toBeLessThan(1500);
  });
});
