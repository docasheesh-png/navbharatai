import { describe, it, expect } from 'vitest';
import { FRAMEWORKS, FRAMEWORK_MAP, getFramework } from './FrameworkRegistry';

// AB-1: the polyglot backends (Spring Boot / Go) must be first-class, selectable frameworks with the
// correct run metadata so the agent + framework picker can offer them (they run on the fullstack sandbox).
describe('FrameworkRegistry — polyglot backends', () => {
  it('registers spring-boot with the Maven run command on port 8080', () => {
    const f = getFramework('spring-boot');
    expect(f).toBeDefined();
    expect(f!.language).toBe('Java');
    expect(f!.category).toBe('backend');
    expect(f!.startCommand).toBe('mvn spring-boot:run');
    expect(f!.devPort).toBe(8080);
  });

  it('registers go with the Go toolchain run command on port 8080', () => {
    const f = getFramework('go');
    expect(f).toBeDefined();
    expect(f!.language).toBe('Go');
    expect(f!.category).toBe('backend');
    expect(f!.startCommand).toBe('go run main.go');
    expect(f!.devPort).toBe(8080);
  });

  it('keeps every framework id unique and resolvable through the map', () => {
    const ids = FRAMEWORKS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FRAMEWORKS) expect(FRAMEWORK_MAP.get(f.id)).toBe(f);
  });
});
