import { GenerationTask } from './PlannerTypes';

export interface Patch {
    path: string;
    content: string;
}

export interface IGenerationEngine {
    execute(task: GenerationTask): Promise<Patch[]>;
}
