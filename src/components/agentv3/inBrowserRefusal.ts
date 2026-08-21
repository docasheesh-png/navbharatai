// SHOULD THE IN-BROWSER PREVIEW EVEN TRY? — one decision, in one place.
//
// WHY THIS EXISTS (admin report, Mitrify import 2026-08-21, build de674a44). The in-browser preview
// spent **9 MINUTES** — three CDN attempts at 180 s each — trying to fetch `react-dom/client` for an
// app it could never have run, then failed. Mitrify is a full-stack Express + PostgreSQL app.
//
// THE PART THAT MAKES THIS A REAL DEFECT RATHER THAN A SLOW PATH: the server had ALREADY WORKED IT
// OUT AND SAID SO. `proveBrowserRunnable` returned `browserRunnable: false`, blocker `has-backend`,
// reason "this project has its own server or database, which the live server has to run" — and the
// UI rendered the bundle anyway.
//
// It did so for an understandable reason that turned out to be wrong. The honest-refusal panel was
// gated on `!frameworkRunsInBrowser(framework)`, a CLIENT-side guess that starts life as
// `useState('vite-react')` and is never told what the server detected. And the one place the server's
// verdict WAS read carried `&& !hasBackend` — added so the friendlier backend BANNER could take that
// case instead of a duplicate refusal. But a banner does not stop a render: the user got a helpful
// blue note at the top of a preview that then span for nine minutes and died.
//
// So: the SERVER's verdict wins, because it is the only one computed from the project's actual files.
// The framework guess stays as a second trigger (it is right when the client does know), and a server
// that never answered (`null`) is not a verdict at all — silence must never refuse a working preview.

import { frameworkRunsInBrowser, serverFrameworkLabel } from '../../lib/frameworkDetect';

export interface RefusalInput {
  /** The client's framework belief. May be a stale default — never the only signal. */
  framework?: string;
  /** The SERVER's proof, from the real files. `null` = it has not answered yet. */
  browserRunnable: boolean | null;
  /** The server's own words for why it refused. */
  browserBlockedReason?: string;
  /** True when the project has its own server/database. */
  hasBackend?: boolean;
  backendReason?: string;
}

export interface Refusal {
  /** True when the in-browser bundle must NOT be rendered. */
  refuse: boolean;
  /** Headline, e.g. "Express runs on the Live server". */
  title: string;
  /** One honest sentence saying why, in the user's terms. */
  detail: string;
}

const NOT_REFUSED: Refusal = { refuse: false, title: '', detail: '' };

/**
 * Decide whether to refuse, and what to say. PURE.
 *
 * Order matters: the SERVER's verdict is checked first because it is computed from the project's
 * actual files, while `framework` may be a default the client was never corrected out of. When both
 * fire, the framework name makes the better headline ("Express runs on the Live server" beats a
 * generic one), so the title prefers it while the detail prefers the server's specific reason.
 */
export function inBrowserRefusal(i: RefusalInput): Refusal {
  const frameworkBlocks = !frameworkRunsInBrowser(i.framework);
  const serverBlocks = i.browserRunnable === false;
  if (!frameworkBlocks && !serverBlocks) return NOT_REFUSED;

  const title = frameworkBlocks
    ? `${serverFrameworkLabel(i.framework)} runs on the Live server`
    : 'This app needs the Live server';

  // The most specific true sentence available, in order: the server's own reason, then the backend
  // reason, then the framework explanation. Never a generic "it didn't work" when we know better.
  const detail = (i.browserBlockedReason || '').trim()
    || (i.hasBackend && (i.backendReason || '').trim()
      ? `This app has ${i.backendReason} — the in-browser preview runs only the frontend, so it cannot start it.`
      : '')
    || `This is a ${serverFrameworkLabel(i.framework)} app — it renders on a real server (pages, API routes, `
       + `server components), so the lightweight in-browser preview cannot run it.`;

  return { refuse: true, title, detail };
}
