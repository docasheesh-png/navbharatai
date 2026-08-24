import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MonitorPanels } from './MonitorPanels';

describe('MonitorPanels renders', () => {
  const html = renderToStaticMarkup(<MonitorPanels adminToken="test-token" />);

  it('renders the monitor shell with its time-range controls', () => {
    expect(html).toContain('Live Monitor');
    expect(html).toContain('6h');
    expect(html).toContain('24h');
    expect(html).toContain('7d');
  });

  it('shows the panels the admin acts on', () => {
    expect(html).toContain('Build activity');
    expect(html).toContain('AI spend');
    expect(html).toContain('Platform health');
    expect(html).toContain('Server logs');
  });

  it('draws NO chart before any telemetry has arrived — a dash, never a zero line', () => {
    // The first paint has no data yet. It must not render bars or a plotted line, because an empty
    // chart reads as "nothing is happening" rather than "we have not looked yet".
    expect(html).not.toContain('<polyline');
    expect(html).toContain('Reading live telemetry');
    expect(html).toContain('—');
  });
});

describe('the Monitor is wired as the admin panel HOME (locked)', () => {
  // Losing any of these breaks nothing at runtime — the admin simply lands on a different page than
  // the one this work exists to put in front of them.
  const dashboard = readFileSync(resolve(__dirname, '../AdminDashboard.tsx'), 'utf8');

  it('opens on the Monitor tab', () => {
    expect(dashboard).toContain("useState<TabId>('monitor')");
  });

  it('renders the live panels on that tab', () => {
    expect(dashboard).toContain('<MonitorPanels adminToken={adminToken} />');
    expect(dashboard).toContain("from './admin/MonitorPanels'");
  });

  it('keeps the old Overview data on the same page rather than dropping it', () => {
    // Every one of these came from the Overview tab this page absorbed. If a future edit removes the
    // business half, the admin silently loses numbers they have always had here.
    expect(dashboard).toContain('Total Revenue');
    expect(dashboard).toContain('Registered Users');
    expect(dashboard).toContain('Website Hits Today');
    expect(dashboard).toContain('Publish Capacity');
    expect(dashboard).toContain('API Usage Ranking');
    expect(dashboard).toContain('Provider Token Burn');
    expect(dashboard).toContain('Recent Token Purchases');
    expect(dashboard).toContain('AI Insights');
  });

  it('leaves no dead reference to the tab id it replaced', () => {
    expect(dashboard).not.toContain("activeTab === 'overview'");
  });
});
