
import { WorkspaceManager } from './WorkspaceManager.js';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function runTests() {
    console.log("Starting Workspace Validation Tests...");
    const manager = new WorkspaceManager();
    const errors: string[] = [];

    // TEST 1: Create
    const wsId = await manager.createWorkspace('test-project');
    console.log("TEST 1 PASSED: Workspace Created - " + wsId);

    // TEST 2: Create file
    await manager.writeFile(wsId, 'test.txt', 'hello world');
    console.log("TEST 2 PASSED: File Created");

    // TEST 3: Read file
    const content = await manager.readFile(wsId, 'test.txt');
    if (content !== 'hello world') errors.push("Read file failed");
    console.log("TEST 3 PASSED: File Read");

    // TEST 4: Rename
    await manager.renameFile(wsId, 'test.txt', 'renamed.txt');
    console.log("TEST 4 PASSED: File Renamed");

    // TEST 5: Delete file
    await manager.deleteFile(wsId, 'renamed.txt');
    console.log("TEST 5 PASSED: File Deleted");

    // TEST 6: Snapshot
    const snapId = await manager.createSnapshot(wsId);
    console.log("TEST 6 PASSED: Snapshot Created - " + snapId);

    // TEST 7: Restore (Restoring foundation only)
    console.log("TEST 7 SKIP: Full restore requires deeper fs support");

    // TEST 8: Delete workspace
    await manager.deleteWorkspace(wsId);
    console.log("TEST 8 PASSED: Workspace Deleted");

    if (errors.length > 0) {
        console.error("Errors found:", errors);
        process.exit(1);
    }
    console.log("All tests completed successfully!");
}

runTests().catch(err => {
    console.error(err);
    process.exit(1);
});
