export interface FileGeneratorInstruction {
    path: string;
    template: string;
    description: string;
}

export interface FileGenerationPlan {
    files: FileGeneratorInstruction[];
}

import { ProjectBlueprint } from '../ProjectBlueprint';

export class FilePlanningEngine {
    static plan(blueprint: ProjectBlueprint): FileGenerationPlan {
        const files: FileGeneratorInstruction[] = [];

        // Pages
        blueprint.pages.forEach(page => {
            files.push({
                path: `src/pages/${page.name}.tsx`,
                template: 'PageTemplate',
                description: `Page component for ${page.name}`
            });
        });

        // Entities -> Types + Services + Hooks
        blueprint.entities.forEach(entity => {
            files.push({
                path: `src/types/${entity.name}.ts`,
                template: 'TypeTemplate',
                description: `TypeScript interface for ${entity.name}`
            });
            files.push({
                path: `src/services/${entity.name}Service.ts`,
                template: 'ServiceTemplate',
                description: `Service for ${entity.name}`
            });
            files.push({
                path: `src/hooks/use${entity.name}.ts`,
                template: 'HookTemplate',
                description: `Custom hook for ${entity.name}`
            });
        });

        // Auth
        if (blueprint.auth?.enabled) {
            files.push({ path: `src/pages/auth/Login.tsx`, template: 'PageTemplate', description: `Login page` });
            files.push({ path: `src/services/authService.ts`, template: 'ServiceTemplate', description: `Authentication service` });
        }

        // Database
        if (blueprint.database?.enabled) {
            blueprint.entities.forEach(entity => {
                files.push({ path: `src/repository/${entity.name}Repository.ts`, template: 'RepositoryTemplate', description: `Repository for ${entity.name}` });
            });
        }

        // Features -> Components/Hooks/Services
        blueprint.features?.forEach(feature => {
            if (feature.includes('chat')) {
                files.push({ path: `src/components/chat/ChatWindow.tsx`, template: 'ComponentTemplate', description: `Chat window` });
                files.push({ path: `src/hooks/useChat.ts`, template: 'HookTemplate', description: `Chat hook` });
            }
            if (feature.includes('tuner') || feature.includes('playback')) {
                files.push({ path: `src/components/player/PlaybackControls.tsx`, template: 'ComponentTemplate', description: `Playback controls` });
                files.push({ path: `src/hooks/useAudio.ts`, template: 'HookTemplate', description: `Audio hook` });
            }
        });

        // Integrations -> Service Adapters
        blueprint.integrations?.forEach(integration => {
            files.push({ path: `src/services/adapters/${integration}Adapter.ts`, template: 'AdapterTemplate', description: `Adapter for ${integration}` });
        });

        // APIs
        blueprint.apiEndpoints.forEach(api => {
            files.push({
                path: `src/api/${api.path.replace('/api/', '')}.ts`,
                template: 'ApiRouteTemplate',
                description: `API endpoint for ${api.path}`
            });
        });

        return { files };
    }
}
