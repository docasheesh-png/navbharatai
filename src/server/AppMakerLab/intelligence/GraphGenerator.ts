import * as path from 'path';
import * as fs from 'fs';

export class GraphGenerator {
    generate(index: any[]): any {
        const nodes: string[] = index.map(i => i.path);
        const edges: { from: string, to: string }[] = [];

        for (const file of index) {
            for (const dep of file.dependencies) {
                const resolved = this.resolve(file.path, dep, nodes);
                if (resolved) {
                    edges.push({ from: file.path, to: resolved });
                }
            }
        }
        return { nodes, edges };
    }

    private resolve(filePath: string, dep: string, allPaths: string[]): string | undefined {
        // Alias resolution (@/...)
        if (dep.startsWith('@/')) {
            const aliasPath = dep.replace('@/', './');
            const candidates = [aliasPath, aliasPath + '.ts', aliasPath + '.tsx', aliasPath + '/index.ts'];
            for (const cand of candidates) {
                const resolved = path.resolve(process.cwd(), cand);
                if (allPaths.includes(resolved)) return resolved;
            }
        }
        // Relative resolution
        if (dep.startsWith('.') || dep.startsWith('..')) {
            const base = path.resolve(path.dirname(filePath), dep);
            const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
            for (const ext of extensions) {
                if (allPaths.includes(base + ext)) return base + ext;
            }
        }
        return undefined;
    }
}
