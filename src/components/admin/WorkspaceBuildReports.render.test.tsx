import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceBuildReports, WorkspaceReportsView, type WorkspaceReportsAnswer } from './WorkspaceBuildReports';

const noop = () => {};
const render = (answer: WorkspaceReportsAnswer) =>
  renderToStaticMarkup(<WorkspaceReportsView answer={answer} workspaceId="agentv3-u1-w1" onCopy={noop} onDownload={noop} onRetry={noop} />);

describe('the "v" panel for one app', () => {
  it('first paint is a loading line, never an empty list or a count it has not read', () => {
    const html = renderToStaticMarkup(<WorkspaceBuildReports workspaceId="agentv3-u1-w1" headers={{}} onCopy={noop} onDownload={noop} />);
    expect(html).toContain("Loading this app&#x27;s builds");
    expect(html).not.toContain('Full session');
    expect(html).not.toContain('earlier build');
  });

  it('found: the headline in the engine\'s words, the whole-session buttons, and one row per build, numbered from the first', () => {
    const html = render({
      kind: 'found',
      latest: { ok: false, summary: 'Your app is built, but 1 thing is still broken.', rootCause: 'The release gate was RED.', startedAt: 1_700_000_000_000 },
      history: [{ id: 'h3', ok: false, prompt: 'third' }, { id: 'h2', ok: true, prompt: 'second' }, { id: 'h1', ok: true, prompt: 'first' }],
    });
    expect(html).toContain('Did not succeed');
    expect(html).toContain('Your app is built, but 1 thing is still broken.');
    expect(html).toContain('Root cause: The release gate was RED.');
    expect(html).toContain('Copy session');
    expect(html).toContain('Full session');
    expect(html).toContain('3 earlier builds on file');
    // newest first on screen, but numbered in build order: the top row is the 3rd build
    expect(html.indexOf('3rd')).toBeLessThan(html.indexOf('2nd'));
    expect(html.indexOf('2nd')).toBeLessThan(html.indexOf('1st'));
    expect((html.match(/This build/g) || []).length).toBe(3);
  });

  it('a field the record does not hold says so — never a blank that reads as "fine"', () => {
    const html = render({ kind: 'found', latest: null, history: [] });
    expect(html).toContain('Outcome not recorded');
    expect(html).toContain('No summary was recorded for this build.');
    expect(html).toContain('Only the latest report exists for this app');
  });

  it('none: says there is no report on file', () => {
    expect(render({ kind: 'none' })).toContain('No build report was recorded for this app');
  });

  it('error: shows the reason and a Try again button, never an empty list', () => {
    const html = render({ kind: 'error', message: 'The server answered 500.' });
    expect(html).toContain('Could not load this app&#x27;s reports. The server answered 500.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Full session');
  });
});
