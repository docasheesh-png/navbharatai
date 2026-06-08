
import { AppMakerOrchestrator } from './AppMakerLab/AppMakerOrchestrator';
import { WorkspaceManager } from './workspace/WorkspaceManager';
import { join } from 'node:path';

async function runMasterGeneration() {
    console.log("--- MASTER GENERATION: HOSPITAL ---");
    const manager = new WorkspaceManager();
    const wsId = 'hosp-mgmt-v1'; // Dedicated ID for this test
    
    // Cleanup if exists
    try { await manager.deleteWorkspace(wsId); } catch(e) {}
    await manager.createWorkspace('hospital-mgmt'); 

    // Override orchestrator's hardcoded "workspace-1" if possible or just use what it does
    // Actually the orchestrator hardcodes "workspace-1", I need to work with that or fix it.
    // The orchestrator has `workspace-1` hardcoded on line 30, 34, 38, 44, 46.
    
    const result = await AppMakerOrchestrator.execute("Create Hospital Management App");
    
    console.log(`Execution Success: ${result.success}`);
    if (!result.error) console.log(`Error: ${result.error}`);
    
    // Inspect workspace-1 (orchestrator hardcodes this)
    const files = await manager.listFiles('workspace-1');
    console.log(`Exact File Count: ${files.length}`);
    console.log("File Tree:");
    files.forEach(f => console.log(`   ${f}`));
    
    process.exit(0);
}

runMasterGeneration().catch(console.error);
