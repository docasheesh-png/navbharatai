import { ProjectBlueprint } from './ProjectBlueprint';

export class BlueprintValidator {
  static validate(bp: ProjectBlueprint): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!bp.roles || bp.roles.length === 0) errors.push("No roles defined");
    if (!bp.pages || bp.pages.length === 0) errors.push("No pages defined");
    if (!bp.entities || bp.entities.length === 0) errors.push("No entities defined");
    if (!bp.apiEndpoints || bp.apiEndpoints.length === 0) errors.push("No API endpoints defined");
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}
