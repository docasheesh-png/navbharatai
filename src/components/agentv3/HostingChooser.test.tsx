import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostingChooser, type HostingProvider } from './HostingChooser';

const P = (id: string, name: string, configured: boolean): HostingProvider => ({ id, name, configured, requirement: '' });

function render(providers: HostingProvider[]) {
  return renderToStaticMarkup(
    <HostingChooser providers={providers} onDeploy={() => {}} onClose={() => {}} busy={false} />,
  );
}

describe('HostingChooser — the two-path Publish surface', () => {
  it('always shows both paths + the honest full-stack "coming soon" note', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('Host on NavBharatAI');
    expect(html).toContain('Host somewhere else');
    expect(html).toContain('Publish on NavBharatAI');
    expect(html).toContain('coming soon'); // full-stack honesty
    expect(html).toContain('Free');
  });

  it('offers a BYO button only for CONFIGURED non-NavBharatAI providers', () => {
    const html = render([
      P('firebase', 'Firebase Hosting', true),
      P('vercel', 'Vercel', true),
      P('netlify', 'Netlify', false), // not configured → must NOT be offered
    ]);
    expect(html).toContain('Publish to Vercel');
    expect(html).not.toContain('Publish to Netlify');
  });

  it('never lists NavBharatAI\'s own host as a "bring your own" option', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    // firebase is the NavBharatAI path, not a BYO row
    expect(html).not.toContain('Publish to Firebase Hosting');
    expect(html).toContain('No other providers connected yet'); // BYO empty state
  });

  it('disables the NavBharatAI publish button when our host is not configured', () => {
    const html = render([P('vercel', 'Vercel', true)]); // no firebase
    // the primary button is present but disabled (no our-hosting available)
    expect(html).toContain('Publish on NavBharatAI');
    expect(html).toMatch(/Publish on NavBharatAI[\s\S]*/);
    expect(html).toContain('disabled');
  });

  it('offers "Connect your own domain" ONLY when the feature is enabled + a workspace + our hosting', () => {
    const providers = [P('firebase', 'Firebase Hosting', true)];
    // off by default → not offered
    expect(renderToStaticMarkup(
      <HostingChooser providers={providers} onDeploy={() => {}} onClose={() => {}} busy={false} />,
    )).not.toContain('Connect your own domain');
    // enabled + workspace → offered
    expect(renderToStaticMarkup(
      <HostingChooser providers={providers} onDeploy={() => {}} onClose={() => {}} busy={false}
        workspaceId="agentv3-u1-s1" customDomainsEnabled />,
    )).toContain('Connect your own domain');
    // enabled but NO workspace → not offered (a domain is per-app)
    expect(renderToStaticMarkup(
      <HostingChooser providers={providers} onDeploy={() => {}} onClose={() => {}} busy={false}
        customDomainsEnabled />,
    )).not.toContain('Connect your own domain');
    // enabled + workspace but our hosting NOT configured → not offered
    expect(renderToStaticMarkup(
      <HostingChooser providers={[P('vercel', 'Vercel', true)]} onDeploy={() => {}} onClose={() => {}} busy={false}
        workspaceId="agentv3-u1-s1" customDomainsEnabled />,
    )).not.toContain('Connect your own domain');
  });
});
