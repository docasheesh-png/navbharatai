/**
 * A TYPED "STOP" MUST STOP THE BUILD — admin 2026-09-14, from build 70115adf.
 *
 * In that build the user wrote *"मेरा आदेश है कि अभी छोड़ दो, मुझे दूसरा काम करना है"*. The model read
 * it, understood it, and answered *"ठीक है, मैं इस काम को अभी यहीं रोक देता हूँ"* — and the build ran
 * on for 30 more seconds and produced a verdict. `buildAbortCause.ts` had a first-class `user-stop`
 * cause the whole time; it is the Stop BUTTON. The button was wired and the sentence was not.
 *
 * 🔑 THE MODEL IS THE CLASSIFIER, and that is the admin's own instruction ("woh message provider tak
 * bhej kar, build roke"). A local phrase list cannot separate "chhod do" from "ruko, pehle login
 * theek karo" — one word apart, and stopping on the second destroys work somebody is waiting for. So
 * these tests do NOT test a matcher. They test that the model's decision can reach the build, that it
 * lands on the same `user-stop` path the button uses, and that an unwired dispatcher can never
 * pretend it stopped.
 */
import { describe, it, expect, vi } from 'vitest';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { abortBuild, abortCauseOf, abortSummary, isUserInitiated } from '../src/server/AgentV3/buildAbortCause';

function tools(): Array<{ name: string; description: string; input_schema?: unknown }> {
  return defaultToolCatalog() as never;
}

describe('the tool exists and its description IS the precision rule', () => {
  const tool = () => tools().find((t) => t.name === 'stop_build');

  it('is offered to the model at all', () => {
    expect(tool()).toBeTruthy();
  });

  it('names stop words in the languages a real user types', () => {
    const d = tool()!.description;
    for (const phrase of ['stop', 'cancel', 'rehne do', 'chhod do', 'band karo']) {
      expect(d.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it('🔴 and names the NEAR-MISSES it must refuse — the whole risk of this feature', () => {
    const d = tool()!.description.toLowerCase();
    // Impatience is not a cancel. This user sent one of these FIRST ("itni der?") and the build
    // rightly continued; only the second message was an order.
    expect(d).toContain('itni der');
    // A steer is not a cancel, and this is the pair that makes a phrase list impossible.
    expect(d).toContain('ruko, pehle login theek karo');
    // Stopping one PART is not stopping the build.
    expect(d).toMatch(/ye feature mat banao|skip the tests/);
    // And the honest default when unsure.
    expect(d).toMatch(/not certain|do not call this/);
  });

  it('asks for the user\'s own words, so the build record can be audited', () => {
    const schema = tool()!.input_schema as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties ?? {})).toContain('reason');
    expect(schema.required).toContain('reason');
  });
});

describe('the decision reaches the build', () => {
  function dispatcher(): ToolDispatcher {
    return new ToolDispatcher({} as never, 'w1');
  }

  const call = (input: Record<string, unknown>) => ({ id: 'tu1', name: 'stop_build', input });
  const text = (r: unknown): string =>
    typeof r === 'string' ? r : String((r as { content?: unknown })?.content ?? JSON.stringify(r));

  it('calls the wired stop, and passes the user\'s words through', async () => {
    const d = dispatcher();
    const stop = vi.fn();
    d.setStopBuild(stop);
    const out = text(await d.dispatch(call({ reason: 'मेरा आदेश है कि अभी छोड़ दो' })));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.calls[0][0]).toContain('छोड़ दो');
    expect(out).toMatch(/Stopping this build now/);
    expect(out).toMatch(/saved/i);
  });

  it('🔒 an UNWIRED dispatcher says so — it must never report a stop that did not happen', async () => {
    const d = dispatcher();
    const out = text(await d.dispatch(call({ reason: 'stop' })));
    expect(out).toMatch(/Could not stop/i);
    expect(out).not.toMatch(/Stopping this build now/);
  });

  it('a missing reason still stops — the record is secondary to the user\'s wish', async () => {
    const d = dispatcher();
    const stop = vi.fn();
    d.setStopBuild(stop);
    await d.dispatch(call({}));
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

describe('it lands on the SAME path the Stop button uses', () => {
  it('aborts with cause user-stop, which everything downstream already understands', () => {
    let reason: unknown;
    abortBuild({ abort: (r?: unknown) => { reason = r; } }, 'user-stop');
    const cause = abortCauseOf({ reason });
    expect(cause).toBe('user-stop');
    // The report must file it under the user, not under a platform failure.
    expect(isUserInitiated(cause)).toBe(true);
    // And the person is told what survived.
    expect(abortSummary(cause, { builtSomething: true })).toMatch(/saved/i);
  });
});
