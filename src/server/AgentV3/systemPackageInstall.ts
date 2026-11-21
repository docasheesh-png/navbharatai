/**
 * 🔴 A SYSTEM PACKAGE MANAGER CANNOT RUN HERE (failedbr #1803, 2026-11-20). An MP3-converter build ran
 * `apt-get update && apt-get install -y ffmpeg` and got `E: Could not open lock file /var/lib/apt/lists/lock - open
 * (13: Permission denied)`. The sandbox user is not root and `sudo` is refused by command governance, so every apt /
 * yum / dnf / apk / brew / snap install fails, always, after the model has already decided its design depends on it.
 *
 * The command is answered before it runs, with what does work: an npm package that ships the binary (ffmpeg-static,
 * @ffmpeg/ffmpeg in the browser, sharp for images, …) or a pure-JavaScript library. Only an INSTALL is refused: `apt
 * list`, `which ffmpeg`, `dpkg -l` and the like are reads and run unchanged. PURE.
 */

/** Each install form, judged on one shell segment. */
const SYSTEM_INSTALL = /^\s*(?:sudo\s+)?(?:apt-get|apt|aptitude|yum|dnf|microdnf|zypper|apk|pacman|brew|snap|port)\s+(?:-[\w-]+\s+)*(?:install|add|-S\b|upgrade|update)\b/i;

/** Splits a command on `;`, `&&`, `||` and newlines; a pipe stays inside its segment. */
function segments(command: string): string[] {
  return String(command ?? '').split(/;|&&|\|\||\n/).map((s) => s.trim()).filter(Boolean);
}

/** The refusal for a command that installs (or refreshes) system packages, or `null` when it does not. */
export function systemPackageInstallRefusal(command: string): string | null {
  const hit = segments(command).find((s) => SYSTEM_INSTALL.test(s));
  if (!hit) return null;
  return `NOT RUN — "${hit.slice(0, 80)}" needs root, and this sandbox has none (sudo is refused too), so a system `
    + 'package manager always fails here. Use an npm package instead: one that ships the binary (for example '
    + '`ffmpeg-static` for a server, `@ffmpeg/ffmpeg` in the browser, `sharp` for images) or a pure-JavaScript library, '
    + 'installed with npm like any other dependency.';
}
