import { InternalRequirementDTO } from './types';
import { ProjectBlueprint } from './ProjectBlueprint';

export class BlueprintBuilder {
    static build(requirement: InternalRequirementDTO): ProjectBlueprint {
        // Generic mapping based on prompt
        const prompt = requirement.prompt.toLowerCase();
        
        return {
            version: "V3",
            id: `bp_${requirement.id}`,
            requirementId: requirement.id,
            name: "Generated Project",
            type: "App",
            userRequirement: {
                prompt: requirement.prompt,
                persona: "Generic User",
                goal: prompt
            },
            complexity: {
                tier: "Medium",
                estimatedModules: 5,
                riskFactor: 0.5
            },
            generationPlan: {
                steps: [{ name: "Initialization", description: "Project setup" }],
                phases: [{ name: "Drafting", deliverables: ["Architecture"] }]
            },
            roles: [],
            journeys: [],
            businessRules: [],
            pages: [],
            entities: [],
            apiEndpoints: [],
            requirements: {
                testing: [],
                deployment: [],
                monitoring: []
            }
        };
    }
}
