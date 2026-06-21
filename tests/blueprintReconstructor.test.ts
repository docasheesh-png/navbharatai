import { describe, it, expect } from 'vitest';
import { BlueprintReconstructor } from '../src/server/AppMakerLab/intelligence/BlueprintReconstructor';

describe('BlueprintReconstructor', () => {
  const reconstructor = new BlueprintReconstructor();

  it('detects React frontend when App symbol present', () => {
    const result = reconstructor.reconstruct({}, [{ symbols: [{ name: 'App', type: 'component' }], dependencies: [] }]);
    expect(result.frontend).toBe('React/Frontend');
  });

  it('shows None for frontend when no App symbol', () => {
    const result = reconstructor.reconstruct({}, [{ symbols: [{ name: 'utils', type: 'function' }], dependencies: [] }]);
    expect(result.frontend).toBe('None');
  });

  it('detects Express backend from dependencies', () => {
    const result = reconstructor.reconstruct({}, [{ symbols: [], dependencies: ['express', 'cors'] }]);
    expect(result.backend).toBe('Express/Server');
  });

  it('detects database from prisma dependency', () => {
    const result = reconstructor.reconstruct({}, [{ symbols: [], dependencies: ['prisma'] }]);
    expect(result.database).toBe('Database/ORM');
  });

  it('detects auth from firebase dependency', () => {
    const result = reconstructor.reconstruct({}, [{ symbols: [], dependencies: ['firebase-admin'] }]);
    expect(result.auth).toBe('Auth/Security');
  });

  it('returns empty apiStructure when no get/post functions', () => {
    const result = reconstructor.reconstruct({}, [{ symbols: [{ name: 'renderApp', type: 'function' }], dependencies: [] }]);
    expect(result.apiStructure).toEqual([]);
  });
});
