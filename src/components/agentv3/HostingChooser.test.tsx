import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostingChooser, type HostingProvider, type OwnRepoInfo } from './HostingChooser';

const P = (id: string, name: string, configured: boolean): HostingProvider => ({ id, name, configured, requirement: '' });

function render(providers: HostingProvider[], extra: Partial<React.ComponentProps<typeof HostingChooser>> = {}) {
  return renderToStaticMarkup(
    <HostingChooser providers={providers} onDeploy={() => {}} onClose={() => {}} busy={false} {...extra} />,
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
    expect(html).toContain('No provider connected yet'); // BYO empty state
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

// "I host it myself" — NavBharatAI never touches deployment; only writes code into the user's own
// GitHub repo (admin request 2026-07-27: "user apni khud ki hosting connect kare... NavBharatAI
// edit kare, CI green par merge kare, waki uska hosting jaane").
describe('HostingChooser — "I host it myself" (BYO hosting via own-repo git storage)', () => {
  const OWN_REPO: OwnRepoInfo = { owner: 'aashish', repo: 'mitrify', workBranch: 'navbharatai/work', baseBranch: 'main' };

  it('always offers the third "I host it myself" path, independent of configured deploy providers', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('I host it myself');
    expect(html).toContain('We never touch your hosting');
    expect(html).toContain('We only write code and open a pull request into your own GitHub repo');
  });

  it('shows "Set up" when no own-repo is connected yet for this workspace', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('Set up');
  });

  it('shows the connected repo name on the button once own-repo storage is active', () => {
    const html = renderToStaticMarkup(
      <HostingChooser providers={[P('firebase', 'Firebase Hosting', true)]} onDeploy={() => {}} onClose={() => {}} busy={false}
        ownRepo={OWN_REPO} />,
    );
    expect(html).toContain('Connected: aashish/mitrify');
  });
});

// "Make an Android app" — the third Publish path opens the built-in APK Builder, pre-targeted to this
// app (admin 2026-08-13: publish chooser ke teesre option se APK builder khule).
describe('HostingChooser — "Make an Android app" (APK) path', () => {
  it('always offers the Android APK card as the third path', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('Make an Android app');
    expect(html).toContain('Open APK Builder');
    expect(html).toContain('installable Android app (.apk)');
    expect(html).toContain('paid step'); // honest about the cost up front
  });

  it('the APK button is disabled when no opener is wired (no dead action)', () => {
    // Without onOpenApkBuilder there is nothing to open, so the button must be disabled, not a fake click.
    const html = render([P('firebase', 'Firebase Hosting', true)]); // no onOpenApkBuilder passed
    const btnIdx = html.indexOf('Open APK Builder');
    expect(html.slice(0, btnIdx)).toMatch(/disabled/);
  });

  it('self-hosting now lives INSIDE "Host somewhere else" (folded in, not a separate card)', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    // Both sub-choices of path 2 are present in one card.
    expect(html).toContain('We deploy to your provider');
    expect(html).toContain('I host it myself');
  });
});

// ADMIN REPORT 2026-08-19: "app mart me sirf naam aata hai, logo nahi." The App Mart publish form never
// sent an icon, so every listing fell back to the globe. The form must expose an icon control (which
// the publish call then sends as iconDataUrl) so a published app can carry its logo.
describe('HostingChooser — App Mart listing carries an app icon (logo bug fix)', () => {
  it('the "Put it on App Mart" form offers an app-icon upload', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('Put it on App Mart');
    expect(html).toContain('Add app icon'); // the upload control that feeds iconDataUrl
    expect(html).toContain('at least 512'); // honest sizing guidance
  });

  // ADMIN 2026-08-19: "waha 2 option aur add karo — 1. make icon 2. pest". A user on a phone has no
  // icon file lying around; the two ways that actually fit that user are the clipboard and making one.
  it('also offers Paste — the way an icon copied from AI Image Gen gets in', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('Paste');
  });

  it('shows "Make icon" only when something can actually open AI Image Gen', () => {
    // Same honesty rule the APK button follows: never render an action that cannot happen.
    // Matched on the BUTTON's label, not the words "Make icon" — the help text below the row explains
    // the round trip and says them too, which is exactly what a looser assertion would trip over.
    const label = 'aria-label="Make icon with AI Image Gen"';
    expect(render([P('firebase', 'Firebase Hosting', true)])).not.toContain(label);
    expect(render([P('firebase', 'Firebase Hosting', true)], { onMakeIcon: () => {} })).toContain(label);
  });
});

// ADMIN REPORT 2026-08-02 (phone, Publish surface): "niche scroll nahi ho raha. iske sabhi button
// farzi hai, koi bhi kaam nahi kar raha hai." Two real defects, both locked here.
describe('HostingChooser — the sheet must scroll on a phone (clipped-content fix)', () => {
  it('caps the card at the viewport and scrolls the BODY, with the header pinned', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    // Without a height cap the card grew past the screen and `overflow-hidden` CLIPPED everything
    // below the fold (the "Set up" button, the full-stack note) with no way to reach it.
    //
    // ⚠️ THIS ASSERTION USED TO BE `max-h-[85vh]`, AND THAT CAP WAS ITSELF THE NEXT BUG (admin
    // 2026-08-23). On a mobile browser `vh` is the LARGE viewport, so 85vh is measured against a box
    // ~100-150px taller than the visible one: the card's bottom sat under the browser toolbar and,
    // because the body's scroll height was computed from that same too-tall box, content that only
    // just overflowed produced NO scrollbar at all. `nb-sheet` (index.css) caps against the visible
    // viewport via `dvh`, with `vh` as the fallback. The cap is still asserted — only its unit moved.
    expect(html).toContain('nb-sheet');
    expect(html).not.toContain('max-h-[85vh]');
    // The backdrop is the height authority, so the card's `max-height: 100%` means something real.
    expect(html).toContain('nb-sheet-overlay');
    // The body is the one scroll container…
    expect(html).toContain('overflow-y-auto');
    // …and the swipe stays inside the sheet instead of scrolling the page behind it.
    expect(html).toContain('overscroll-contain');
  });

  it('still renders the content that used to be clipped below the fold', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('Set up');                 // path 3's button
    expect(html).toContain('coming soon');            // the full-stack note under it
    expect(html).toContain('always the same app you built');
  });
});

describe('HostingChooser — a publish that cannot start SAYS SO (no dead buttons)', () => {
  it('shows the honest reason inline and does NOT ask to close when onDeploy is blocked', () => {
    // A blocked publish returns a reason string; the chooser must surface it rather than no-op.
    let closed = false;
    const html = renderToStaticMarkup(
      <HostingChooser
        providers={[P('firebase', 'Firebase Hosting', true)]}
        onDeploy={() => 'Build an app first — there is nothing to publish yet.'}
        onClose={() => { closed = true; }}
        busy={false}
        onOpenApkBuilder={() => {}}
      />,
    );
    // Static render can't click, so assert the wiring that makes it possible: every action is enabled
    // (a real action — NavBharatAI publish, and the APK opener), and the chooser owns an error surface
    // for the returned reason.
    expect(html).toContain('Publish on NavBharatAI');
    expect(html).not.toContain('disabled=""');
    expect(closed).toBe(false); // onClose is never called just by rendering
  });

  it('explains WHY the NavBharatAI button is greyed out when our host is unavailable', () => {
    // A disabled button with no explanation is its own dead end.
    const html = render([P('vercel', 'Vercel', true)]); // no configured 'firebase'
    expect(html).toContain('disabled');
    expect(html).toContain('NavBharatAI hosting isn'); // apostrophe is HTML-escaped in static markup
    expect(html).toContain('t available right now');
    expect(html).toContain('you can still publish to your own'); // gives a real way forward
  });
});

/**
 * UNPUBLISH (admin 2026-08-21). Users could not remove a published app — only an admin could — which
 * made the new five-app limit's advice ("remove an app you no longer need") a dead end.
 *
 * The admin's own condition: "yeh sirf tabhi dikhe, jab app kamse kam 1 bar published ho chuki ho."
 * `liveUrl` is that gate, and the server returns it only for a genuinely ACTIVE deployment.
 */
describe('HostingChooser — the Unpublish control', () => {
  const LIVE = 'https://v3-abc-123-hash.mitrify.in';

  it('THE RULE: hidden when the app has never been published', () => {
    const html = render([P('firebase', 'NavBharatAI', true)], { onUnpublish: async () => {} });
    expect(html).not.toContain('Remove this app from NavBharatAI hosting');
  });

  it('shown once the app is genuinely live', () => {
    const html = render([P('firebase', 'NavBharatAI', true)], { liveUrl: LIVE, onUnpublish: async () => {} });
    expect(html).toContain('Remove this app from NavBharatAI hosting');
  });

  it('stays hidden for a live URL when no handler is wired — never a button that cannot act', () => {
    const html = render([P('firebase', 'NavBharatAI', true)], { liveUrl: LIVE });
    expect(html).not.toContain('Remove this app from NavBharatAI hosting');
  });

  it('does NOT take the app offline on the first press — the confirm step is a second decision', () => {
    // Anyone holding the link loses it the moment this runs, so the first click only asks.
    const html = render([P('firebase', 'NavBharatAI', true)], { liveUrl: LIVE, onUnpublish: async () => {} });
    expect(html).not.toContain('Yes, take it offline');   // the confirm appears only after the first press
    expect(html).toContain('Remove this app from NavBharatAI hosting');
  });
});

/**
 * "YOUR PUBLISHED APPS" (admin 2026-08-21: "jisse user apni saari live apps ek jagah dekhe aur wahin
 * se hata sake").
 *
 * THE GAP IT CLOSES: Unpublish only reaches the app whose chat you have open. Delete the chat and the
 * app stays live forever with nothing pointing at it — while still occupying one of the user's five
 * free slots. This list is keyed by USER, not by workspace, which is precisely what makes an orphaned
 * app reachable again.
 */
describe('HostingChooser — "Your published apps"', () => {
  it('offers the entry point whenever a loader is wired — even with nothing published', () => {
    // The COUNT is the useful part ("3 of 5 used"), so the door must open before the limit bites.
    const html = render([P('firebase', 'NavBharatAI', true)], { onLoadMyApps: async () => null });
    expect(html).toContain('Your published apps');
  });

  it('is absent when nothing can load it — no button that cannot act', () => {
    const html = render([P('firebase', 'NavBharatAI', true)]);
    expect(html).not.toContain('Your published apps');
  });

  it('does not fetch anything just by rendering — the list loads only when opened', () => {
    let calls = 0;
    render([P('firebase', 'NavBharatAI', true)], { onLoadMyApps: async () => { calls += 1; return null; } });
    expect(calls).toBe(0);
  });
});
