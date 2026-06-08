import { ProjectBlueprint } from '../ProjectBlueprint';
import { Pattern } from './PatternTypes';
import { PATTERN_LIBRARY } from './PatternLibrary';

export class PatternMatcher {
    match(blueprint: ProjectBlueprint): { pattern: Pattern, score: number, matchedConstraints: string[], rejectedConstraints: string[] }[] {
        const isRealtime = blueprint.features.includes('messaging') || blueprint.technologyRequirements.includes('socket.io');
        const isMobile = blueprint.metadata.applicationType === 'mobile-application';
        const isComplex = blueprint.features.length > 5;

        return PATTERN_LIBRARY.map(p => {
            let score = 0;
            const matchedConstraints: string[] = [];
            const rejectedConstraints: string[] = [];

            if (isRealtime) {
                if (p.supportsRealtime) { score += 50; matchedConstraints.push('realtime'); }
                else { score -= 100; rejectedConstraints.push('realtime'); }
            }
            if (isMobile) {
                if (p.supportsFrontend.includes('React Native')) { score += 50; matchedConstraints.push('mobile'); }
                else { score -= 100; rejectedConstraints.push('mobile'); }
            }
            if (isComplex && p.supportsBackend.includes('NestJS')) { score += 20; matchedConstraints.push('scalability'); }

            return { pattern: p, score, matchedConstraints, rejectedConstraints };
        }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score);
    }
}
