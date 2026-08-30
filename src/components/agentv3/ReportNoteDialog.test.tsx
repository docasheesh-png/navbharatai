// "What went wrong?" — the user's own words attached to a build report.
//
// CLIENT half — the dialog itself. The sanitiser, the stored record and the wiring assertions live
// in tests/reportUserNote.test.ts, which may import server code without breaking the frontend
// typecheck (src/server is excluded from it).
//
// Admin 2026-08-28: pressing Report used to submit the diagnostics alone, so the admin received a
// complete technical record of a build and no statement of what the person thought was wrong with it.
// Those are different facts: the engine's verdict answers the engine's own question, and only the user
// can say the button does nothing or it built the wrong app — the failures every automated check
// passes straight over.

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportNoteDialog, REPORT_NOTE_MAX } from './ReportNoteDialog';



describe('the dialog', () => {
  const html = renderToStaticMarkup(
    <ReportNoteDialog sending={false} onCancel={() => {}} onSend={() => {}} buildLabel="a shop app" />,
  );

  it('is a real dialog with a text box, showing which build it is about', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('<textarea');
    expect(html).toContain('What went wrong?');
    expect(html).toContain('a shop app');
  });

  it('caps the input where the server caps it, so the limit is visible while typing', () => {
    // React's server renderer preserves the camelCase attribute name; matching lowercase here would
    // have failed against a perfectly correct component.
    expect(html).toContain('maxLength="' + REPORT_NOTE_MAX + '"');
  });

  it('lets the user send without typing anything', () => {
    // Send must never be disabled on an empty box — see the note above about forced full stops.
    const sendIdx = html.indexOf('Send report');
    const before = html.slice(Math.max(0, sendIdx - 400), sendIdx);
    expect(before).not.toContain('disabled=""');
  });

  it('tells the user the build details are already attached', () => {
    // Otherwise they try to describe technical detail they cannot see, instead of what they observed.
    expect(html).toContain('attached automatically');
  });
});

