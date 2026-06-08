import fs from 'fs';
import path from 'path';
import { WorkspaceManager } from './WorkspaceManager';

async function runTest() {
  const manager = new WorkspaceManager();
  const testDir = 'test_workspace_2';
  const testFile = 'test_workspace_2/test.txt';

  // Cleanup from previous run if necessary
  if (fs.existsSync(path.resolve(process.cwd(), testDir))) {
     // Use built-in recursive rm if available (Node 14+), or manual
     fs.rmSync(path.resolve(process.cwd(), testDir), { recursive: true, force: true });
  }

  await manager.createDirectory(testDir);
  await manager.createFile(testFile, 'initial');
  await manager.modifyFile(testFile, 'modified');
  
  if (manager.readFile(testFile) !== 'modified') throw new Error('Failed content check');
  
  // Test Security Jail
  try {
      await manager.createFile('../out_of_bounds.txt', 'hacking');
      throw new Error('Security check FAILED');
  } catch (e) {
      console.log('Security check passed: jail enforced');
  }

  manager.rollback();
  if (fs.existsSync(path.resolve(process.cwd(), testFile))) throw new Error('Rollback failed');
  if (fs.existsSync(path.resolve(process.cwd(), testDir))) throw new Error('Rollback failed');
  
  console.log('Verification Passed!');
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
