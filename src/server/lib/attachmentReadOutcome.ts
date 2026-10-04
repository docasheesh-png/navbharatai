/**
 * WHAT HAPPENED TO THE USER'S PICTURE (autopsy 1389f0d5, 2026-09-30).
 *
 * The request was "Generate a pdf on genesis 4 with added images **with this photo type uploaded**". The
 * build route describes an attached image with a vision model, raced at 8 seconds (20 since Q-091) — and when that race is
 * lost, the description is `''` and nothing else happens. The builder is never told a picture was
 * attached, the report has no line about it, and the user got a generic "upload your photos" page with
 * no word about the one they had sent. Whether the picture arrived, was read, or was dropped could not
 * be answered from the report at all.
 *
 * Two halves, both PURE:
 *   • `unreadImagesBlock` — when no description came back, the builder is told which pictures were
 *     attached and that their content is unknown, so it says so instead of silently ignoring them
 *     (`describeVisionAttachments` already does this per picture when every provider FAILS; this is the
 *     same sentence for the case where the route gave up waiting).
 *   • `attachmentsReadNote` — the admin line: how many files, how many pictures, what came of reading
 *     them, and how long it took. The measurement that says whether the bound (`visionReadCapMs`) is right.
 */

export type VisionFate = 'no-images' | 'read' | 'timed-out' | 'failed' | 'empty';

/**
 * HOW LONG THE BUILD WAITS TO READ THE USER'S PICTURE (Q-091, autopsy 0311186f; admin 2026-10-04: "aap kro").
 *
 * The race used to be 8 s for every turn. That figure was chosen to stop a stalled provider hanging the
 * request before the build's deadline timer is armed; it was never measured against how long a vision
 * model takes. On 0311186f the call was abandoned at exactly 8.0 s and the build went ahead without the
 * picture the user had sent. A picture the user attached is part of the request, so a turn that carries
 * one waits up to 20 s. A turn with no picture keeps 8 s (there is nothing to describe, so nothing waits).
 * Still a hard bound: a provider that never answers costs 20 s, not a hung build.
 */
export const VISION_READ_CAP_MS = 20_000;
export const NO_PICTURE_READ_CAP_MS = 8_000;

/** The race bound for this turn's attachments. PURE. */
export function visionReadCapMs(images: number): number {
  return images > 0 ? VISION_READ_CAP_MS : NO_PICTURE_READ_CAP_MS;
}

export interface AttachmentLike { name: string; type: string }

/** What reading the pictures came to. `error` is what the race rejected with, if it did. */
export function visionFate(images: number, description: string, error: unknown): VisionFate {
  if (images === 0) return 'no-images';
  if (error) return /timed out/i.test(error instanceof Error ? error.message : String(error)) ? 'timed-out' : 'failed';
  return description.trim() ? 'read' : 'empty';
}

/**
 * The builder's line for pictures nobody could read. '' when there are none. Worded like the sentence
 * `describeVisionAttachments` writes for a picture every provider failed on, so the builder meets one
 * form for one fact.
 */
export function unreadImagesBlock(images: readonly AttachmentLike[]): string {
  return images.map((a) => {
    const label = a.type === 'application/pdf' ? 'PDF' : 'Image';
    return `[${label}: ${a.name} — attached by the user, but it could not be read in time, so what it shows is unknown. `
      + 'Do not describe or imitate it. Tell the user plainly that the attachment could not be read, and ask them to send it again or describe it.]';
  }).join('\n\n');
}

/** The admin report line. PURE. */
export function attachmentsReadNote(p: { files: number; images: number; fate: VisionFate; ms: number; descriptionChars: number }): string {
  const secs = (p.ms / 1000).toFixed(1);
  const head = `${p.files} attachment(s), ${p.images} of them picture(s)/PDF(s).`;
  switch (p.fate) {
    case 'no-images': return `${head} No picture to read — documents were extracted as text.`;
    case 'read': return `${head} Read in ${secs}s (${p.descriptionChars} characters of description reached the builder).`;
    case 'timed-out': return `${head} NOT read — the vision call was abandoned at ${secs}s. The builder was told the picture(s) could not be read.`;
    case 'failed': return `${head} NOT read — the vision call failed after ${secs}s. The builder was told the picture(s) could not be read.`;
    case 'empty': return `${head} NOT read — the vision call returned nothing after ${secs}s. The builder was told the picture(s) could not be read.`;
  }
}
