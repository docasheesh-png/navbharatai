import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppAiSettingsView } from './AppAiSettingsCard';

const base = { available: true, usesAi: true, enabled: true, ownKey: null, previewCapInr: 2, previewSpentTodayInr: 0.12, publishedSpentTodayInr: 1.5 } as const;

describe('AI in this app — the owner is told, and can act', () => {
  it('says nothing for an app with no assistant', () => {
    expect(renderToStaticMarkup(<AppAiSettingsView view={{ ...base, usesAi: false }} />)).toBe('');
    expect(renderToStaticMarkup(<AppAiSettingsView view={null} />)).toBe('');
  });
  it('NavBharatAI engine: who pays, the switch, today’s spend, and the own-key route', () => {
    const html = renderToStaticMarkup(<AppAiSettingsView view={base} />);
    expect(html).toContain('charged to your balance');
    expect(html).toContain('role="switch"');
    expect(html).toContain('preview ₹0.12 of ₹2.00');
    expect(html).toContain('OPENAI_API_KEY or ANTHROPIC_API_KEY');
  });
  it('switched off says so', () => {
    expect(renderToStaticMarkup(<AppAiSettingsView view={{ ...base, enabled: false }} />)).toContain('Switched off');
  });
  it('own key: no switch, no charge, and never the key itself', () => {
    const html = renderToStaticMarkup(<AppAiSettingsView view={{ ...base, ownKey: 'openai' }} />);
    expect(html).toContain('your OpenAI key');
    expect(html).toContain('Nothing is charged');
    expect(html).not.toContain('role="switch"');
  });
});
