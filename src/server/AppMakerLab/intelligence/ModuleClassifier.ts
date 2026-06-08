export class ModuleClassifier {
    classify(features: string[]): Record<string, { type: 'FRONTEND' | 'BACKEND' | 'DATABASE' | 'AUTH' | 'CONFIG'; dependencies: string[] }> {
        const modules: any = {};
        
        // Configurable mapping
        const mapping: Record<string, { type: 'FRONTEND' | 'BACKEND' | 'DATABASE' | 'AUTH' | 'CONFIG', deps: string[] }> = {
            'dashboard': { type: 'FRONTEND', deps: ['BACKEND'] },
            'auth': { type: 'AUTH', deps: [] },
            'billing': { type: 'BACKEND', deps: ['DATABASE'] },
            'inventory': { type: 'BACKEND', deps: ['DATABASE'] },
            'lab': { type: 'BACKEND', deps: ['DATABASE'] },
            'crm': { type: 'BACKEND', deps: ['DATABASE'] },
            'settings': { type: 'CONFIG', deps: [] }
        };

        for (const feature of features) {
            const config = mapping[feature] || { type: 'FRONTEND', deps: ['BACKEND'] };
            modules[feature] = { type: config.type, dependencies: config.deps };
        }
        
        if (!modules['DATABASE']) modules['DATABASE'] = { type: 'DATABASE', dependencies: [] };
        
        return modules;
    }
}
