import { ProjectBlueprint } from '../ProjectBlueprint';
import { IntentExtractor } from './IntentExtractor';
import { FeatureExtractor } from './FeatureExtractor';
import { ModuleClassifier } from './ModuleClassifier';
import { BlueprintValidator } from './BlueprintValidator';

export class BlueprintCompiler {
    private intentExtractor = new IntentExtractor();
    private featureExtractor = new FeatureExtractor();
    private moduleClassifier = new ModuleClassifier();
    private validator = new BlueprintValidator();

    compile(text: string): ProjectBlueprint {
        const intent = this.intentExtractor.extract(text);
        const features = this.featureExtractor.extract(text);
        const modules = this.moduleClassifier.classify(features);
        
        // Technology Inference with fallback
        const tech = new Set<string>(['typescript']);
        if (text.toLowerCase().includes('realtime') || Object.keys(modules).includes('messaging')) tech.add('socket.io');
        
        if (intent.applicationType === 'mobile-application') {
            tech.add('react-native');
        } else {
            tech.add('react');
            if (intent.domain === 'ecommerce' || intent.domain === 'social' || features.length > 3) {
                tech.add('next.js');
            }
        }
        
        if (Object.values(modules).some(m => m.type === 'BACKEND') || intent.domain === 'erp' || intent.domain === 'finance') {
            tech.add('node');
            tech.add('express'); // Default backend
        }

        const blueprint: ProjectBlueprint = {
            metadata: intent,
            features,
            modules,
            technologyRequirements: Array.from(tech)
        };

        this.validator.validate(blueprint);
        
        return blueprint;
    }
}
