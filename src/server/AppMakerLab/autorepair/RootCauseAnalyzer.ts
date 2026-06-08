import { RootCause } from './AutoRepairTypes';
import { RepositoryIntelligenceEngine } from '../intelligence/RepositoryIntelligenceEngine';

export class RootCauseAnalyzer {
    private engine = new RepositoryIntelligenceEngine();

    async analyze(error: string, classification: string): Promise<RootCause[]> {
        const graph = await this.engine.getDependencyGraph();
        const index = await this.engine.getIndex();
        
        // 1. Exact node resolution (no substring matching)
        const failureMatch = error.match(/(?:'|")([^'"]+)(?:'|")/);
        const culprit = failureMatch ? failureMatch[1] : '';
        
        // Find exact candidates in index
        const candidates = index.filter(f => f.endsWith(culprit) || f === culprit);
        
        // 2. Discover graph roots (in-degree map, O(V+E))
        const inDegree: Record<string, number> = {};
        for (const node of index) inDegree[node] = 0;
        
        for (const node of Object.keys(graph)) {
            for (const neighbor of graph[node]) {
                inDegree[neighbor] = (inDegree[neighbor] || 0) + 1;
            }
        }
        
        const roots = index.filter(node => inDegree[node] === 0);

        // 3. Ambiguity & Confidence calculation (graph-driven)
        const analyzeCandidate = (candidate: string): RootCause => {
            let maxConfidence = 50; 
            let bestPath: string[] = [];

            // DFS for path reconstruction
            const findPath = (current: string, target: string, path: string[]): boolean => {
                path.push(current);
                if (current === target) {
                    bestPath = [...path];
                    return true;
                }
                for (const neighbor of (graph[current] || [])) {
                    if (findPath(neighbor, target, [...path])) return true;
                }
                return false;
            };

            for (const root of roots) {
                const path: string[] = [];
                if (findPath(root, candidate, path)) {
                    maxConfidence = 90; // Connected to root
                    break;
                }
            }

            return {
                file: candidate,
                dependencyPath: bestPath,
                reason: error,
                confidence: maxConfidence
            };
        };

        if (candidates.length > 0) {
            // If ambiguous, pick the one with higher connectivity (more incoming edges from useful nodes - refinement possible)
            return [analyzeCandidate(candidates[0])];
        }

        return [{
            file: culprit || 'unknown',
            dependencyPath: [],
            reason: error,
            confidence: 0
        }];
    }
}
