/**
 * Version snapshot helpers — pure logic extracted from App.tsx.
 *
 * A "version snapshot" is a lightweight, revertible record of a build: the
 * generated files (with base64 image data stripped to stay small), a short
 * label, and metadata. The localStorage read/write stays in the component;
 * everything here is pure and unit-testable.
 */

export interface VersionSnapshot {
  id: string;
  name: string;
  code: string;
  files: Record<string, string>;
  timestamp: number;
  label: string;
  size: number;
}

const BASE64_IMAGE_RE = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;

/** Max number of snapshots retained in the version stack. */
export const MAX_VERSION_SNAPSHOTS = 10;

/**
 * Build a single version snapshot from a build request + the files it produced.
 * Returns null when there are no files to snapshot. Base64 image data-URLs are
 * replaced with "(image)" so stored versions stay lean.
 */
export function buildVersionSnapshot(
  buildRequest: string,
  builtFiles: Record<string, string>,
  now: number = Date.now(),
): VersionSnapshot | null {
  if (!builtFiles || Object.keys(builtFiles).length === 0) return null;

  const allContent = Object.values(builtFiles).join('');
  const strippedFiles = Object.fromEntries(
    Object.entries(builtFiles).map(([k, v]) => [k, v.replace(BASE64_IMAGE_RE, '(image)')]),
  );

  return {
    id: now.toString(),
    name: `Build: ${buildRequest.slice(0, 40)}`,
    code: (builtFiles['index.html'] || allContent).slice(0, 5000),
    files: strippedFiles,
    timestamp: now,
    label: 'build',
    size: allContent.length,
  };
}

/**
 * Prepend a snapshot to the existing list and cap the result at `max` entries
 * (newest first). Pure — does not mutate `existing`.
 */
export function appendVersionSnapshot(
  snapshot: VersionSnapshot,
  existing: VersionSnapshot[],
  max: number = MAX_VERSION_SNAPSHOTS,
): VersionSnapshot[] {
  return [snapshot, ...existing].slice(0, max);
}
