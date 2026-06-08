import { InternalRequirementDTO, InternalPlanDTO } from './types';
import { BuildManifest } from '../BuildEngine/types';

export class ManifestMapper {
    static map(requirement: InternalRequirementDTO, plan: InternalPlanDTO): BuildManifest {
        const prompt = requirement.prompt.toLowerCase();
        
        // Define base files based on requirement prompt
        let filesToGenerate: string[] = ['src/App.tsx'];
        let components: string[] = [];
        let features: string[] = [];
        let dependencies: string[] = [];

        if (prompt.includes('calculator')) {
            filesToGenerate.push('src/components/Calculator.tsx');
            components.push('Calculator');
            features.push('calculator-ui');
            dependencies.push('lucide-react');
        }

        return {
            projectType: 'react-spa',
            features: features,
            components: components,
            logicHandlers: [],
            filesToGenerate: filesToGenerate,
            dependencies: dependencies
        };
    }
}
