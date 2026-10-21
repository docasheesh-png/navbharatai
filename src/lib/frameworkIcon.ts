/** Explicit framework asset names, not general icon filenames. A user-owned favicon.png/ico/svg
 * is not evidence of a framework default. Keep ambiguous artwork unless the owner chooses a replacement.
 * Shared by web defaults and the emitted mobile branding runner so those surfaces cannot disagree. */
export const FRAMEWORK_ICON_PATH = /(^|\/)(vite|react|vue|svelte|angular|capacitor)\.(svg|png|ico)(?:[?#].*)?$/i;
