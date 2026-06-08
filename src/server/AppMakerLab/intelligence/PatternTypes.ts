export interface TechnologyStack {
    frontend: 'React' | 'Next.js' | 'React Native';
    backend: 'Express' | 'NestJS';
    database: 'PostgreSQL' | 'Firebase';
    orm?: 'Prisma';
    auth: 'Firebase' | 'OAuth';
    realtime?: 'Socket.IO';
}

export interface TechnologyArchitectureBlueprint {
    stack: TechnologyStack;
    score: number;
    matchedConstraints: string[];
    rejectedConstraints: string[];
    rationale: string[];
}

export interface Pattern {
    id: string;
    description: string;
    supportsFrontend: TechnologyStack['frontend'][];
    supportsBackend: TechnologyStack['backend'][];
    requiresDatabase: boolean;
    supportsRealtime: boolean;
    defaultStack: Omit<TechnologyStack, 'realtime'> & { realtime?: 'Socket.IO' };
}
