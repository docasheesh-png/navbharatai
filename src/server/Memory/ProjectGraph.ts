export interface ProjectMemory {
  projectType: string;
  files: string[];
  components: string[];
  routes: string[];
  models: string[];
  services: string[];
  features: string[];
  dependencies: string[];
  buildHistory: Array<{
    timestamp: string;
    request: string;
    filesGenerated: string[];
    filesModified: string[];
  }>;
}

export const InitialMemory: ProjectMemory = {
  projectType: '',
  files: [],
  components: [],
  routes: [],
  models: [],
  services: [],
  features: [],
  dependencies: [],
  buildHistory: []
};
