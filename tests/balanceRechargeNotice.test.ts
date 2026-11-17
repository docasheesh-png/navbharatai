import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BALANCE_RECHARGE_EN, BALANCE_RECHARGE_HI, balanceRechargeNotice } from '../src/server/AgentV3/balanceRechargeNotice';
import { decideAffordability } from '../src/server/AgentV3/Affordability';

describe('balance recharge notice (owner t402u)', () => {
  it('uses the Hindi sentence when the request is Hindi', () => {
    expect(balanceRechargeNotice('मुझे एक टू-डू ऐप बनाओ')).toBe(BALANCE_RECHARGE_HI);
    expect(BALANCE_RECHARGE_HI).toBe('इस build के लिए आपका balance पर्याप्त नहीं है, कृपया recharge करें!');
  });

  it('uses the English sentence for English, Roman Hinglish, and an empty request', () => {
    expect(balanceRechargeNotice('Make my own subway surfer game')).toBe(BALANCE_RECHARGE_EN);
    expect(balanceRechargeNotice('mujhe ek app banao')).toBe(BALANCE_RECHARGE_EN);
    expect(balanceRechargeNotice('')).toBe(BALANCE_RECHARGE_EN);
    expect(BALANCE_RECHARGE_EN).toBe('Your balance is not enough for this build, please recharge!');
  });

  it('the pre-start refusal uses that sentence and does not move the affordability rules', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('error: balanceRechargeNotice(prompt)');
    expect(decideAffordability({ isFreeUser: false, balance: 0, estimate: 10 }).action).toBe('block');
    expect(decideAffordability({ isFreeUser: false, balance: 5, estimate: 10 }).action).toBe('economy');
    expect(decideAffordability({ isFreeUser: true, balance: 0, estimate: 10 }).action).toBe('proceed');
  });

  it('the recharge button is English and the Hindi sentence stays on the server', () => {
    const panel = readFileSync('src/components/agentv3/AgentV3Panel.tsx', 'utf8');
    expect(panel).toContain('Recharge');
    expect(panel).not.toMatch(/[\u0900-\u097F]/);
  });
});
