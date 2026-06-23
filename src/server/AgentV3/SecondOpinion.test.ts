import { describe, it, expect } from 'vitest';
import { makeSecondOpinion, type OpinionRouter } from './SecondOpinion';

/** A fake router that returns a fixed review (the happy path). */
class FakeRouter implements OpinionRouter {
  constructor(private readonly content: string, private readonly provider: string) {}
  async route(_prompt: string, _system?: string) {
    return { response: { content: this.content, provider: this.provider } };
  }
}

/** A fake router that always fails — to prove the tool never throws. */
class ThrowingRouter implements OpinionRouter {
  async route(): Promise<{ response: { content: string; provider: string } }> {
    throw new Error('all providers down');
  }
}

describe('makeSecondOpinion', () => {
  it('returns the provider and the critique content', async () => {
    const opinion = makeSecondOpinion(new FakeRouter('Looks correct, but check the null case.', 'GEMINI'));
    const result = await opinion('review this function');
    expect(result).toContain('GEMINI');
    expect(result).toContain('Looks correct, but check the null case.');
  });

  it('does not throw when the router fails — returns an unavailable message', async () => {
    const opinion = makeSecondOpinion(new ThrowingRouter());
    const result = await opinion('review this');
    expect(result).toContain('Second opinion unavailable');
    expect(result).toContain('all providers down');
  });
});
