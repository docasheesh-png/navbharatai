// THE PREVIEW DOOR — the frame never holds a machine's address again (admin 2026-08-22).
//
// THE QUESTION THAT PRODUCED THIS, verbatim: "kya yeh problem kabhi fix nahi ho sakti?" — after the
// THIRD screenshot in one day of a vendor error page framed as the user's app ("Sandbox Not Found",
// then "Closed Port Error … no service running on port 3000"), each time with our own banner above it
// confidently describing a different machine or a different port.
//
// WHY IT KEPT COMING BACK, despite three fixes that were each individually correct. Every fix so far
// accepted the same premise: the client HOLDS a preview URL (host + port) and we try to keep that
// stored address fresh — heal it, compare it, adopt a newer one. But the address names a MACHINE, and
// machines here are deliberately mortal: they pause in 5 idle minutes and expire entirely. However
// well we patch, a stored address is a stale-artifact bug waiting for its moment; this codebase found
// SEVEN of that exact class this week. The class survives because the premise does.
//
// SO THE PREMISE GOES. The iframe now points at OUR OWN, WORKSPACE-STABLE url — the door — and the
// door resolves "where is this app right now?" at REQUEST time:
//
//   no sandbox at all      → our own honest "asleep" page (auto-retrying), never a vendor's
//   paused sandbox         → connecting resumes it; its processes survive a pause, so the dev server
//                            is typically still running — the door hit IS the wake-up
//   alive, port unknown    → the PROVEN port (revival recipe) is tried first, then a real sweep —
//                            the door only ever redirects to a port it just saw serving
//   alive, nothing serving → our own "starting" page (auto-refresh) while the watchdog boots it
//   verified serving       → 302 to the live host — the ONLY case where the browser leaves our origin
//
// The consequences fall out by construction rather than by vigilance:
//   • A vendor's error page can never render: the browser only reaches the vendor's edge after WE
//     verified the target serves. Dead machine ⇒ the browser is still on our origin, seeing our page.
//   • A replaced sandbox needs no "adoption": the same door url simply resolves to the new machine.
//   • The 3000-vs-5000 class dies: a port is never trusted because a url once said so — it is trusted
//     because a probe just saw it answer.
//
// AUTH, and why it is a signed token instead of a header. An iframe navigation is a plain GET — it
// cannot carry an Authorization header. So the health endpoint (which IS authenticated) mints a
// short-lived HMAC link binding the workspaceId and an expiry. The door leaks nothing an attacker
// could not already reach with the raw preview url itself; the token only stops workspace-id
// enumeration. Multi-instance Cloud Run verifies tokens minted by any instance because the HMAC key
// is the shared SECRET_ENCRYPTION_KEY; the per-process fallback below exists only for dev.
//
// PURE — signing, verification, decisions and pages. The route owns all I/O.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Kill switch: set AGENTV3_PREVIEW_DOOR=off to stop minting door links without a deploy. */
export function previewDoorEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PREVIEW_DOOR ?? '').trim().toLowerCase() !== 'off';
}

/** Dev-only fallback secret. Random per process ON PURPOSE: it must never be a guessable constant. */
const processSecret = randomBytes(32).toString('hex');

/** The HMAC key. SECRET_ENCRYPTION_KEY is set in Cloud Run, so prod tokens verify across instances. */
export function doorSecret(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.SECRET_ENCRYPTION_KEY ?? '').trim() || processSecret;
}

/** How long a minted link stays valid. Long enough for an idle tab; re-minted on every health poll. */
export const DOOR_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function signDoorToken(workspaceId: string, expEpochMs: number, secret: string): string {
  return createHmac('sha256', secret).update(`${workspaceId}|${expEpochMs}`).digest('hex').slice(0, 48);
}

/** Constant-time verification. Malformed input is simply false — never an exception, never a leak. */
export function verifyDoorToken(
  workspaceId: string | null | undefined,
  exp: string | number | null | undefined,
  sig: string | null | undefined,
  secret: string,
  now: number,
): boolean {
  const ws = String(workspaceId ?? '').trim();
  const expMs = Number(exp);
  const given = String(sig ?? '').trim();
  if (!ws || !Number.isFinite(expMs) || !given) return false;
  if (now > expMs) return false;
  const want = signDoorToken(ws, expMs, secret);
  const a = Buffer.from(want);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/** The relative door url the client should put in the iframe. Stable per workspace, re-minted freely. */
export function makeDoorPath(workspaceId: string, now: number, secret: string, ttlMs = DOOR_TOKEN_TTL_MS): string {
  const exp = now + ttlMs;
  const sig = signDoorToken(workspaceId, exp, secret);
  return `/api/agentv3/preview-door?ws=${encodeURIComponent(workspaceId)}&exp=${exp}&sig=${sig}`;
}

export type DoorPageKind =
  /** No machine exists for this workspace right now. */
  | 'asleep'
  /** A machine exists but nothing is serving yet — the watchdog/wake is bringing it up. */
  | 'starting'
  /** The link is invalid or expired — reopen the preview from inside NavBharatAI. */
  | 'refused';

/** Self-refresh attempts before the waiting pages STOP retrying on their own. See doorPage. */
export const DOOR_RETRY_CAP = 20;
/** Seconds between self-refreshes. */
export const DOOR_RETRY_SECONDS = 6;

/**
 * What the frame shows while the app is not reachable — OUR page, never a vendor's.
 *
 * 🔒 Names no vendor, no "sandbox", no port number, and never blames the user. 'asleep' and
 * 'starting' retry THEMSELVES — when a wake or the watchdog brings the app up, the next refresh 302s
 * straight into it with nothing for the user to do. 'refused' never retries (an expired link stays
 * expired).
 *
 * ⚠️ THE RETRY IS CAPPED, AND THE CAP IS MONEY, NOT POLISH. A door hit on a paused machine RESUMES
 * it — that is the wake-up working as designed. But resumed compute is billed by the minute, and the
 * idle reaper re-pauses it after five quiet minutes: an UNCAPPED self-refresh in a tab someone left
 * open would therefore resurrect the machine every few seconds forever — a tug-of-war with the reaper,
 * billed to NavBharatAI, for a viewer who is not there. So the page retries ~2 minutes' worth
 * (DOOR_RETRY_CAP × DOOR_RETRY_SECONDS) and then STOPS, telling the truth: go back to NavBharatAI and
 * press Wake up. "Try again" resets the counter — a present human is exactly who the retries are for.
 * The counter lives in sessionStorage, which is per-tab and survives the page replacing itself.
 */
export function doorPage(kind: DoorPageKind): string {
  const retryScript = kind === 'refused' ? '' : `<script>(function(){
  try {
    var k='nbai:door-tries:'+location.search;
    var n=Number(sessionStorage.getItem(k)||'0')+1;
    if(n<=${DOOR_RETRY_CAP}){sessionStorage.setItem(k,String(n));setTimeout(function(){location.reload();},${DOOR_RETRY_SECONDS * 1000});}
    else{
      var h=document.getElementById('h'),p=document.getElementById('p'),s=document.getElementById('s'),r=document.getElementById('r');
      if(h)h.textContent='Still waiting on your app';
      if(p)p.textContent='It has not come up on its own. Go back to NavBharatAI and press Wake up — or try again here.';
      if(s)s.style.display='none';
      if(r){r.style.display='inline-block';r.onclick=function(){try{sessionStorage.removeItem(k);}catch(e){}location.reload();return false;};}
    }
  } catch(e){ /* blocked storage: retry once-per-load only, which is exactly the safe direction */ }
})();</script>`;
  const heading = kind === 'asleep'
    ? 'Your preview is waking up'
    : kind === 'starting'
      ? 'Your app is starting'
      : 'Open the preview from NavBharatAI';
  const body = kind === 'asleep'
    ? 'It went to sleep while nobody was looking — that keeps it free when idle. Reconnecting now; this page retries by itself. Your app and its files are safe.'
    : kind === 'starting'
      ? 'The server is coming up. This page retries by itself and will show your app the moment it answers. If it takes more than a minute, go back to NavBharatAI and press Wake up.'
      : 'This preview link has expired. Open your app in NavBharatAI and the preview will reconnect with a fresh one.';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NavBharatAI Preview</title><style>
  html,body{height:100%;margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#e6edf3}
  .wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .card{max-width:420px}
  .spin{width:36px;height:36px;margin:0 auto 16px;border-radius:50%;border:3px solid #30363d;border-top-color:#4f6ef7;animation:s 1s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  h1{font-size:17px;margin:0 0 8px;font-weight:600}
  p{font-size:13px;line-height:1.6;color:#8b949e;margin:0}
  @media (prefers-color-scheme: light){html,body{background:#f6f8fa;color:#1f2328}.spin{border-color:#d0d7de;border-top-color:#4f6ef7}p{color:#57606a}}
  a.retry{display:none;margin-top:14px;font-size:13px;color:#4f6ef7;text-decoration:underline;cursor:pointer}
  </style></head><body><div class="wrap"><div class="card">${kind === 'refused' ? '' : '<div class="spin" id="s"></div>'}<h1 id="h">${heading}</h1><p id="p">${body}</p><a class="retry" id="r" href="#">Try again</a></div></div>${retryScript}</body></html>`;
}
