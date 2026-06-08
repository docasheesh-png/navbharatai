
import { Feature, LogicHandler } from './types';

// Registry of available building blocks
const FEATURE_REGISTRY: Record<string, Feature> = {
  'data-persistence': {
    id: 'data-persistence',
    dependencies: [],
    capabilities: ['create-item', 'read-item', 'update-item', 'delete-item'],
    components: ['DataGrid'],
    logicHandlers: [{ category: 'database', inputs: { table: 'string' }, outputs: { status: 'boolean' } }]
  },
  'api-routes': {
    id: 'api-routes',
    dependencies: [],
    capabilities: ['handle-request'],
    components: [],
    logicHandlers: [{ category: 'server', inputs: { path: 'string' }, outputs: { response: 'json' } }]
  },
  'ui-atoms': {
    id: 'ui-atoms',
    dependencies: [],
    capabilities: ['display'],
    components: ['Button', 'Input', 'Card', 'Layout'],
    logicHandlers: []
  }
};

export class FeatureComposer {
  compose(request: string): Feature[] {
    const features: Feature[] = [];
    const lower = request.toLowerCase();

    // Composing based on inference
    if (lower.includes('management') || lower.includes('crm')) {
      features.push(FEATURE_REGISTRY['data-persistence']);
      features.push(FEATURE_REGISTRY['api-routes']);
    }
    
    features.push(FEATURE_REGISTRY['ui-atoms']);
    
    return features;
  }
}
