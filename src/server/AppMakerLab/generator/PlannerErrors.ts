export class BlueprintValidationError extends Error { name = 'BlueprintValidationError'; }
export class CyclicDependencyError extends Error { name = 'CyclicDependencyError'; }
export class MissingDependencyError extends Error { name = 'MissingDependencyError'; }
export class DuplicateModuleError extends Error { name = 'DuplicateModuleError'; }
export class SelfDependencyError extends Error { name = 'SelfDependencyError'; }
