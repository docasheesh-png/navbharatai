// A WRITE TOOL WRITES TEXT, SO IT MAY NOT WRITE A BINARY FILE.
//
// 🔴 AUTOPSY 728a402d (2026-09-30, "Nemi Mart", Weak tier). The builder called `write_file` for
// `public/nemi-icon-192.png` with an empty body, then drew the real icons with a Python script. The
// sandbox ended up with two good PNGs; the durable project ended up with a ZERO-BYTE
// `nemi-icon-192.png` (the captured text write — its hash is the SHA-256 of the empty string) and no
// `nemi-icon-512.png` at all, because the text store skips binaries and nothing else saved them. The
// manifest the user was told gives "app icons" pointed at one empty file and one missing one, and the
// preview copy disagreed with the saved project over that one path (PREVIEW_SNAPSHOT_STALE).
//
// Text written to a `.png` is a broken image whatever the text is, so the write is refused at the
// door with the two things that do work: an `.svg` (text, sharp at every size), or a command that
// creates the real bytes — which `buildAssets.ts` now saves with the project. PURE.

import { isBinaryAsset } from './fileClassification';

/** The refusal for a text write to a binary path, or null when the path is text. PURE. */
export function binaryTextWriteRefusal(path: string): string | null {
  if (!isBinaryAsset(path)) return null;
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return `NOT WRITTEN: ${path} is a binary file (.${ext}), and this tool writes TEXT — it would be saved as a broken file. `
    + 'For an icon or logo, write an .svg instead (text, sharp at every size; a web manifest accepts '
    + '{"src": "/icon.svg", "sizes": "any", "type": "image/svg+xml"}). '
    + `If the app really needs a .${ext} file, create it with a command in the sandbox — binary files a command creates are saved with the project.`;
}
