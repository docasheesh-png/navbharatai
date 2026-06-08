import { IGenerationEngine, Patch } from './IGenerationEngine';
import { GenerationTask } from './PlannerTypes';

export class DatabaseGenerationEngine implements IGenerationEngine {
    async execute(task: GenerationTask): Promise<Patch[]> {
        // Parse: "Entity: User, Fields: id:string,name:string"
        const entityMatch = task.contentDescription.match(/Entity: ([^,]+)/);
        const entity = entityMatch ? entityMatch[1] : 'DefaultEntity';
        
        const patch: Patch = {
            path: `src/server/db/schema/${entity.toLowerCase()}.ts`,
            content: `export interface ${entity} {\n  id: string;\n  createdAt: Date;\n}\n`
        };

        return [patch];
    }
}
