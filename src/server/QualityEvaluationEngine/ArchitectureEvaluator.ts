import { RepositoryIntelligenceEngine } from '../AppMakerLab/intelligence/RepositoryIntelligenceEngine';

export class ArchitectureEvaluator {
    private engine = new RepositoryIntelligenceEngine();

    async evaluate(workspaceId: string): Promise<{ status: 'PASS' | 'FAIL', errors: string[], cycles: string[], unresolvedImports: string[], violations: string[] }> {
        try {
            await this.engine.indexRepository();
            const graph = await this.engine.getDependencyGraph();
            const index = await this.engine.getIndex();
            const errors: string[] = [];
            const cycles: string[] = [];
            const unresolvedImports: string[] = [];
            const violations: string[] = [];

            // 1. Cycle detection
            const visited = new Set<string>();
            const recStack = new Set<string>();
            const path: string[] = [];

            const dfs = (node: string): boolean => {
                visited.add(node);
                recStack.add(node);
                path.push(node);

                for (const neighbor of (graph[node] || [])) {
                    if (!visited.has(neighbor)) {
                        if (dfs(neighbor)) return true;
                    } else if (recStack.has(neighbor)) {
                        path.push(neighbor);
                        cycles.push(path.slice(path.indexOf(neighbor)).join(' -> '));
                        return true;
                    }
                }
                recStack.delete(node);
                path.pop();
                return false;
            };

            for (const node of Object.keys(graph)) {
                if (!visited.has(node)) dfs(node);
            }

            // 2. Unresolved imports
            for (const [file, imports] of Object.entries(graph)) {
                for (const imp of imports) {
                    if (!index.includes(imp)) {
                        unresolvedImports.push(`${file} -> ${imp}`);
                    }
                }
            }

            // 3. Architecture violations (frontend imports backend)
            for (const [file, imports] of Object.entries(graph)) {
                if (file.includes('src/client') || file.includes('src/App.tsx')) {
                    for (const imp of imports) {
                        if (imp.includes('src/server')) {
                            violations.push(`Front-end module ${file} imports back-end module ${imp}`);
                        }
                    }
                }
            }

            if (cycles.length > 0) errors.push(`Detected ${cycles.length} dependency cycles`);
            if (unresolvedImports.length > 0) errors.push(`Detected ${unresolvedImports.length} unresolved imports`);
            if (violations.length > 0) errors.push(`Detected ${violations.length} architecture violations`);

            return { status: errors.length === 0 ? 'PASS' : 'FAIL', errors, cycles, unresolvedImports, violations };
        } catch (e: any) {
            return { status: 'FAIL', errors: [e.message], cycles: [], unresolvedImports: [], violations: [] };
        }
    }
}
