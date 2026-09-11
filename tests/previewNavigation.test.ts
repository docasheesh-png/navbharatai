import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { previewBridgeSource } from '../src/server/AgentV3/previewBridge';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const surface = read('src/components/agentv3/PreviewSurface.tsx');
const utils = read('src/lib/previewUtils.ts');
const route = read('src/server/routes/agentv3.ts');

describe('the preview has a real address bar — the first one that is not fake', () => {
  it('the app reports its own route, including SPA navigations that fire no event', () => {
    const js = previewBridgeSource('live');
    expect(js).toContain('__nbaiPreviewRoute');
    expect(js).toContain("addEventListener('popstate'");
    expect(js).toContain("addEventListener('hashchange'");
    // pushState is a SILENT history mutation — a React Router navigation fires nothing, so without
    // wrapping it the address would freeze on the first page and quietly lie from then on.
    expect(js).toContain("['pushState', 'replaceState']");
  });

  it('history steps are the app’s OWN history, not a simulation', () => {
    const js = previewBridgeSource('live');
    expect(js).toContain('history.back()');
    expect(js).toContain('history.forward()');
  });

  it('only the panel may drive the app', () => {
    // Without this, any page that embedded the preview could navigate somebody's app.
    expect(previewBridgeSource('live')).toContain('if (e.source !== window.parent && e.source !== window.top) return;');
  });

  it('routes a HASH-ROUTED app by its hash and everything else by a real navigation', () => {
    const js = previewBridgeSource('in-browser');
    expect(js).toContain("SOURCE === 'in-browser' || String(location.hash || '').indexOf('#/') === 0");
    expect(js).toContain('location.assign(to)');
    // The in-browser preview rewrites BrowserRouter to HashRouter and lives in a srcdoc document that
    // cannot be navigated at all, so hash routing is not a preference there — it is the only way.
    expect(utils).toContain('HashRouter');
  });

  it('the bar appears only once the app has actually reported — never a dead control', () => {
    expect(surface).toContain('const routeBar = routePath ? (');
    expect((surface.match(/\{routeBar\}/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(surface).toContain('__nbaiNavigate');
    expect(surface).toContain("__nbaiHistory: 'back'");
  });

  it('does not overwrite a half-typed address because the app navigated underneath', () => {
    expect(surface).toContain('data-nb-route-input');
  });
});

describe('a preview error names its file', () => {
  it('every compiled module carries a sourceURL', () => {
    // Modules run through new Function(), which the browser labels "<anonymous>" — so a stack trace
    // named no file at all, and neither the user nor the AI handed the error could tell which one
    // broke. Costs nothing: no size change, no transform change.
    expect(utils).toContain("//# sourceURL=nbai-preview://");
  });
});

describe('the in-browser preview admits what it cannot reproduce', () => {
  it('the route computes and returns the notice on BOTH the fresh and cached paths', () => {
    // A cached response that dropped the caveat would make the notice appear and vanish depending on
    // whether the preview happened to be rebuilt — which is worse than never showing it.
    expect((route.match(/fidelityNotice: previewFidelityNotice\(/g) || []).length).toBe(2);
  });

  it('the panel shows it only for a preview that actually rendered', () => {
    expect(surface).toContain('fidelityNotice');
    // `source`, not `mode` (2026-09-11): the caveat is about the BUNDLER's render, so it must not show
    // over the saved copy — which is the real build and reproduces everything.
    expect(surface).toContain("source === 'inbrowser' && !!html && !err && !refusal.refuse && !!fidelityNotice");
  });
});
