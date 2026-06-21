import { describe, it, expect } from 'vitest';
import { BlueprintReconstructor } from '../src/server/AppMakerLab/intelligence/BlueprintReconstructor';

describe('BlueprintReconstructor.reconstruct', () => {
  const rec = new BlueprintReconstructor();

  it('detects React/Frontend when index has an App symbol', () => {
    const index = [{ symbols: [{ name: 'App', type: 'class' }], dependencies: [] }];
    const result = rec.reconstruct({}, index);
    expect(result.frontend).toBe('React/Frontend');
  });

  it('detects frontend from Component symbol name', () => {
    const index = [{ symbols: [{ name: 'UserComponent', type: 'class' }], dependencies: [] }];
    const result = rec.reconstruct({}, index);
    expect(result.frontend).toBe('React/Frontend');
  });

  it('returns "None" for frontend when no App/Component symbols', () => {
    const index = [{ symbols: [{ name: 'UserService', type: 'class' }], dependencies: [] }];
    const result = rec.reconstruct({}, index);
    expect(result.frontend).toBe('None');
  });

  it('detects Express backend when express is in dependencies', () => {
    const index = [{ symbols: [], dependencies: ['express', 'cors'] }];
    const result = rec.reconstruct({}, index);
    expect(result.backend).toBe('Express/Server');
  });

  it('returns "None" for backend when no express dependency', () => {
    const index = [{ symbols: [], dependencies: ['react'] }];
    const result = rec.reconstruct({}, index);
    expect(result.backend).toBe('None');
  });

  it('detects Database/ORM when prisma is in dependencies', () => {
    const index = [{ symbols: [], dependencies: ['prisma'] }];
    const result = rec.reconstruct({}, index);
    expect(result.database).toBe('Database/ORM');
  });

  it('detects Auth/Security when firebase is in dependencies', () => {
    const index = [{ symbols: [], dependencies: ['firebase'] }];
    const result = rec.reconstruct({}, index);
    expect(result.auth).toBe('Auth/Security');
  });

  it('handles empty index without crashing', () => {
    const result = rec.reconstruct({}, []);
    expect(result.frontend).toBe('None');
    expect(result.backend).toBe('None');
  });
});
