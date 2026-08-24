import { describe, it, expect } from 'vitest';
import { architectSystemPrompt } from '../src/server/AgentV3/systemPrompt';
import { LISTENING_PORTS_COMMAND, parseListeningPorts } from '../src/server/AgentV3/PortDiscovery';

/**
 * THE DEFECT (admin build reports, 2026-08): a build spent seven minutes rebuilding around a fact it
 * had never checked. The preview had not come up, so the model went port-hunting and ran
 *
 *     lsof -i:3000 || echo "Port 3000 is free"
 *
 * and reasoned from the echo. That line prints its confident sentence in three different worlds — the
 * port is free, the tool is missing, the command errored — and they are indistinguishable in the
 * output. The same bug class as every other one this month: an ARTIFACT standing in for the thing it
 * was supposed to prove.
 *
 * The 50/50 half is why the prompt attacks the SHAPE rather than the tool. "lsof is not installed" is
 * a claim about an image that changes, so a prompt asserting it would go stale and be wrong later;
 * `<check> || echo "<conclusion>"` is unsound whether or not the tool exists.
 */
const prompt = () => architectSystemPrompt('vite-react');

describe('the build prompt refuses to let a failed check become a fact', () => {
  it('names the exact unsound shape, not just "be careful"', () => {
    const p = prompt();
    expect(p).toContain('NEVER TURN A FAILED CHECK INTO A FACT');
    expect(p).toContain('|| echo "<conclusion>"');
  });

  it('hands over an instrument instead of only forbidding the bad one', () => {
    // A prohibition with no replacement just makes the model invent a different unsound check. The
    // command given works with no extra tools, which is the property that makes it safe to promise.
    expect(prompt()).toContain(LISTENING_PORTS_COMMAND);
  });

  it('the promised command is the platform\'s own, not a retyped copy', () => {
    // Retyping would let the two drift silently — the prompt teaching one thing while discovery does
    // another. Asserted by identity: the prompt embeds the exported constant.
    expect(LISTENING_PORTS_COMMAND).toContain('/proc/net/tcp');
    expect(LISTENING_PORTS_COMMAND).not.toMatch(/\blsof\b|\bnetstat\b|\bss -/);
  });

  it('the output shape the prompt promises is the one the parser actually reads', () => {
    // The prompt tells the model to expect `LISTENING:3000,5432`. If that ever stopped being what the
    // command emits, the model would be taught to read a format nothing produces.
    expect(prompt()).toContain('LISTENING:3000,5432');
    expect(parseListeningPorts('LISTENING:3000,5432')).toEqual([3000, 5432]);
  });

  it('points at the two answers it already has before any investigation', () => {
    // The cheapest fix for a costly detour is not a better instrument — it is not needing one.
    const p = prompt();
    expect(p).toContain('[health-check] dev server is UP on port N');
    expect(p).toContain('port-hunting when the answer was already given');
  });
});
