// U-4 (verified recipe modules) — list pagination helpers (dependency-free).
//
// Every list endpoint (products, orders, posts, search results) needs pagination — and hand-rolled
// pagination is a reliable source of bugs: an unbounded `?limit=999999` is a DoS that can OOM the server or
// hammer the DB, a negative/NaN `?page=` throws or returns garbage, and off-by-one page math ships wrong
// "Page 3 of 7" labels. This recipe ships correct, defensive helpers: parsePagination() clamps the client's
// query into a safe { limit, offset, page }, and pageMeta() computes the response envelope (total, page,
// pages, hasNext, hasPrev) right every time. No dependency, no env keys. PURE builder; correct and complete
// — no TODO stubs (the real-features rule). Unit-tested.

export interface PaginationConfig {
  files: Record<string, string>;
  instructions: string;
}

const PAGINATION_SERVER = `export interface PageParams {
  /** Rows to return (clamped to [1, maxLimit]). */
  limit: number;
  /** Rows to skip — feed straight into SQL OFFSET / .skip(). */
  offset: number;
  /** 1-based page number. */
  page: number;
}

// Parse and CLAMP the client's pagination query into safe values. Guards the three classic bugs:
// an unbounded limit (DoS) is capped at maxLimit; a missing/NaN/<1 page falls back to page 1; a huge page
// is allowed (you'll just get an empty slice) but never produces a negative offset. Accepts page+limit
// (?page=2&limit=20) — the most common REST style.
export function parsePagination(
  query: { page?: unknown; limit?: unknown },
  opts?: { defaultLimit?: number; maxLimit?: number },
): PageParams {
  const defaultLimit = opts?.defaultLimit ?? 20;
  const maxLimit = opts?.maxLimit ?? 100;
  const toInt = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  };
  const limit = Math.min(Math.max(toInt(query.limit, defaultLimit), 1), maxLimit);
  const page = Math.max(toInt(query.page, 1), 1);
  const offset = (page - 1) * limit;
  return { limit, offset, page };
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Build the pagination envelope to return alongside the data slice, e.g.
//   res.json({ data: rows, meta: pageMeta(totalCount, params) });
export function pageMeta(total: number, params: PageParams): PageMeta {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const pages = Math.max(Math.ceil(safeTotal / params.limit), 1);
  return {
    total: safeTotal,
    page: params.page,
    limit: params.limit,
    pages,
    hasNext: params.page < pages,
    hasPrev: params.page > 1,
  };
}
`;

const INSTRUCTIONS =
  'Pagination wired at server/lib/pagination.ts (no dependency). On any list endpoint, call const p = ' +
  'parsePagination(req.query) to get a safe { limit, offset, page } — it caps limit (default max 100) so a ' +
  '?limit=999999 can never DoS your DB, and defaults a bad/missing page to 1. Use p.limit / p.offset in your ' +
  'query (SQL LIMIT/OFFSET or .skip()/.take()), then return res.json({ data, meta: pageMeta(total, p) }) so ' +
  'the client gets total/page/pages/hasNext/hasPrev. No API key needed.';

export function generatePaginationIntegration(): PaginationConfig {
  return {
    files: { 'server/lib/pagination.ts': PAGINATION_SERVER },
    instructions: INSTRUCTIONS,
  };
}
