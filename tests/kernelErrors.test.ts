import { describe, it, expect } from 'vitest';
import { KernelStateError, DependencyError, ServiceStartupError, ServiceShutdownError } from '../src/server/AppMakerLab/kernel/KernelErrors';

describe('KernelErrors', () => {
  it('KernelStateError is an Error instance', () => {
    const err = new KernelStateError('bad state');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('bad state');
  });

  it('KernelStateError.name is "KernelStateError"', () => {
    expect(new KernelStateError('x').name).toBe('KernelStateError');
  });

  it('DependencyError is an Error instance', () => {
    const err = new DependencyError('missing dep');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DependencyError');
  });

  it('ServiceStartupError.name is "ServiceStartupError"', () => {
    expect(new ServiceStartupError('failed to start').name).toBe('ServiceStartupError');
  });

  it('ServiceShutdownError.name is "ServiceShutdownError"', () => {
    expect(new ServiceShutdownError('failed to stop').name).toBe('ServiceShutdownError');
  });
});
