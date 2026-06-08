
import { Feature, BuildManifest } from './types';

export class BuildManifestGenerator {
  generate(projectType: string, resolvedFeatures: Feature[]): BuildManifest {
    const features: string[] = resolvedFeatures.map(f => f.id);
    const components: string[] = Array.from(new Set(resolvedFeatures.flatMap(f => f.components)));
    const logicHandlers: string[] = Array.from(new Set(resolvedFeatures.flatMap(f => f.logicHandlers.map(l => l.category))));
    
    // In real generation, files would be derived from features+components
    const filesToGenerate: string[] = ['src/App.tsx', 'src/index.css'];
    if (features.includes('api-routes')) filesToGenerate.push('src/server/server.ts');
    
    return {
      projectType,
      features,
      components,
      logicHandlers,
      filesToGenerate,
      dependencies: ['react', 'tailwindcss']
    };
  }
}
