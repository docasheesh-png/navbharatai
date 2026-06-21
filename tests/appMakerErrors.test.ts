import { describe, it, expect } from 'vitest';
import { AppMakerError, NotFoundError, ValidationError, PersistenceError } from '../src/server/AppMakerLab/errors/AppMakerErrors';

describe('AppMakerErrors', () => {
  it('AppMakerError has name "AppMakerError"', () => {
    const err = new AppMakerError('something failed', 'GENERIC');
    expect(err.name).toBe('AppMakerError');
    expect(err.message).toBe('something failed');
    expect(err.code).toBe('GENERIC');
  });

  it('NotFoundError has code "NOT_FOUND"', () => {
    const err = new NotFoundError('workspace not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('workspace not found');
  });

  it('ValidationError has code "VALIDATION_ERROR"', () => {
    const err = new ValidationError('invalid input');
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('PersistenceError has code "PERSISTENCE_ERROR"', () => {
    const err = new PersistenceError('db write failed');
    expect(err.code).toBe('PERSISTENCE_ERROR');
  });

  it('all error classes are instances of Error', () => {
    expect(new NotFoundError('x')).toBeInstanceOf(Error);
    expect(new ValidationError('x')).toBeInstanceOf(Error);
    expect(new PersistenceError('x')).toBeInstanceOf(Error);
  });

  it('all error classes are instances of AppMakerError', () => {
    expect(new NotFoundError('x')).toBeInstanceOf(AppMakerError);
    expect(new ValidationError('x')).toBeInstanceOf(AppMakerError);
    expect(new PersistenceError('x')).toBeInstanceOf(AppMakerError);
  });
});
