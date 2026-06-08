export class ImpactAnalyzer {
    analyze(filePaths: string[], graph: any): any {
        const impacted = new Set<string>(filePaths);
        const queue = [...filePaths.map(path => ({ path, depth: 0 }))];
        let maxDepth = 0;
        const entryPoints = new Set<string>();

        while (queue.length > 0) {
            const { path: current, depth } = queue.shift()!;
            maxDepth = Math.max(maxDepth, depth);

            if (current.includes('index') || current.includes('main') || current.includes('App')) {
                entryPoints.add(current);
            }

            const edges = graph.edges.filter((e: any) => e.to === current);
            for (const edge of edges) {
                if (!impacted.has(edge.from)) {
                    impacted.add(edge.from);
                    queue.push({ path: edge.from, depth: depth + 1 });
                }
            }
        }

        const impactedFiles = Array.from(impacted);
        const riskScore = (impactedFiles.length * 5) + (maxDepth * 15) + (entryPoints.size * 20);

        return { 
            impactedFiles, 
            riskScore,
            maxDependencyDepth: maxDepth,
            affectedEntryPoints: Array.from(entryPoints)
        };
    }
}
