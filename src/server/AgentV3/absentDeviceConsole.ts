/**
 * 📷 OUR CHECKING BROWSER HAS NO CAMERA, MICROPHONE OR LOCATION — A LINE SAYING SO IS NOT AN APP DEFECT
 * (failedbr #2263, 2026-11-20 — "Minecraft X-ray" camera app).
 *
 * The app asked for the camera, caught `NotFoundError: Requested device not found`, logged it with console.error and
 * showed its own "no camera" screen — exactly what a real user without a camera should see. The render check counted
 * that line as "the app did not run cleanly": a repair pass ran, the line came back (the headless browser still had no
 * camera), OUTCOME_PREVIEW_FAILED, release gate RED, and the build was not ok. The click explorer read the same line
 * as "Try Again did not work". A repair can never make a camera appear, so every such verdict was unwinnable.
 *
 * 🔑 THE CLASS: a judgment of the APP made from a fact about OUR browser. ONE pattern, read by the render/console
 * filter (`filterActionableErrors`) and by the click explorer's in-browser noise, so the two cannot disagree. It
 * matches only a console line that BOTH names a device-refusal error AND a device: an UNCAUGHT exception (a
 * `pageerror`, an app that crashed instead of handling it) is never filtered, and a DOM `NotFoundError` about
 * `removeChild` names no device, so it stays a real defect. PURE.
 */
export const ABSENT_DEVICE_CONSOLE_SRC =
  String.raw`^(?=[\s\S]*(?:\b(?:NotFoundError|NotAllowedError|NotReadableError|OverconstrainedError|PermissionDeniedError|DevicesNotFoundError)\b|requested device not found|permission (?:denied|dismissed)|user denied|could not start (?:audio|video) source))`
  + String.raw`(?=[\s\S]*\b(?:camera|webcam|microphone|mic|media ?devices?|getusermedia|geolocation|location|video|audio|device)\b)`;

export const ABSENT_DEVICE_CONSOLE_RE = new RegExp(ABSENT_DEVICE_CONSOLE_SRC, 'i');

/** A console line that only reports our browser's missing/refused camera, microphone or location. PURE. */
export function isAbsentDeviceConsoleLine(text: string | null | undefined): boolean {
  return ABSENT_DEVICE_CONSOLE_RE.test(String(text ?? ''));
}

/**
 * 🎞️ …AND IT PLAYS NO H.264, AND A SWIPE FEED RACES ITS OWN play()/pause() (failedbr #2169, 2026-11-20 — a reels-style
 * video app). The render check failed the app on "Error playing video: NotSupportedError: Failed to load because no
 * supported source was found" (our headless Chromium ships no proprietary codecs, so a public MP4 cannot play in it,
 * while it plays on every phone) and on "AbortError: The play() request was interrupted by a call to pause()" (the
 * browser's own message when a feed pauses a video before it started — harmless by the browser vendor's own docs).
 * A repair could change neither; gate RED, build not ok. Same reader rule as the device line: a console line only,
 * and only these exact media facts.
 */
export const BROWSER_MEDIA_LIMIT_CONSOLE_SRC =
  String.raw`The play\(\) request was interrupted by (?:a call to pause\(\)|a new load request)`
  + String.raw`|no supported source was found|NotSupportedError:[^\n]*\b(?:source|media|video|audio|codec|format)\b`;

export const BROWSER_LIMIT_CONSOLE_SRC = `${ABSENT_DEVICE_CONSOLE_SRC}|${BROWSER_MEDIA_LIMIT_CONSOLE_SRC}`;
const BROWSER_LIMIT_CONSOLE_RE = new RegExp(BROWSER_LIMIT_CONSOLE_SRC, 'i');

/** A console line that only reports a limit of OUR checking browser (no device, no proprietary codec, a play/pause race). PURE. */
export function isOurBrowserLimitConsoleLine(text: string | null | undefined): boolean {
  return BROWSER_LIMIT_CONSOLE_RE.test(String(text ?? ''));
}
