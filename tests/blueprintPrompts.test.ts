import { describe, it, expect } from 'vitest';
import { inferType, ProjectTemplates } from '../src/server/AppMakerLab/BlueprintPrompts';

describe('inferType', () => {
  it('returns "Game" for a prompt containing "game"', () => {
    expect(inferType('build a game')).toBe('Game');
  });

  it('returns "Website" for a prompt containing "website"', () => {
    expect(inferType('create a website')).toBe('Website');
  });

  it('returns "Website" for a prompt containing "blog"', () => {
    expect(inferType('a blog platform')).toBe('Website');
  });

  it('returns "App" for a generic prompt', () => {
    expect(inferType('build a todo manager')).toBe('App');
  });

  it('is case-insensitive', () => {
    expect(inferType('Build a GAME')).toBe('Game');
  });
});

describe('ProjectTemplates', () => {
  it('has an "App" template with roles, pages, entities, and apiEndpoints', () => {
    const t = ProjectTemplates['App'];
    expect(t.roles).toBeDefined();
    expect(t.pages).toBeDefined();
    expect(t.entities).toBeDefined();
    expect(t.apiEndpoints.length).toBeGreaterThan(0);
  });

  it('has a "Game" template', () => {
    expect(ProjectTemplates['Game']).toBeDefined();
  });

  it('has a "Website" template', () => {
    expect(ProjectTemplates['Website']).toBeDefined();
  });
});
