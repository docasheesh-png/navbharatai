
import { AppMakerOrchestrator } from './AppMakerLab/AppMakerOrchestrator';
import { WorkspaceManager } from './workspace/WorkspaceManager';

async function runPhase2Test() {
    console.log("--- PHASE-2 REAL FILE GENERATION TEST ---");
    const manager = new WorkspaceManager();
    const wsId = await manager.createWorkspace('notes-app-test');
    
    // Testing the orchestrator integration
    const result = await AppMakerOrchestrator.execute("Create Notes App");
    
    console.log(`Workspace ID: ${wsId}`);
    console.log(`Workspace Path: ${process.cwd()}/workspaces/${wsId}`);
    
    const files = await manager.listFiles(wsId);
    console.log(`Exact File Count: ${files.length}`);
    console.log("File Tree:");
    files.forEach(f => console.log(`   ${f}`));
    
    console.log("\n--- REPORT COMPLETE ---");
}

runPhase2Test().catch(console.error);
