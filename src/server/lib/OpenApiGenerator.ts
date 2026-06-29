// P-CGE.5 — OpenAPI / Contract-First API Generator.
//
// A pure, dependency-free engine that turns a list of route definitions into a valid
// OpenAPI 3.0.3 document (the contract a generated backend exposes). Express-style `:param`
// paths are converted to `{param}` and their path parameters auto-derived.
//
// HONESTY: the spec only contains what the input declares. A route with no responses gets a
// minimal default `200` (so the spec stays valid) — nothing about schemas or auth is invented.

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';
const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export interface RouteParam {
  name: string;
  in: 'path' | 'query' | 'header';
  type?: string;
  required?: boolean;
  description?: string;
}

export interface RouteSpec {
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
  params?: RouteParam[];
  requestBody?: { properties?: Record<string, { type?: string }>; required?: string[] };
  responses?: Record<string, { description?: string }>;
}

export interface OpenApiInfo {
  title?: string;
  version?: string;
  description?: string;
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/** Convert an Express path (`/users/:id`) to an OpenAPI path (`/users/{id}`). */
export function expressPathToOpenApi(path: string): string {
  return clean(path).replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Extract `{param}` names from an OpenAPI-style path. */
export function extractPathParams(openApiPath: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(openApiPath)) !== null) out.push(m[1]);
  return out;
}

function paramObject(p: RouteParam): Record<string, unknown> {
  return {
    name: p.name,
    in: p.in,
    required: p.in === 'path' ? true : !!p.required,
    schema: { type: clean(p.type) || 'string' },
    ...(clean(p.description) ? { description: clean(p.description) } : {}),
  };
}

function operationObject(r: RouteSpec, openApiPath: string): Record<string, unknown> {
  const declared = (r.params || []).filter((p) => clean(p.name));
  const declaredPathNames = new Set(declared.filter((p) => p.in === 'path').map((p) => p.name));
  // Auto-add any path params present in the URL but not explicitly declared.
  const autoPath: RouteParam[] = extractPathParams(openApiPath)
    .filter((n) => !declaredPathNames.has(n))
    .map((n) => ({ name: n, in: 'path' as const, type: 'string', required: true }));
  const parameters = [...declared, ...autoPath].map(paramObject);

  const responses: Record<string, unknown> = {};
  const declaredResponses = r.responses && Object.keys(r.responses).length ? r.responses : { '200': { description: 'Successful response' } };
  for (const [code, body] of Object.entries(declaredResponses)) {
    responses[code] = { description: clean(body?.description) || 'Response' };
  }

  const op: Record<string, unknown> = { responses };
  if (clean(r.summary)) op.summary = clean(r.summary);
  if (Array.isArray(r.tags) && r.tags.length) op.tags = r.tags.map(clean).filter(Boolean);
  if (parameters.length) op.parameters = parameters;
  if (r.requestBody && r.requestBody.properties && Object.keys(r.requestBody.properties).length) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r.requestBody.properties)) props[k] = { type: clean(v?.type) || 'string' };
    op.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: props,
            ...(Array.isArray(r.requestBody.required) && r.requestBody.required.length ? { required: r.requestBody.required } : {}),
          },
        },
      },
    };
  }
  return op;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, unknown>>;
}

/** Generate an OpenAPI 3.0.3 document from a list of routes. Pure. */
export function generateOpenApi(routes: RouteSpec[], info: OpenApiInfo = {}): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const valid = (routes || []).filter((r) => clean(r.method) && clean(r.path) && METHODS.includes(clean(r.method).toLowerCase() as HttpMethod));
  // Stable ordering: by path then method.
  const sorted = [...valid].sort((a, b) => clean(a.path).localeCompare(clean(b.path)) || clean(a.method).localeCompare(clean(b.method)));
  for (const r of sorted) {
    const oaPath = expressPathToOpenApi(r.path);
    const method = clean(r.method).toLowerCase();
    if (!paths[oaPath]) paths[oaPath] = {};
    paths[oaPath][method] = operationObject(r, oaPath);
  }
  return {
    openapi: '3.0.3',
    info: {
      title: clean(info.title) || 'Generated API',
      version: clean(info.version) || '1.0.0',
      ...(clean(info.description) ? { description: clean(info.description) } : {}),
    },
    paths,
  };
}
