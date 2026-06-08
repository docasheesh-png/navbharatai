import { InternalRequirementDTO } from './types';

export class RequirementsParserAdapter {
    static parse(raw: string): InternalRequirementDTO {
        return {
            id: `req_${Date.now()}`,
            prompt: raw,
            timestamp: Date.now(),
            metadata: {}
        };
    }
}
