import { describe, it, expect } from 'vitest';
import {
  expressPathToOpenApi, extractPathParams, generateOpenApi, toOpenApiSchema, type RouteSpec,
} from './OpenApiGenerator';

describe('OpenApiGenerator (P-CGE.5)', () => {
  describe('path conversion', () => {
    it('converts express :params to {params}', () => {
      expect(expressPathToOpenApi('/users/:id/posts/:postId')).toBe('/users/{id}/posts/{postId}');
    });
    it('extracts path param names', () => {
      expect(extractPathParams('/users/{id}/posts/{postId}')).toEqual(['id', 'postId']);
    });
  });

  describe('toOpenApiSchema — valid OpenAPI types only', () => {
    it('maps loose type hints to valid OpenAPI types (never invalid int/bool/float/datetime)', () => {
      expect(toOpenApiSchema('int')).toEqual({ type: 'integer' });
      expect(toOpenApiSchema('bool')).toEqual({ type: 'boolean' });
      expect(toOpenApiSchema('float')).toEqual({ type: 'number' });
      expect(toOpenApiSchema('datetime')).toEqual({ type: 'string', format: 'date-time' });
      expect(toOpenApiSchema('uuid')).toEqual({ type: 'string', format: 'uuid' });
      expect(toOpenApiSchema('email')).toEqual({ type: 'string', format: 'email' });
      expect(toOpenApiSchema('array')).toEqual({ type: 'array', items: {} });
      expect(toOpenApiSchema(undefined)).toEqual({ type: 'string' });
      expect(toOpenApiSchema('CustomThing')).toEqual({ type: 'string' });
    });

    it('normalizes an int path param + a datetime body field to valid schema in the full document', () => {
      const doc = generateOpenApi([{
        method: 'post',
        path: '/items/:id',
        params: [{ name: 'id', in: 'path', type: 'int' }],
        requestBody: { properties: { createdAt: { type: 'datetime' }, count: { type: 'int' } } },
      }]);
      const op = doc.paths['/items/{id}'].post as Record<string, any>;
      expect(op.parameters[0].schema).toEqual({ type: 'integer' });
      const props = op.requestBody.content['application/json'].schema.properties;
      expect(props.createdAt).toEqual({ type: 'string', format: 'date-time' });
      expect(props.count).toEqual({ type: 'integer' });
    });
  });

  describe('generateOpenApi', () => {
    it('produces a valid 3.0.3 document with info + paths', () => {
      const doc = generateOpenApi(
        [{ method: 'get', path: '/health', summary: 'Health check' }],
        { title: 'My API', version: '2.0.0' },
      );
      expect(doc.openapi).toBe('3.0.3');
      expect(doc.info).toEqual({ title: 'My API', version: '2.0.0' });
      expect(doc.paths['/health'].get).toMatchObject({ summary: 'Health check' });
      expect((doc.paths['/health'].get as any).responses['200']).toBeTruthy();
    });

    it('auto-derives path parameters from the URL', () => {
      const doc = generateOpenApi([{ method: 'get', path: '/users/:id' }]);
      const op = doc.paths['/users/{id}'].get as any;
      expect(op.parameters).toHaveLength(1);
      expect(op.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    });

    it('builds a JSON request body from declared properties', () => {
      const doc = generateOpenApi([{
        method: 'post', path: '/users',
        requestBody: { properties: { name: { type: 'string' }, age: { type: 'integer' } }, required: ['name'] },
      }]);
      const op = doc.paths['/users'].post as any;
      const schema = op.requestBody.content['application/json'].schema;
      expect(schema.properties.name).toEqual({ type: 'string' });
      expect(schema.properties.age).toEqual({ type: 'integer' });
      expect(schema.required).toEqual(['name']);
    });

    it('merges multiple methods on the same path', () => {
      const routes: RouteSpec[] = [
        { method: 'get', path: '/items' },
        { method: 'post', path: '/items' },
      ];
      const doc = generateOpenApi(routes);
      expect(Object.keys(doc.paths['/items']).sort()).toEqual(['get', 'post']);
    });

    it('HONESTY: a route with no responses gets a minimal valid 200 (spec stays valid), nothing invented', () => {
      const doc = generateOpenApi([{ method: 'get', path: '/x' }]);
      const op = doc.paths['/x'].get as any;
      expect(Object.keys(op.responses)).toEqual(['200']);
      expect(op.requestBody).toBeUndefined();
      expect(op.parameters).toBeUndefined();
    });

    it('ignores invalid methods and provides sensible defaults', () => {
      const doc = generateOpenApi([{ method: 'TELEPORT', path: '/x' }] as any);
      expect(Object.keys(doc.paths)).toHaveLength(0);
      expect(doc.info.title).toBe('Generated API');
    });
  });
});
