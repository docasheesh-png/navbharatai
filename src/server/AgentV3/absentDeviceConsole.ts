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
