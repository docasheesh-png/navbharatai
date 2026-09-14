import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ReportInfoButton } from './ReportInfoButton';
import { ReportFilterBar } from './ReportFilterBar';
import { submittedRowFacts, allBuildRowFacts } from '../../lib/reportRowFacts';
import { EMPTY_FILTERS } from '../../lib/reportListFilter';

/**
 * ADMIN 2026-09-14 — the two build-report lists must look and filter the same, with the detail behind
 * one ⓘ button. The page capture that prompted it measured the failure: the inbox's nine-column table
 * ran 513 px past the right edge of a 393 px phone.
 */

const NOW = Date.parse('2026-09-14T12:00:00Z');

describe('the ⓘ button carries every field the admin listed', () => {
  const facts = submittedRowFacts({
    name: 'Lok Up', email: 'lokup528@gmail.com', userId: 'u1', reportedAt: NOW - 60_000,
    userTier: 'free', tier: 'free', billedInr: 12.5, billedUsd: 0.14, ok: false, buildMs: 90_000,
    workspaceId: 'agentv3-x',
  }, NOW);
  const html = renderToStaticMarkup(<ReportInfoButton facts={facts} />);

  it('is collapsed by default — the row stays clean until it is asked', () => {
    expect(html).not.toContain('lokup528@gmail.com');
    expect(html).toContain('aria-expanded="false"');
  });

  it('names what it holds, so the admin knows what the button is for', () => {
    expect(html).toMatch(/Sender, email, time, user type, charge and status/);
  });

  it('an empty fact list still renders (a legacy row must not crash the list)', () => {
    expect(() => renderToStaticMarkup(<ReportInfoButton facts={[]} />)).not.toThrow();
  });
});

describe('both row types feed the SAME button', () => {
  it('an all-builds row produces the same labels as a submitted one', () => {
    const a = allBuildRowFacts({
      workspaceId: 'agentv3-x', ownerUid: 'u1',
      owner: { label: 'Lok Up', email: 'lokup528@gmail.com', name: 'Lok Up' },
      savedAt: NOW, ok: true, userTier: 'paid', billedInr: 39, billedUsd: 0.45,
    }, NOW);
    expect(() => renderToStaticMarkup(<ReportInfoButton facts={a} />)).not.toThrow();
    expect(a.map((f) => f.label)).toContain('Charged');
    expect(a.map((f) => f.label)).toContain('Status');
  });
});

describe('the shared filter bar', () => {
  const html = renderToStaticMarkup(
    <ReportFilterBar
      value={EMPTY_FILTERS}
      onChange={() => {}}
      counts={{ all: 30, failed: 14, succeeded: 16, unknown: 0 }}
      users={[{ uid: 'u1', count: 3, label: 'Lok Up' }]}
    />,
  );

  it('renders the All-builds controls — chips with counts, a date range and a user picker', () => {
    expect(html).toContain('All 30');
    expect(html).toContain('Failed 14');
    expect(html).toContain('Worked 16');
    expect(html).toContain('Any time');
    expect(html).toContain('Last 7 days');
    expect(html).toContain('Every user');
    expect(html).toContain('Lok Up (3)');
  });

  it('hides the "No outcome" chip when there are none — a chip must never describe an empty set', () => {
    expect(html).not.toContain('No outcome');
  });

  it('shows it when there ARE some, so those rows are reachable by some filter', () => {
    const withUnknown = renderToStaticMarkup(
      <ReportFilterBar value={EMPTY_FILTERS} onChange={() => {}} counts={{ all: 30, failed: 14, succeeded: 11, unknown: 5 }} />,
    );
    expect(withUnknown).toContain('No outcome 5');
  });

  it('offers Clear only when something is narrowing', () => {
    expect(html).not.toContain('Clear');
    const narrowed = renderToStaticMarkup(
      <ReportFilterBar value={{ ...EMPTY_FILTERS, date: '7d' }} onChange={() => {}} />,
    );
    expect(narrowed).toContain('Clear');
  });
});

describe('the admin panel wires BOTH lists to the shared pieces', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');
  const count = (needle: string) => src.split(needle).length - 1;

  it('both lists render the shared filter bar', () => {
    expect(count('<ReportFilterBar')).toBeGreaterThanOrEqual(2);
  });

  it('both lists render the shared ⓘ button', () => {
    expect(count('<ReportInfoButton')).toBeGreaterThanOrEqual(2);
  });

  it('🔴 the nine-column table is GONE — it is what overflowed the phone by 513 px', () => {
    // Its own header cells, which no other table on this page carries together.
    const header = /<th[^>]*>SN<\/th>[\s\S]{0,400}<th[^>]*>Sender<\/th>/;
    expect(header.test(src)).toBe(false);
    expect(src).not.toContain('>Charged</th>');
  });

  it('taking a report marks it — from BOTH the Copy and the Download button', () => {
    // The admin said "download"; the row's other button hands over the identical JSON, and on a phone
    // it is the commoner path. A mark the everyday action bypasses is a mark that does not work.
    const dl = src.slice(src.indexOf('const downloadWorkspaceReport'), src.indexOf('const copyWorkspaceReport'));
    const cp = src.slice(src.indexOf('const copyWorkspaceReport'));
    expect(dl).toContain('markBuildTaken(workspaceId, { downloaded: true })');
    expect(cp.slice(0, 600)).toContain('markBuildTaken(workspaceId, { downloaded: true })');
  });

  it('the badge is drawn from the SERVER’s answer, never an optimistic guess', () => {
    // A badge invented locally would show "Taken" on a write that silently failed — and send the next
    // session to the same report, which is the whole bug this feature exists to prevent.
    const fn = src.slice(src.indexOf('const markBuildTaken'), src.indexOf('const downloadWorkspaceReport'));
    expect(fn).toContain('d?.triage');
    expect(fn).toMatch(/if \(!r\.ok \|\| !d\?\.triage\)/);
  });

  it('the taken-mark can be undone', () => {
    expect(src).toContain('markBuildTaken(b.workspaceId, { downloaded: false })');
  });
});

describe('the server serves what the lists need', () => {
  const routes = readFileSync(resolve(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
  const store = readFileSync(resolve(process.cwd(), 'src/server/AgentV3/DiagnosticsStore.ts'), 'utf8');

  it('the all-builds list carries each row’s triage', () => {
    expect(routes).toContain('const triage = await getBuildTriage(');
    expect(routes).toContain('triage: triage.get(b.workspaceId) ?? null');
  });

  it('the mark route exists and refuses to report success on a write that did not happen', () => {
    expect(routes).toContain("app.post('/api/admin/all-builds/:workspaceId/mark'");
    expect(routes).toMatch(/if \(!triage\) \{ res\.status\(503\)/);
  });

  it('downloaded is TRI-STATE on both mark routes — absent must never clear the mark', () => {
    // `body.downloaded === true` turns an absent field into false, which (now that false clears)
    // would erase the download every time the admin ticked "Mark fixed".
    expect(routes).not.toContain('downloaded: body.downloaded === true');
    expect(routes.split("typeof body.downloaded === 'boolean' ? body.downloaded : undefined").length - 1).toBe(2);
  });

  it('the money facts ride the list query that already read them — no extra round trip', () => {
    expect(store).toContain('billedInr: num(bill?.billedInr)');
    expect(store).toContain('zeroBillReason: str(bill?.zeroBillReason)');
  });
});
