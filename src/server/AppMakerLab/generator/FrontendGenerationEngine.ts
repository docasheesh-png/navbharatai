import { IGenerationEngine, Patch } from './IGenerationEngine';
import { GenerationTask } from './PlannerTypes';

export class FrontendGenerationEngine implements IGenerationEngine {
    async execute(task: GenerationTask): Promise<Patch[]> {
        // Parse simple content description: "Page: X, Components: Y,Z"
        const pageMatch = task.contentDescription.match(/Page: ([^,]+)/);
        const componentsMatch = task.contentDescription.match(/Components: ([^,]+(,[^,]+)*)/);
        
        const pageName = pageMatch ? pageMatch[1] : 'AppPage';
        const components = componentsMatch ? componentsMatch[1].split(',') : [];

        const patches: Patch[] = [];

        // Generate Page
        patches.push({
            path: `src/pages/${pageName}.tsx`,
            content: `import React from 'react';\nimport { ${components.join(', ')} } from '../components/${pageName}Components';\n\nexport const ${pageName} = () => (\n  <div className="p-4">\n    <h1>${pageName}</h1>\n    ${components.map(c => `    <${c.trim()} />`).join('\n')}\n  </div>\n);\n`
        });

        // Generate Components
        patches.push({
            path: `src/components/${pageName}Components.tsx`,
            content: `${components.map(c => `export const ${c.trim()} = () => <div>${c.trim()}</div>;`).join('\n')}\n`
        });

        return patches;
    }
}
