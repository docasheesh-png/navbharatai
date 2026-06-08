import { CodeGeneratorV2 as CodeGenerator } from './BuildEngine/CodeGenerator.js';
import { BuildPlan } from './AI/RequestAnalyzer.js';
import { BuildManifest } from './BuildEngine/types.js';

const generator = new CodeGenerator();

const apps = [
  { 
    name: 'Calculator', 
    plan: {
        projectType: 'frontend-app',
        frontendRequired: true,
        backendRequired: false,
        databaseRequired: false,
        directories: ['src/components'],
        files: [
          { path: 'src/components/Calculator.tsx', purpose: 'Calculator UI' }
        ],
        features: ['Core UI']
    } as BuildPlan
  },
  { 
    name: 'Digital Clock', 
    plan: {
        projectType: 'frontend-app',
        frontendRequired: true,
        backendRequired: false,
        databaseRequired: false,
        directories: ['src/components'],
        files: [
          { path: 'src/components/Clock.tsx', purpose: 'Clock UI' }
        ],
        features: ['Core UI']
    } as BuildPlan
  },
  { 
    name: 'Inventory System', 
    plan: {
        projectType: 'full-stack-app',
        frontendRequired: true,
        backendRequired: true,
        databaseRequired: true,
        directories: ['src/components', 'src/server'],
        files: [
          { path: 'src/App.tsx', purpose: 'Main App' },
          { path: 'src/server/server.ts', purpose: 'Backend Server' }
        ],
        features: ['Core UI', 'data-persistence', 'api-routes']
    } as BuildPlan
  }
];

apps.forEach(app => {
    console.log(`\n=== Testing: ${app.name} ===`);
    const manifest: BuildManifest = {
        projectType: app.plan.projectType,
        features: app.plan.features,
        components: [],
        logicHandlers: [],
        filesToGenerate: app.plan.files.map(f => f.path),
        dependencies: []
    };
    const files = generator.generate(manifest);
    files.forEach(file => {
        console.log(`Path: ${file.path}`);
        console.log(`Content:\n${file.content}\n`);
    });
});
