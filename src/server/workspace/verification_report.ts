import { WorkspaceManager } from './WorkspaceManager.js';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function runReport() {
    console.log("--- PHASE-1 VERIFICATION REPORT ---\n");
    const manager = new WorkspaceManager();

    // 2. Execute createWorkspace
    const wsId = await manager.createWorkspace('notes-app-project');
    const wsPath = join(process.cwd(), 'workspaces', wsId);
    console.log(`2. WORKSPACE_ID: ${wsId}`);
    console.log(`   WORKSPACE_PATH: ${wsPath}\n`);

    // 3. writeFile
    await manager.writeFile(wsId, 'hello.txt', 'hello world');
    const files = await manager.listFiles(wsId);
    console.log(`3. File "hello.txt" exists: ${files.includes('hello.txt')}\n`);

    // 4. readFile
    const content = await manager.readFile(wsId, 'hello.txt');
    console.log(`4. Read File Content: ${content}\n`);

    // 5. renameFile
    await manager.renameFile(wsId, 'hello.txt', 'hello_renamed.txt');
    const filesAfterRename = await manager.listFiles(wsId);
    console.log(`5. Rename:`);
    console.log(`   Before: "hello.txt" (in list: ${files.includes('hello.txt')})`);
    console.log(`   After: "hello_renamed.txt" (in list: ${filesAfterRename.includes('hello_renamed.txt')})\n`);

    // 6. createSnapshot
    const snapId = await manager.createSnapshot(wsId);
    const snapPath = join(wsPath, '.snapshots', snapId);
    console.log(`6. Snapshot Created. Path: ${snapPath}\n`);

    // 7. Modify File
    await manager.writeFile(wsId, 'hello_renamed.txt', 'content modified');
    const modifiedContent = await manager.readFile(wsId, 'hello_renamed.txt');
    console.log(`7. File modified. New content: ${modifiedContent}\n`);

    // 8. restoreSnapshot
    await manager.restoreSnapshot(wsId, snapId);
    const restoredContent = await manager.readFile(wsId, 'hello_renamed.txt');
    console.log(`8. RestoreSnapshot:`);
    console.log(`   Before: "content modified"`);
    console.log(`   After: "${restoredContent}"\n`);

    // 9. Filesystem Tree
    console.log(`9. Filesystem Tree:`);
    const tree = await readdir(wsPath, { recursive: true });
    console.log(tree.map(t => "   " + t).join('\n'));
    console.log();

    console.log("--- REPORT COMPLETE ---");
}

runReport().catch(console.error);
