export interface StructuredRequirementModel {
    domain: string;
    projectType: 'react-spa' | 'full-stack' | 'mobile';
    pages: string[];
    entities: string[];
    features: string[];
    apis: string[];
    auth: { enabled: boolean; provider?: string };
    database: { enabled: boolean; type?: string };
    integrations: string[];
}
