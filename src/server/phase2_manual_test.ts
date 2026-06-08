
import { FileGenerator } from './AppMakerLab/FileGenerator';
import { WorkspaceManager } from './workspace/WorkspaceManager';
import { ProjectBlueprint } from './AppMakerLab/ProjectBlueprint';

async function runManually() {
    console.log("--- PHASE-2 MANUAL WRITING TEST ---");
    const manager = new WorkspaceManager();
    const wsId = await manager.createWorkspace('notes-app-manual');
    const generator = new FileGenerator(manager);
    
    const blueprint: ProjectBlueprint = {
        name: "Notes App",
        id: "1",
        version: "V3",
        requirementId: "req-1",
        type: "app",
        userRequirement: { prompt: "Create Notes App", persona: "user", goal: "make notes" },
        complexity: { tier: "Low", estimatedModules: 1, riskFactor: 0 },
        generationPlan: { steps: [], phases: [] },
        roles: [], journeys: [], businessRules: [], pages: [], entities: [], apiEndpoints: []
    } as any;

    await generator.generateFiles(wsId, blueprint);
    
    const files = await manager.listFiles(wsId);
    console.log(`Workspace ID: ${wsId}`);
    console.log(`Exact File Count: ${files.length}`);
    console.log("File Tree:");
    files.forEach(f => console.log(`   ${f}`));
    
    console.log("\n--- TEST COMPLETE ---");
}

runManually().catch(console.error);
