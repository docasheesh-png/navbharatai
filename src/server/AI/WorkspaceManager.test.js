const { WorkspaceManager } = require('./WorkspaceManager');
const fs = require('fs');
const path = require('path');

async function testWorkspaceManager() {
  const manager = new WorkspaceManager();
  const testDir = 'test_workspace';
  const testFile = 'test_workspace/test.txt';

  console.log('Starting WorkspaceManager tests...');

  // Create Directory
  await manager.createDirectory(testDir);
  console.log('Dir created.');

  // Create File
  await manager.createFile(testFile, 'initial content');
  console.log('File created.');

  // Modify File
  await manager.modifyFile(testFile, 'new content');
  console.log('File modified.');

  // Check Reading
  const content = manager.readFile(testFile);
  console.log('Read content:', content);
  if (content !== 'new content') throw new Error('Modification failed!');

  // Rollback
  manager.rollback();
  console.log('Rollback executed.');

  // Verify rollback
  if (fs.existsSync(path.resolve(process.cwd(), testFile))) {
      throw new Error('Rollback failed: file exists');
  }
  if (fs.existsSync(path.resolve(process.cwd(), testDir))) {
      throw new Error('Rollback failed: directory exists');
  }

  console.log('Tests Passed!');
}

testWorkspaceManager().catch(err => {
    console.error('Tests Failed:', err);
    process.exit(1);
});
