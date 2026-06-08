import { ProjectBlueprint } from '../ProjectBlueprint';
import { StructuredRequirementModel } from '../types/RequirementModels';

export class BlueprintBuilder {
    static build(model: StructuredRequirementModel): ProjectBlueprint {
        const modules: Record<string, { type: 'FRONTEND' | 'BACKEND' | 'DATABASE' | 'AUTH' | 'CONFIG'; dependencies: string[] }> = {
            "Frontend": { type: 'FRONTEND', dependencies: ["Backend"] },
            "Backend": { type: 'BACKEND', dependencies: ["Database"] },
            "Database": { type: 'DATABASE', dependencies: [] }
        };

        // Inference logic
        if (model.auth.enabled) {
            modules["Authentication"] = { type: 'AUTH', dependencies: ["Backend"] };
            modules["Backend"].dependencies.push("Authentication");
        }
        if (model.features.includes('chat') || model.features.includes('real-time-chat')) {
            modules["Messaging"] = { type: 'FRONTEND', dependencies: ["Backend"] };
        }
        if (model.apis.length > 0) {
            modules["Logic"] = { type: 'BACKEND', dependencies: ["Database"] };
        }

        return {
            version: "V3",
            id: `proj_${Date.now()}`,
            requirementId: `req_${Date.now()}`,
            name: "Generated Project",
            type: model.projectType || "react-spa",
            userRequirement: { prompt: model.domain, persona: "System", goal: "Build" },
            complexity: { tier: "Low", estimatedModules: Object.keys(modules).length, riskFactor: 0 },
            generationPlan: { 
                steps: [], 
                phases: [] 
            },
            roles: [],
            journeys: [],
            businessRules: [],
            pages: model.pages.map(c => ({ path: `/${c.toLowerCase()}`, name: c, components: [c] })),
            entities: model.entities.map(e => ({ name: e })),
            apiEndpoints: model.apis.map(h => ({ path: `/api/${h.toLowerCase()}`, method: "POST", description: `Handler for ${h}` })),
            auth: model.auth,
            database: model.database,
            integrations: model.integrations,
            requirements: { testing: [], deployment: [], monitoring: [] },
            modules: modules
        };
    }
}
