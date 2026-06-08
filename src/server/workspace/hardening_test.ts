import { WorkspaceManager } from './WorkspaceManager.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function runHardeningTests() {
    console.log("--- PHASE-1 HARDENING TEST ---\n");
    const manager = new WorkspaceManager();

    // 1. Create structure test
    const wsId = await manager.createWorkspace('hardening-test');
    console.log(`Workspace Created: ${wsId}`);

    // writeFile with nested path
    await manager.writeFile(wsId, 'src/components/NoteEditor.tsx', 'export default function NoteEditor() {}');
    
    // listFiles recursive test
    await manager.writeFile(wsId, 'src/App.tsx', 'import ...');
    await manager.writeFile(wsId, 'src/pages/Home.tsx', 'export ...');

    const files = await manager.listFiles(wsId);
    console.log(`\nRecursive File List:\n${files.map(f => "   " + f).join('\n')}`);

    // Verify file existence
    const exists = files.includes('src/components/NoteEditor.tsx');
    console.log(`\nFile existence check (src/components/NoteEditor.tsx): ${exists}`);

    // Directory management
    await manager.createDirectory(wsId, 'src/services');
    console.log("Directory 'src/services' created");
    
    await manager.deleteWorkspace(wsId);
    console.log("\n--- TEST COMPLETE ---");
}

runHardeningTests().catch(console.error);
