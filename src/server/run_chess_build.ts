
import { RequestAnalyzer } from './AI/RequestAnalyzer';
import { FeatureComposer } from './BuildEngine/FeatureComposer';
import { DependencyResolver } from './BuildEngine/DependencyResolver';
import { BuildManifestGenerator } from './BuildEngine/BuildManifestGenerator';
import { CodeGeneratorV2 } from './BuildEngine/CodeGenerator';
import { WorkspaceManager } from './AI/WorkspaceManager';
import { BuildVerifier } from './BuildEngine/BuildVerifier';

async function runEndToEnd() {
  const request = 'Build a chess game';
  
  // 1. Resolve Plan
  const analyzer = new RequestAnalyzer();
  const buildPlan = analyzer.analyze(request);
  const composer = new FeatureComposer();
  const features = composer.compose(request);
  const resolver = new DependencyResolver();
  const resolvedFeatures = resolver.resolve(features);
  const manifestGenerator = new BuildManifestGenerator();
  
  // Custom manifest for the chess demo
  const manifest = {
      projectType: 'full-stack-app',
      features: ['game-logic'],
      components: ['ChessBoard', 'GameEngine'],
      logicHandlers: ['socket'],
      filesToGenerate: [
          'src/components/ChessBoard.tsx',
          'src/server/game/Engine.ts'
      ],
      dependencies: ['chess.js']
  };

  // 2. Generate
  const codeGenerator = new CodeGeneratorV2();
  const files = codeGenerator.generate(manifest);
  
  // 3. Write via WorkspaceManager
  const manager = new WorkspaceManager();
  console.log('Writing files...');
  for (const file of files) {
      await manager.createFile(file.path, file.content, true);
      console.log(`Created: ${file.path}`);
  }

  // 4. Verify
  const verifier = new BuildVerifier();
  const targets = manifest.filesToGenerate.map(f => ({ filePath: f, verificationType: 'exists' as const }));
  
  const success = verifier.verify(targets);
  console.log('Build Verification Result:', success ? 'Success' : 'Failure');
}

runEndToEnd().catch(console.error);
