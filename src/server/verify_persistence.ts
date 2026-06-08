
import { WorkspaceManager } from './AI/WorkspaceManager';
import fs from 'fs';
import path from 'path';

async function verify() {
  const manager = new WorkspaceManager();
  const memPath = path.join(process.cwd(), 'project_memory.json');
  console.log('Memory Path:', memPath);

  // Trigger update - cleanup first to be sure it's fresh
  try { if (fs.existsSync(memPath)) fs.unlinkSync(memPath); } catch(e) {}
  
  await manager.createFile('test-memory.txt', 'test content', true);

  // Verify persistence
  const exists = fs.existsSync(memPath);
  console.log('project_memory.json exists:', exists);

  if (exists) {
    console.log('Contents:', fs.readFileSync(memPath, 'utf-8'));
  }
}

verify().catch(console.error);
