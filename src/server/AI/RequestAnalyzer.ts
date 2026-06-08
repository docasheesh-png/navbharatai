
export interface FilePlan {
  path: string;
  purpose: string;
}

export interface BuildPlan {
  projectType: string;
  frontendRequired: boolean;
  backendRequired: boolean;
  databaseRequired: boolean;
  directories: string[];
  files: FilePlan[];
  features: string[];
}

export class RequestAnalyzer {
  analyze(request: string): BuildPlan {
    const lowerRequest = request.toLowerCase();

    // Heuristics for project inference
    const isFullStack = lowerRequest.includes('management') || lowerRequest.includes('crm') || lowerRequest.includes('inventory') || lowerRequest.includes('erp');
    const isFrontendOnly = lowerRequest.includes('calculator') || lowerRequest.includes('clock');

    const projectType = isFullStack ? 'full-stack-app' : (isFrontendOnly ? 'frontend-app' : 'unknown');
    const backendRequired = isFullStack;
    const databaseRequired = isFullStack;
    const frontendRequired = true;

    const directories = ['src/components', 'src/styles', 'src/lib'];
    if (backendRequired) directories.push('src/server');

    const files: FilePlan[] = [
      { path: 'src/App.tsx', purpose: 'Main entry point' },
      { path: 'src/index.css', purpose: 'Global styles' }
    ];

    if (frontendRequired) {
      files.push({ path: 'src/components/Layout.tsx', purpose: 'Main layout' });
    }

    if (backendRequired) {
      files.push({ path: 'src/server/server.ts', purpose: 'API server' });
    }

    const features: string[] = ['Core UI'];
    if (databaseRequired) features.push('data-persistence');
    if (backendRequired) features.push('api-routes');

    return {
      projectType,
      frontendRequired,
      backendRequired,
      databaseRequired,
      directories,
      files,
      features
    };
  }
}
