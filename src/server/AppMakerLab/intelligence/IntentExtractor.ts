import { ProjectBlueprint } from '../ProjectBlueprint';

export class IntentExtractor {
    extract(text: string): { applicationType: string; domain: string; userRoles: string[] } {
        const lower = text.toLowerCase();
        
        // Improved domain detection
        const domains: Record<string, string[]> = {
            healthcare: ['hospital', 'medical', 'clinic', 'doctor', 'patient', 'health', 'nursing'],
            ecommerce: ['shop', 'store', 'cart', 'checkout', 'product', 'retail', 'e-commerce', 'buy'],
            education: ['school', 'student', 'teacher', 'course', 'university', 'learning', 'classroom'],
            social: ['social', 'profile', 'feed', 'post', 'community', 'networking'],
            finance: ['finance', 'bank', 'payment', 'ledger', 'accounting', 'investment', 'wallet'],
            logistics: ['logistics', 'delivery', 'transport', 'supply chain', 'warehouse', 'shipping'],
            crm: ['crm', 'customer', 'lead', 'client', 'sales', 'support'],
            erp: ['erp', 'enterprise', 'resource', 'management', 'manufacturing', 'hr']
        };

        let domain = 'general';
        for (const [d, keywords] of Object.entries(domains)) {
            if (keywords.some(k => lower.includes(k))) {
                domain = d;
                break;
            }
        }

        // Improved role extraction
        const roles = new Set<string>();
        const roleKeywords = ['admin', 'manager', 'user', 'guest', 'doctor', 'patient', 'student', 'teacher', 'customer', 'agent'];
        
        // Regex as fallback
        const forMatch = lower.match(/(?:for|role|users?):\s*([a-z\s,]+)/);
        if (forMatch) {
            forMatch[1].split(',').forEach(r => roles.add(r.trim()));
        } else {
            // Heuristic for role detection
            roleKeywords.forEach(rk => {
                if (lower.includes(rk)) roles.add(rk);
            });
        }
        
        if (roles.size === 0) roles.add(domain === 'healthcare'? 'doctor' : 'user');

        return {
            applicationType: lower.includes('mobile') || lower.includes('ios') || lower.includes('android') ? 'mobile-application' : 'web-application',
            domain,
            userRoles: Array.from(roles)
        };
    }
}
