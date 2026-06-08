import { ProjectBlueprint } from '../ProjectBlueprint';
import { Pattern, TechnologyArchitectureBlueprint } from './PatternTypes';

export class ArchitectureSelector {
    select(blueprint: ProjectBlueprint, rankedPatterns: { pattern: Pattern, score: number, matchedConstraints: string[], rejectedConstraints: string[] }[]): TechnologyArchitectureBlueprint {
        const { pattern, score, matchedConstraints, rejectedConstraints } = rankedPatterns[0];
        
        return {
            stack: pattern.defaultStack,
            score,
            matchedConstraints,
            rejectedConstraints,
            rationale: [`Selected pattern: ${pattern.id} due to highest score: ${score}`]
        };
    }
}
