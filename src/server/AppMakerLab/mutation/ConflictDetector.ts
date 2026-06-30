import { WorkspacePatchBatch } from './MutationTypes';

// P-CGE.1 — real conflict detection (was a stub that always returned false).
//
// A batch conflicts when two or more patches target the SAME path — applying them in sequence is
// last-write-wins, silently dropping one patch's changes. Detecting this lets the caller merge or
// reject instead of losing work. Pure + dependency-free.
export class ConflictDetector {
    /** True if any path is targeted by more than one patch in the batch. */
    detectConflicts(batch: WorkspacePatchBatch): boolean {
        return this.conflictingPaths(batch).length > 0;
    }

    /** The set of paths that appear in more than one patch (the actual conflicts). */
    conflictingPaths(batch: WorkspacePatchBatch): string[] {
        const patches = batch?.patches;
        if (!Array.isArray(patches) || patches.length < 2) return [];
        const counts = new Map<string, number>();
        for (const p of patches) {
            const path = p?.path;
            if (typeof path !== 'string' || !path) continue;
            counts.set(path, (counts.get(path) ?? 0) + 1);
        }
        const out: string[] = [];
        for (const [path, n] of counts) if (n > 1) out.push(path);
        return out;
    }
}
