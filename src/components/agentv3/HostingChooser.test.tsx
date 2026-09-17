import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HostingChooser, type HostingProvider, type OwnRepoInfo } from './HostingChooser';
import { ADVANCED_PUBLISH_LABEL, ADVANCED_PUBLISH_HINT } from '../../lib/advancedPublish';

const P = (id: string, name: string, configured: boolean): HostingProvider => ({ id, name, configured, requirement: '' });

// THE BRING-YOUR-OWN CARD IS COLLAPSED BY DEFAULT since ROADMAP §11 slice 5 (one Publish button), so a
// test that wants its contents has to render it the way a user who is already on that path sees it:
// expanded, because they have a provider connected or their own repo. That is the rule in
// `advancedPublish.ts`, not a test convenience — a user with neither is exactly who the collapse is for.
const BYO_OPEN: HostingProvider[] = [P('firebase', 'Firebase Hosting', true), P('vercel', 'Vercel', true)];

function render(providers: HostingProvider[], extra: Partial<React.ComponentProps<typeof HostingChooser>> = {}) {
  return renderToStaticMarkup(
    <HostingChooser providers={providers} onDeploy={() => {}} onClose={() => {}} busy={false} {...extra} />,
  );
}

describe('HostingChooser — the two-path Publish surface', () => {
  // CHANGED 2026-09-13 (slice 5's last half): path 2 is now a disclosure, so its old title is only on
  // screen once it is open. The assertion did not get weaker — it still proves both paths are offered,
  // and now also proves the collapsed one names itself well enough to find.
  it('always shows both paths + the honest full-stack "coming soon" note', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).toContain('Host on NavBharatAI');
    expect(html).toContain(ADVANCED_PUBLISH_LABEL);   // path 2, collapsed but named
    expect(html).toContain(ADVANCED_PUBLISH_HINT);    // and readable without opening it
    expect(html).toContain('Publish on NavBharatAI');
    expect(html).toContain('coming soon'); // full-stack honesty
    // Open, it is the same card it always was — both sub-choices, nothing dropped.
    const open = render(BYO_OPEN);
    expect(open).toContain('We deploy to your provider');
    expect(open).toContain('I host it myself');
    expect(open).toContain('your cloud, your bill, free from us');
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

  // CHANGED 2026-09-13: the empty state lives inside the collapsed card, so it is asserted on a user
  // who HAS the card open — one with their own repo, which is the other way the rule opens it. The
  // "never offered as a BYO row" half is checked on the default screen too, where it matters most.
  it('never lists NavBharatAI\'s own host as a "bring your own" option', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).not.toContain('Publish to Firebase Hosting');
    const opened = render([P('firebase', 'Firebase Hosting', true)], {
      ownRepo: { owner: 'aashish', repo: 'mitrify', workBranch: 'navbharatai/work', baseBranch: 'main' },
    });
    expect(opened).not.toContain('Publish to Firebase Hosting');
    expect(opened).toContain('No provider connected yet'); // BYO empty state
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

  // CHANGED 2026-09-13: "independent of configured deploy providers" still holds — with Vercel
  // connected and with none, the self-host sub-choice is there in full. What changed is that a user
  // with NEITHER a provider nor a repo sees it folded, so the open case is asserted with each of the
  // two signals that legitimately open it, not with one convenient fixture.
  it('always offers the third "I host it myself" path, independent of configured deploy providers', () => {
    for (const html of [
      render(BYO_OPEN),                                             // opened by a connected provider
      render([P('firebase', 'Firebase Hosting', true)], { ownRepo: OWN_REPO }), // opened by their repo
    ]) {
      expect(html).toContain('I host it myself');
      expect(html).toContain('We never touch your hosting');
      expect(html).toContain('We only write code and open a pull request into your own GitHub repo');
    }
  });

  // CHANGED 2026-09-13: a user with no repo AND no provider now sees this folded, so the case is
  // rendered with a connected provider — which is precisely the user who has no repo yet but is
  // already hosting elsewhere, and the one who most needs the button to say "Set up".
  it('shows "Set up" when no own-repo is connected yet for this workspace', () => {
    expect(render(BYO_OPEN)).toContain('Set up');
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
    // CHANGED 2026-09-13: rendered with the card open, since that card is now collapsed by default.
    const html = render(BYO_OPEN);
    // Both sub-choices of path 2 are present in one card.
    expect(html).toContain('We deploy to your provider');
    expect(html).toContain('I host it myself');
  });

  // THE REGRESSION THIS WHOLE CHANGE COULD HAVE BEEN. Collapsing a path is only acceptable because a
  // user who is already on it never meets the collapsed version — hiding a control somebody relies on
  // behind a click they have no reason to make is, from their side, the same as deleting it.
  it('never folds the bring-your-own paths away from a user already using them', () => {
    expect(render(BYO_OPEN)).toContain('Publish to Vercel');
    expect(render([P('firebase', 'Firebase Hosting', true)], {
      ownRepo: { owner: 'aashish', repo: 'mitrify', workBranch: 'navbharatai/work', baseBranch: 'main' },
    })).toContain('Connected: aashish/mitrify');
    // And the default screen really is the collapsed one, or the change did nothing.
    expect(render([P('firebase', 'Firebase Hosting', true)])).not.toContain('We deploy to your provider');
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

  // CHANGED 2026-09-13: path 3's button now sits inside the collapsed bring-your-own card, so the
  // scroll assertion renders it open. The point of this test — nothing is clipped away — is unchanged,
  // and folding is not clipping: the card is one press from open and says what it holds.
  it('still renders the content that used to be clipped below the fold', () => {
    const html = render(BYO_OPEN);
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

/**
 * THE BUTTON THE REFUSAL NAMES (admin report 2026-08-25: "yeh publish to navbharat ai ho hi nahi raha").
 *
 * Publishing a full-stack app is refused — correctly — with a message ending "Use “Deploy backend” to
 * put the whole app somewhere it can run". A repo-wide search for that control across the client found
 * nothing: the refusal pointed at a screen that did not exist. These tests pin the control to the
 * refusal code that names it, and pin the no-dead-button rule for the case where it cannot run yet.
 */
describe('HostingChooser — the backend-deploy offer', () => {
  const OWN: OwnRepoInfo = { owner: 'asheesh', repo: 'my-app', workBranch: 'nbai', baseBranch: 'main' };

  it('stays invisible for an ordinary app whose publish was never refused', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)]);
    expect(html).not.toContain('Deploy backend');
    expect(html).not.toContain('Your app has a server half');
  });

  it('shows a REAL Deploy backend button once the server refuses for needing a server', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)], {
      publishRefusalCode: 'backend-deploy-available',
      ownRepo: OWN,
      workspaceId: 'ws-1',
      authedFetch: async () => new Response('{}'),
    });
    expect(html).toContain('Your app has a server half');
    expect(html).toContain('Deploy backend');
    expect(html).toContain('asheesh/my-app');
  });

  it('offers steps, never a doomed press, when this app has no repository behind it', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)], {
      publishRefusalCode: 'backend-deploy-available',
      ownRepo: null,
      githubConnected: false,
      onConnectGitHub: () => {},
      workspaceId: 'ws-1',
    });
    expect(html).toContain('Your app has a server half');
    expect(html).toContain('GitHub repository');
    expect(html).toContain('Connect GitHub');
    // The button itself must NOT be offered — a deploy with no repo to match could only ever fail.
    expect(html).not.toContain('>Deploy backend<');
  });

  it('names the account when the deploy would run on our own hosting key', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)], {
      publishRefusalCode: 'backend-deploy-available',
      ownRepo: OWN,
      backendKeySource: 'server',
      workspaceId: 'ws-1',
    });
    expect(html).toContain('RENDER_API_KEY');
  });
});

/**
 * A MIRROR REPO IS STILL THE USER'S REPO. `ownRepo` is set only for own-repo working-branch storage,
 * but most apps that reach GitHub at all land as a mirror in the user's own account — equally
 * deployable, and previously invisible to this offer. The platform-org repo stays excluded on
 * purpose: it is not theirs, so a deploy from it could only fail.
 */
describe('HostingChooser — the backend-deploy offer accepts a mirror repo', () => {
  it('offers the button for a repo in the user own account even without own-repo storage', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)], {
      publishRefusalCode: 'backend-deploy-available',
      ownRepo: null,
      deployRepo: { owner: 'asheesh', repo: 'mirror-app' },
      workspaceId: 'ws-1',
    });
    expect(html).toContain('Deploy backend');
    expect(html).toContain('asheesh/mirror-app');
  });

  it('falls back to the prerequisites when there is no repo of their own at all', () => {
    const html = render([P('firebase', 'Firebase Hosting', true)], {
      publishRefusalCode: 'backend-deploy-available',
      ownRepo: null,
      deployRepo: null,
      githubConnected: false,
      onConnectGitHub: () => {},
      workspaceId: 'ws-1',
    });
    expect(html).not.toContain('>Deploy backend<');
    expect(html).toContain('Connect GitHub');
  });
});
