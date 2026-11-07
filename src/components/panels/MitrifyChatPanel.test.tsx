import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../lib/firebase', () => ({ auth: {} }));
vi.mock('../../lib/authHeaders', () => ({ authHeader: vi.fn() }));
import { MitrifyReply } from './MitrifyChatPanel';

describe('Mitrify reply completion display', () => {
  it('renders a long complete answer in full without a warning or clipping classes', () => {
    const text = 'A public explanation. '.repeat(200) + 'Final sentence.';
    const html = renderToStaticMarkup(<MitrifyReply text={text} completion="complete" />);
    expect(html).toContain(text);
    expect(html).not.toContain('role="status"');
    expect(html).not.toMatch(/line-clamp|truncate|max-height/);
  });
  it('keeps the cut reply visible and labels it incomplete', () => {
    const html = renderToStaticMarkup(<MitrifyReply text={'2. **1'} completion="length" />);
    expect(html).toContain('2. **1');
    expect(html).toContain('role="status"');
    expect(html).toContain('reached its length limit and is incomplete');
    expect(html).toContain('no continuation was sent automatically');
  });
  it.each([undefined, null, 'unknown', '<script>untrusted</script>'])('does not assume completion for missing or unknown status %s', completion => {
    const html = renderToStaticMarkup(<MitrifyReply text="Public answer" completion={completion} />);
    expect(html).toContain('did not confirm that this reply completed');
    expect(html).not.toContain('<script>');
  });
  it('explains a content-filter stop without exposing upstream metadata', () => {
    expect(renderToStaticMarkup(<MitrifyReply text="Partial answer" completion="filtered" />)).toContain('stopped by a content filter');
  });
});

describe('explicit continuation review', () => {
  it('shows the exact prompt, accumulated answer and instruction with fresh unchecked confirmation', async () => {
    const { MitrifyContinuationReview } = await import('./MitrifyChatPanel');
    const offer = { available: true as const, ticket: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', instruction: 'Continue without repeating.', roundsRemaining: 2 };
    const html = renderToStaticMarkup(<MitrifyContinuationReview prompt="Original public question" answer={'Part one.\n\nPart two.'} offer={offer} onConfirm={() => { throw new Error('Must not auto-send'); }} onCancel={() => {}} />);
    expect(html).toContain('Original public question'); expect(html).toContain('Part one.\n\nPart two.'); expect(html).toContain(offer.instruction);
    expect(html).toContain('Mitrify and its providers'); expect(html).toContain('may use gateway credits');
    expect(html).toContain('disabled=""'); expect(html).not.toContain('checked=""');
    expect(html).toContain('including the generated answer'); expect(html).toContain('At most 2');
  });
  it('rejects invalid capability data and explains fail-closed bounds', async () => {
    const { continuationOffer, continuationUnavailable } = await import('./MitrifyChatPanel');
    for (const v of [undefined, {}, { available: true }, { available: false, ticket: 'x' }]) expect(continuationOffer(v)).toBeNull();
    expect(continuationUnavailable({ reason: 'context-limit' })).toContain('Nothing was trimmed');
    expect(continuationUnavailable({ reason: 'round-limit' })).toContain('round limit');
    expect(continuationUnavailable({ reason: 'used' })).toContain('will not be replayed');
    expect(continuationUnavailable({ reason: 'funding-unavailable' })).toContain('spending limit');
  });
});
