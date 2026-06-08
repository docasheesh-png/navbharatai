
import { FileGenerator } from './AppMakerLab/FileGenerator';
import { WorkspaceManager } from './workspace/WorkspaceManager';
import { ProjectBlueprint } from './AppMakerLab/ProjectBlueprint';
import { join } from 'node:path';

async function runVerification() {
    console.log("--- PHASE-2 VERIFICATION TEST ---");
    const manager = new WorkspaceManager();
    const generator = new FileGenerator(manager);
    
    // Test 1: Notes App
    const wsId1 = await manager.createWorkspace('notes-app-verify');
    const blueprint1: ProjectBlueprint = { name: "Notes App" } as any;
    await generator.generateFiles(wsId1, blueprint1);
    const files1 = await manager.listFiles(wsId1);
    
    // Test 2: Hospital App
    const wsId2 = await manager.createWorkspace('hospital-app-verify');
    const blueprint2: ProjectBlueprint = { name: "Hospital Management App" } as any;
    await generator.generateFiles(wsId2, blueprint2);
    const files2 = await manager.listFiles(wsId2);
    
    console.log(`\nNotes App File Tree:`);
    files1.forEach(f => console.log(`   ${f}`));
    
    console.log(`\nHospital App File Tree:`);
    files2.forEach(f => console.log(`   ${f}`));
    
    console.log("\n--- REPORT COMPLETE ---");
}

runVerification().catch(console.error);
