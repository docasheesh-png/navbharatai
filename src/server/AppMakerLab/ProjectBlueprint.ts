export interface UserRole {
  name: string;
  permissions: string[];
}

export interface UserJourney {
  name: string;
  steps: string[];
}

export interface BusinessRule {
  description: string;
}

export interface Page {
  path: string;
  name: string;
  components: string[];
}

export interface DBEntity {
  name: string;
  fields: Record<string, string>;
}

export interface APIEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  description: string;
}

export interface ProjectBlueprint {
  version: "V3";
  id: string;
  requirementId: string;
  name: string;
  type: string;
  
  userRequirement: {
    prompt: string;
    persona: string;
    goal: string;
  };
  
  complexity: {
    tier: "Low" | "Medium" | "High" | "Enterprise";
    estimatedModules: number;
    riskFactor: number;
  };
  
  generationPlan: {
    steps: Array<{ name: string; description: string; }>;
    phases: Array<{ name: string; deliverables: string[]; }>;
  };
  
  roles: UserRole[];
  journeys: UserJourney[];
  businessRules: BusinessRule[];
  pages: Page[];
  entities: DBEntity[];
  apiEndpoints: APIEndpoint[];
  
  auth?: { enabled: boolean; provider?: string };
  database?: { enabled: boolean; type?: string };
  integrations?: string[];
  
  requirements: {
    testing: string[];
    deployment: string[];
    monitoring: string[];
  };

  // Added fields from BlueprintTypes
  metadata?: {
      applicationType: string;
      domain: string;
      userRoles: string[];
  };
  features?: string[];
  modules?: Record<string, { type: 'FRONTEND' | 'BACKEND' | 'DATABASE' | 'AUTH' | 'CONFIG'; dependencies: string[] }>;
  technologyRequirements?: string[];
}
