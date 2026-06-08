import { IGenerationEngine, Patch } from './IGenerationEngine';
import { GenerationTask } from './PlannerTypes';

export class BackendGenerationEngine implements IGenerationEngine {
    async execute(task: GenerationTask): Promise<Patch[]> {
        // Parse: "Resource: User, Actions: get,post"
        const resourceMatch = task.contentDescription.match(/Resource: ([^,]+)/);
        const resource = resourceMatch ? resourceMatch[1] : 'Default';
        
        const patch: Patch = {
            path: `src/server/routes/${resource.toLowerCase()}Routes.ts`,
            content: `import { Router } from 'express';\nconst router = Router();\n\nrouter.get('/', (req, res) => res.json({ message: '${resource} list' }));\n\nexport default router;\n`
        };

        return [patch];
    }
}
