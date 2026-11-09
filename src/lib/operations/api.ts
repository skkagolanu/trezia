import type { NextRequest } from 'next/server';
import { z, type ZodType } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireOperationsOperator, requireOperationsReader, requirePublishedDocumentsReader } from '@/lib/supabase/require-auth';

type DbResult = { data: unknown; error: { code?: string; message?: string } | null };
type Query = PromiseLike<DbResult> & {
  select(columns?: string): Query;
  insert(value: Record<string, unknown>): Query;
  update(value: Record<string, unknown>): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  maybeSingle(): Promise<DbResult>;
  single(): Promise<DbResult>;
};

type OperationsResourceBase = {
  table: string;
  createSchema: ZodType<Record<string, unknown>>;
  patchSchema: ZodType<Record<string, unknown>>;
  select: string;
};

// Binds residentReadable to residentListRpc so a resident-readable resource can never be
// declared without its resident-scoped RPC — the unfiltered fallback query has no
// published/audience predicate, so that pairing must be enforced at the type level.
export type OperationsResource = OperationsResourceBase &
  ({ residentReadable: true; residentListRpc: string } | { residentReadable?: false; residentListRpc?: undefined });

// `Query` is PromiseLike, so an async function returning it directly gets recursively
// unwrapped by `await` (thenables collapse through nested awaits) — the caller would end
// up with a bare `DbResult`, not the builder. Returning a plain, non-thenable wrapper object
// instead means `await db()` resolves to exactly one level: the object with `.from(...)`.
async function db(): Promise<{ from(tableName: string): Query }> {
  const client = await createClient();
  return client as unknown as { from(tableName: string): Query };
}

async function json(request: NextRequest): Promise<unknown | Response> {
  try { return await request.json(); }
  catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
}

function dbFailure(action: string, error: { code?: string } | null): Response {
  if (error?.code === '23503') return Response.json({ error: 'Referenced record was not found in this society' }, { status: 422 });
  if (error?.code === '23505') return Response.json({ error: 'That record already exists' }, { status: 409 });
  if (error?.code === '23514') return Response.json({ error: 'The record violates an operating rule' }, { status: 422 });
  console.error(`[operations] ${action} failed`);
  return Response.json({ error: `Failed to ${action}` }, { status: 500 });
}

export function collectionHandlers(config: OperationsResource) {
  return {
    GET: async (request: NextRequest) => {
      const auth = config.residentReadable ? await requirePublishedDocumentsReader() : await requireOperationsReader();
      if (auth.unauthorized) return auth.unauthorized;
      if (auth.role === 'resident' && !config.residentReadable) return Response.json({ error: 'Forbidden' }, { status: 403 });
      const url = new URL(request.url);
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '25', 10) || 25));
      if (auth.role === 'resident' && config.residentListRpc) {
        const client = await createClient();
        const { data, error } = await client.rpc(config.residentListRpc, { p_limit: limit, p_offset: (page - 1) * limit });
        if (error) return dbFailure(`load ${config.table}`, error);
        return Response.json({ items: data ?? [], page, limit });
      }
      let query = (await db()).from(config.table).select(config.select).eq('society_id', auth.societyId).order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * limit, page * limit - 1);
      if (url.searchParams.get('include_archived') !== 'true' || auth.role === 'resident') query = query.is('archived_at', null);
      const { data, error } = await query;
      if (error) return dbFailure(`load ${config.table}`, error);
      return Response.json({ items: data ?? [], page, limit });
    },
    POST: async (request: NextRequest) => {
      const auth = await requireOperationsOperator();
      if (auth.unauthorized) return auth.unauthorized;
      const body = await json(request);
      if (body instanceof Response) return body;
      const parsed = config.createSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
      const { data, error } = await (await db()).from(config.table).insert({ ...parsed.data, society_id: auth.societyId, created_by: auth.userId }).select(config.select).single();
      if (error) return dbFailure(`create ${config.table}`, error);
      return Response.json({ data }, { status: 201 });
    },
  };
}

export function itemHandlers(config: OperationsResource) {
  return {
    PATCH: async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
      const auth = await requireOperationsOperator();
      if (auth.unauthorized) return auth.unauthorized;
      const { id } = await context.params;
      if (!z.string().uuid().safeParse(id).success) return Response.json({ error: 'Not found' }, { status: 404 });
      const body = await json(request);
      if (body instanceof Response) return body;
      const parsed = config.patchSchema.safeParse(body);
      if (!parsed.success) return Response.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
      const values = parsed.data.archive === true ? { archived_at: new Date().toISOString() } : parsed.data;
      delete values.archive;
      const { data, error } = await (await db()).from(config.table).update(values).eq('id', id).eq('society_id', auth.societyId).select(config.select).maybeSingle();
      if (error) return dbFailure(`update ${config.table}`, error);
      if (!data) return Response.json({ error: 'Not found' }, { status: 404 });
      return Response.json({ data });
    },
  };
}
