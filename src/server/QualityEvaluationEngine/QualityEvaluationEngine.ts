import { IQualityEvaluationEngine } from './IQualityEvaluationEngine';
import { QualityReport, EvaluationStatus } from './QualityTypes';
import { BuildEvaluator } from './BuildEvaluator';
import { LintEvaluator } from './LintEvaluator';
import { RuntimeEvaluator } from './RuntimeEvaluator';
import { SecurityEvaluator } from './SecurityEvaluator';
import { ArchitectureEvaluator } from './ArchitectureEvaluator';
import { QualityScorer } from './QualityScorer';
import { EventBus } from '../AppMakerLab/eventbus/EventBus';

export class QualityEvaluationEngine implements IQualityEvaluationEngine {
    private eventBus = new EventBus();

    async evaluate(workspaceId: string): Promise<QualityReport> {
        this.eventBus.publish('QUALITY_EVALUATION_STARTED', { workspaceId });

        const buildEvaluator = new BuildEvaluator();
        const lintEvaluator = new LintEvaluator();
        const runtimeEvaluator = new RuntimeEvaluator();
        const securityEvaluator = new SecurityEvaluator();
        const architectureEvaluator = new ArchitectureEvaluator();
        const scorer = new QualityScorer();

        const [build, lint, runtime, security, architecture] = await Promise.all([
            buildEvaluator.evaluate(workspaceId),
            lintEvaluator.evaluate(workspaceId),
            runtimeEvaluator.evaluate(workspaceId),
            securityEvaluator.evaluate(workspaceId),
            architectureEvaluator.evaluate(workspaceId)
        ]);

        const report: QualityReport = {
            buildStatus: build.status as EvaluationStatus,
            lintStatus: lint.status as EvaluationStatus,
            runtimeStatus: runtime.status as EvaluationStatus,
            securityStatus: security.status as EvaluationStatus,
            architectureStatus: architecture.status as EvaluationStatus,
            errors: [...build.errors, ...lint.errors, ...runtime.errors, ...security.errors, ...architecture.errors],
            warnings: [],
            recommendations: [],
            overallScore: 0,
            cycles: architecture.cycles,
            unresolvedImports: architecture.unresolvedImports,
            violations: architecture.violations
        };

        report.overallScore = scorer.score(report);

        this.eventBus.publish('QUALITY_EVALUATION_COMPLETED', report);
        return report;
    }
}
