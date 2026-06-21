import { describe, it, expect } from 'vitest';
import { AppMakerError, NotFoundError, ValidationError, PersistenceError } from '../src/server/AppMakerLab/errors/AppMakerErrors';

describe('AppMakerError', () => {
  it('is an Error with name AppMakerError', () => {
    const err = new AppMakerError('bad thing', 'SOME_CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppMakerError');
    expect(err.message).toBe('bad thing');
    expect(err.code).toBe('SOME_CODE');
  });
});

describe('NotFoundError', () => {
  it('has code NOT_FOUND', () => {
    const err = new NotFoundError('missing item');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('missing item');
    expect(err).toBeInstanceOf(AppMakerError);
  });
});

describe('ValidationError', () => {
  it('has code VALIDATION_ERROR', () => {
    const err = new ValidationError('invalid field');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err).toBeInstanceOf(AppMakerError);
  });
});

describe('PersistenceError', () => {
  it('has code PERSISTENCE_ERROR', () => {
    const err = new PersistenceError('write failed');
    expect(err.code).toBe('PERSISTENCE_ERROR');
    expect(err).toBeInstanceOf(AppMakerError);
  });
});
