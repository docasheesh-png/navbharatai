import { TemplateRegistry } from './templates/TemplateRegistry';
import { WorkspaceManager } from '../WorkspaceManager';

export interface ScaffoldInput {
  framework: 'vite-react';
  language: 'typescript';
  features: string[];
  workspaceId: string;
}

export class ScaffoldGenerator {
  private templateRegistry: TemplateRegistry;

  constructor(private workspaceManager: WorkspaceManager) {
    this.templateRegistry = new TemplateRegistry();
  }

  async generate(input: ScaffoldInput): Promise<void> {
    const provider = this.templateRegistry.getProvider(input.framework);
    const files = provider.getFiles(input.features);
    
    for (const [path, content] of Object.entries(files)) {
      await this.workspaceManager.writeFile(input.workspaceId, path, content);
    }
  }
}
