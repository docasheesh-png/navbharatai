import crypto from 'crypto';

/**
 * P-BRE.13 — Deterministic / reproducible build verification.
 *
 * Audit tool: given the output files of two builds of the SAME source/commit, hash each file and
 * report whether the two builds are byte-identical, and exactly which files differ. A difference
 * means the build is non-deterministic (embedded timestamps, unlocked transitive deps, map
 * ordering, …) — which undermines audit trails and build caching.
 *
 * Pure + dependency-free (Node `crypto` only) so it is fully unit-tested; a runner can feed it two
 * `dist/` manifests (built twice from the same commit) and alert on any drift.
 */

/** SHA-256 hex of a file's content. */
export function hashContent(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/** Build a path → content-hash manifest from a set of output files. */
export function manifestOf(files: Record<string, string | Buffer>): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) manifest[path] = hashContent(content);
  return manifest;
}

export interface ReproComparison {
  /** True only when the two manifests have the exact same files AND every hash matches. */
  identical: boolean;
  /** Files present in both but with differing content hashes. */
  differing: string[];
  /** Files present only in the first build. */
  onlyInA: string[];
  /** Files present only in the second build. */
  onlyInB: string[];
}

/**
 * Compare two build manifests (path → hash). Returns a precise, sorted diff. `identical` is the
 * single signal a reproducibility gate should alert on.
 */
export function compareManifests(a: Record<string, string>, b: Record<string, string>): ReproComparison {
  const differing: string[] = [];
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  for (const [path, hashA] of Object.entries(a)) {
    if (!(path in b)) onlyInA.push(path);
    else if (b[path] !== hashA) differing.push(path);
  }
  for (const path of Object.keys(b)) {
    if (!(path in a)) onlyInB.push(path);
  }
  differing.sort();
  onlyInA.sort();
  onlyInB.sort();
  return {
    identical: differing.length === 0 && onlyInA.length === 0 && onlyInB.length === 0,
    differing,
    onlyInA,
    onlyInB,
  };
}

/** Convenience: compare two sets of output files directly (hashes them, then diffs). */
export function compareBuilds(
  buildA: Record<string, string | Buffer>,
  buildB: Record<string, string | Buffer>,
): ReproComparison {
  return compareManifests(manifestOf(buildA), manifestOf(buildB));
}
