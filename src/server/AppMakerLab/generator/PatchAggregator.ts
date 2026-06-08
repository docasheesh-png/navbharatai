import { Patch } from './IGenerationEngine';

export class PatchAggregator {
    private patches: Map<string, string> = new Map();

    addPatches(newPatches: Patch[]) {
        for (const patch of newPatches) {
            this.patches.set(patch.path, patch.content);
        }
    }

    getPatches(): Patch[] {
        // Deterministic ordering by path
        const paths = Array.from(this.patches.keys()).sort();
        return paths.map(path => ({ path, content: this.patches.get(path)! }));
    }
}
