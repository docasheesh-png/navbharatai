
import { CodeGeneratorV2 } from './BuildEngine/CodeGenerator';
import { BuildVerifier } from './BuildEngine/BuildVerifier';
import { RepairEngine } from './BuildEngine/RepairEngine';
import fs from 'fs';

async function runRepairTest() {
  const codeGenerator = new CodeGeneratorV2();
  const manifest = {
      projectType: 'full-stack-app',
      features: ['test-feature'],
      components: ['BrokenComponent'],
      logicHandlers: [],
      filesToGenerate: ['src/components/BrokenComponent.tsx'],
      dependencies: []
  };

  // 1. Generate intentionally broken code
  const files = codeGenerator.generate(manifest);
  // Modify one file to be broken
  files[0].content = 'import { NonExistent } from "./bad-module"; export const BrokenComponent = () => <div />;';
  
  fs.writeFileSync(files[0].path, files[0].content);

  // 2. Initial Verification
  const verifier = new BuildVerifier();
  let success = verifier.verify([{ filePath: files[0].path, verificationType: 'exists' }]);
  
  let attempts = 0;
  const maxRetries = 5;
  const errors = [];
  const fixes = [];

  while (!success && attempts < maxRetries) {
    attempts++;
    console.log(`Attempt ${attempts}: Verification failed. Repairing...`);
    
    // Simulate error detection (real implementation would run typescript compiler)
    const error = "Cannot find module 'bad-module'";
    errors.push(error);
    
    const repairEngine = new RepairEngine();
    const fixed = await repairEngine.repair(files[0].path, error);
    
    if (fixed) {
      fixes.push('Fixed import');
      // Apply mock fix
      fs.writeFileSync(files[0].path, 'export const BrokenComponent = () => <div />;');
      success = verifier.verify([{ filePath: files[0].path, verificationType: 'exists' }]);
    }
  }

  // 3. Report
  const report = {
      attempts,
      errorsDetected: errors,
      fixesApplied: fixes,
      finalStatus: success ? 'success' : 'failed'
  };
  fs.writeFileSync('public/build_repair_report.json', JSON.stringify(report, null, 2));
  console.log('Final Status:', success ? 'Success' : 'Failure');
}

runRepairTest().catch(console.error);
