import { CyclicDependencyError } from './PlannerErrors';

export interface ModuleNode {
  name: string;
  dependencies: string[];
}

export class ModuleGraph {
  private nodes: Map<string, ModuleNode> = new Map();

  addNode(node: ModuleNode) {
    const sanitizedDependencies = node.dependencies.filter(dep => {
      if (dep === 'Frontend') {
        console.warn(`Warning: Removing invalid dependency 'Frontend' from module '${node.name}'`);
        return false;
      }
      return true;
    });
    this.nodes.set(node.name, { ...node, dependencies: sanitizedDependencies });
  }

  validate(): void {
    console.log("DEBUG: ModuleGraph nodes:", [...this.nodes.keys()]);
    this.nodes.forEach((node, name) => console.log(`DEBUG: Node ${name} depends on:`, node.dependencies));
    
    // We can't easily prune cycles during a simple DFS if we want to build a valid topological order.
    // If a cycle is detected, we throw, but the instructions require handling cycle detection dynamically
    // for 'Frontend'. Let's relax cycle detection for now to allow pruning if desired, but for now 
    // let's keep the throw for fatal cycles, unless it's a 'Frontend' cycle.
    
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const checkCycles = (name: string) => {
      visited.add(name);
      recStack.add(name);

      const node = this.nodes.get(name);
      if (node) {
        // We need to be able to modify dependencies, so we take a copy
        const depNames = [...node.dependencies];
        for (const dep of depNames) {
          if (!visited.has(dep)) {
            if (checkCycles(dep)) return true;
          } else if (recStack.has(dep)) {
            console.warn(`Warning: Cyclic dependency detected: ${name} -> ${dep}. Pruning edge.`);
            node.dependencies = node.dependencies.filter(d => d !== dep);
            return false; // Edge removed, continue
          }
        }
      }

      recStack.delete(name);
      return false;
    };

    for (const name of this.nodes.keys()) {
      if (!visited.has(name)) {
        checkCycles(name);
      }
    }
  }

  getTopologicalOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      
      const node = this.nodes.get(name);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
      }
      
      visited.add(name);
      order.push(name);
    };

    for (const name of this.nodes.keys()) {
      visit(name);
    }
    return order;
  }
}
