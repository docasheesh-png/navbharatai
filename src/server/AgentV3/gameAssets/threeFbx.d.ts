// The two three.js example modules the server's FBX import uses (userModels.ts `fbxToGlb`). three ships no typings for
// examples/jsm, and @types/three is not a dependency; only the members that code calls are declared.
declare module 'three/examples/jsm/loaders/FBXLoader.js' {
  export class FBXLoader {
    constructor(manager?: unknown);
    parse(buffer: ArrayBuffer, path: string): unknown;
  }
}
declare module 'three/examples/jsm/exporters/GLTFExporter.js' {
  export class GLTFExporter {
    parseAsync(input: unknown, options: { binary: true; animations?: unknown; onlyVisible?: boolean }): Promise<ArrayBuffer>;
  }
}
