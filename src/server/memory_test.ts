import { WorkspaceManager } from './AI/WorkspaceManager';
import fs from 'fs';
import path from 'path';

async function runMemoryTest() {
  const manager = new WorkspaceManager();
  const memoryPath = path.join(process.cwd(), 'project_memory.json');

  // Step 1: Build CRM
  console.log('Step 1: Build CRM...');
  await manager.createFile('src/pages/Dashboard.tsx', 'export default function Dashboard() { return <div />; }', true);
  
  const memory1 = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
  console.log('Memory after Step 1:', memory1.files);

  // Step 2: Add Employee Dashboard
  console.log('Step 2: Add Employee Dashboard...');
  await manager.createFile('src/pages/Employees.tsx', 'export default function Employees() { return <div />; }', true);
  
  const memory2 = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
  console.log('Memory after Step 2:', memory2.files);

  if (memory2.files.includes('src/pages/Dashboard.tsx') && memory2.files.includes('src/pages/Employees.tsx')) {
      console.log('Test Passed: CRM preserved and dashboard added.');
  } else {
      console.log('Test Failed: CRM lost or dashboard not added.');
  }
}

runMemoryTest().catch(console.error);
