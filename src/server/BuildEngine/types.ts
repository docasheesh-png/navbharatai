
export interface LogicHandler {
  category: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}

export interface AtomicComponent {
  id: string;
  version: string;
  props: Record<string, string>;
  dependencies: string[];
}

export interface Feature {
  id: string;
  dependencies: string[];
  capabilities: string[];
  components: string[];
  logicHandlers: LogicHandler[];
}

export interface BuildManifest {
  projectType: string;
  features: string[];
  components: string[];
  logicHandlers: string[];
  filesToGenerate: string[];
  dependencies: string[];
}

export interface VerificationTarget {
  filePath: string;
  verificationType:
    | 'exists'
    | 'typescript'
    | 'react-component'
    | 'api-route'
    | 'database-model';
}
