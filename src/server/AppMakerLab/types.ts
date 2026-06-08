import { BuildManifest } from '../BuildEngine/types';
import { GeneratedFile } from '../BuildEngine/CodeGenerator';

export interface InternalRequirementDTO {
    id: string;
    prompt: string;
    timestamp: number;
    metadata: Record<string, any>;
}

export interface InternalPlanDTO {
    id: string;
    requirementId: string;
    steps: Array<{
        step: string;
        description: string;
    }>;
    manifest: BuildManifest;
}

export interface AppMakerExecutionResult {
    success: boolean;
    files: GeneratedFile[];
    error?: string;
}

export interface BuildResult {
    success: boolean;
    errors: { message: string }[];
}
