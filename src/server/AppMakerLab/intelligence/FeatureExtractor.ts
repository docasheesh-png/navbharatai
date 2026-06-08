export class FeatureExtractor {
    extract(text: string): string[] {
        const lower = text.toLowerCase();
        const features = new Set<string>();
        
        const featureMap: Record<string, string[]> = {
            'dashboard': ['dashboard', 'panel', 'overview', 'home'],
            'auth': ['auth', 'login', 'signup', 'register', 'signin', 'authentication'],
            'opd': ['opd', 'appointments', 'outpatient'],
            'ipd': ['ipd', 'admissions', 'inpatients'],
            'billing': ['billing', 'invoice', 'payment', 'invoicing'],
            'lab': ['lab', 'laboratory', 'test results', 'diagnostics'],
            'inventory': ['inventory', 'stock', 'supplies'],
            'reports': ['reports', 'reporting', 'data export'],
            'analytics': ['analytics', 'charts', 'graphing', 'metrics'],
            'messaging': ['messaging', 'chat', 'notifications', 'realtime'],
            'crm': ['crm', 'customer', 'lead', 'client management']
        };
        
        for (const [feature, synonyms] of Object.entries(featureMap)) {
            if (synonyms.some(s => lower.includes(s))) {
                features.add(feature);
            }
        }
        
        return Array.from(features);
    }
}
