import { DEMO_DATA, DEMO_RPC } from '@/lib/demo/data';

type Row = Record<string, unknown>;
type WriteOp = 'insert' | 'update' | 'upsert' | 'delete';

let _seq = 0;
// Avoids depending on Node's `crypto.randomUUID` (not guaranteed on every
// runtime this file is bundled for) while still looking plausible in the UI.
function demoId(): string {
  _seq += 1;
  return `demo-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

export class MockQueryBuilder {
  private _table: string;
  private _eq: Record<string, unknown> = {};
  private _is: Record<string, null> = {};
  private _limitN?: number;
  private _rangeFrom = 0;
  private _writeOp?: WriteOp;
  private _writeData?: Row | Row[];
  private _wantCount = false;

  constructor(table: string) { this._table = table; }

  // ── chainable modifiers ──────────────────────────────────────────────────
  select(_cols?: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): this {
    if (opts?.count) this._wantCount = true;
    return this;
  }
  eq(col: string, val: unknown): this {
    // Embedded-resource filters (e.g. 'units.is_test_unit') can't be evaluated
    // against flat demo rows — ignore them rather than filtering everything out.
    if (!col.includes('.')) this._eq[col] = val;
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  neq(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  gt(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  gte(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  lt(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  lte(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  or(_c: string): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  like(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ilike(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  in(_c: string, _v: unknown[]): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  not(_c: string, _op: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  match(_query: Record<string, unknown>): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filter(_c: string, _op: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  contains(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  containedBy(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  overlaps(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  textSearch(_c: string, _v: unknown): this { return this; }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  abortSignal(_s: unknown): this { return this; }
  throwOnError(): this { return this; }
  returns(): this { return this; }
  csv(): this { return this; }
  explain(): this { return this; }
  rollback(): this { return this; }
  // `.is('archived_at', null)` is a real filter here, not a no-op: demo rows
  // omit nullable columns entirely, so an absent column counts as null.
  is(col: string, val: null): this {
    if (!col.includes('.')) this._is[col] = val;
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  order(_c: string, _o?: object): this { return this; }
  limit(n: number): this { this._limitN = n; return this; }
  range(from: number, to: number): this {
    this._rangeFrom = from;
    this._limitN = to - from + 1;
    return this;
  }

  // ── writes echo the submitted payload back, nothing is persisted ────────
  insert(d: Row | Row[]): this { this._writeOp = 'insert'; this._writeData = d; return this; }
  update(d: Row): this { this._writeOp = 'update'; this._writeData = d; return this; }
  upsert(d: Row | Row[]): this { this._writeOp = 'upsert'; this._writeData = d; return this; }
  delete(): this { this._writeOp = 'delete'; return this; }

  // ── single-row shorthand ─────────────────────────────────────────────────
  single(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({ data: this._resultRows()[0] ?? null, error: null });
  }
  maybeSingle(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve({ data: this._resultRows()[0] ?? null, error: null });
  }

  // ── thenable so `await builder` works ───────────────────────────────────
  then<R>(
    onFulfilled?: ((v: { data: unknown[]; error: null; count?: number }) => R | PromiseLike<R>) | null,
    onRejected?: ((r: unknown) => R | PromiseLike<R>) | null,
  ): Promise<R> {
    const result: { data: unknown[]; error: null; count?: number } = {
      data: this._resultRows(),
      error: null,
    };
    if (this._wantCount) result.count = this._filteredRows().length;
    return Promise.resolve(result).then(onFulfilled, onRejected) as Promise<R>;
  }

  private _resultRows(): Row[] {
    if (this._writeOp === 'insert' || this._writeOp === 'update' || this._writeOp === 'upsert') {
      return this._echoRows();
    }
    // Plain reads and `delete()` both resolve against the (unmutated) fixtures.
    return this._rows();
  }

  private _echoRows(): Row[] {
    const now = new Date().toISOString();
    const items = Array.isArray(this._writeData)
      ? this._writeData
      : this._writeData
        ? [this._writeData]
        : [];
    return items.map(item => {
      const row: Row = { ...item };
      if (row.id === undefined || row.id === null) row.id = demoId();
      if (row.created_at === undefined || row.created_at === null) row.created_at = now;
      row.updated_at = now;
      return row;
    });
  }

  private _filteredRows(): Row[] {
    let rows = [...(DEMO_DATA[this._table] ?? [])] as Row[];
    for (const [col, val] of Object.entries(this._eq))
      rows = rows.filter(r => r[col] === val);
    for (const col of Object.keys(this._is))
      rows = rows.filter(r => (r[col] ?? null) === null);
    return rows;
  }

  private _rows(): Row[] {
    let rows = this._filteredRows();
    if (this._rangeFrom > 0) rows = rows.slice(this._rangeFrom);
    if (this._limitN !== undefined) rows = rows.slice(0, this._limitN);
    return rows;
  }
}

class MockRpcBuilder {
  constructor(private _name: string, private _args?: Record<string, unknown>) {}

  then<R>(
    onFulfilled?: ((v: { data: unknown; error: null }) => R | PromiseLike<R>) | null,
    onRejected?: ((r: unknown) => R | PromiseLike<R>) | null,
  ): Promise<R> {
    const raw = Object.prototype.hasOwnProperty.call(DEMO_RPC, this._name) ? DEMO_RPC[this._name] : null;
    let data: unknown = raw;
    if (Array.isArray(raw)) {
      const limit = typeof this._args?.p_limit === 'number' ? this._args.p_limit : undefined;
      const offset = typeof this._args?.p_offset === 'number' ? this._args.p_offset : 0;
      if (limit !== undefined) data = raw.slice(offset, offset + limit);
      else if (offset) data = raw.slice(offset);
    }
    return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected) as Promise<R>;
  }
}

// Fixed demo identity — mirrors require-auth.ts's DEMO_AUTH so the browser
// client's .auth.getUser() and the server-side short-circuit agree, in case
// anything (correctly or not) ever calls it directly.
const DEMO_USER = { id: 'demo-user', email: 'demo@example.com' };

const DEMO_STORAGE_FILE_API = {
  upload: async () => ({ data: { path: 'demo/mock-path' }, error: null }),
  download: async () => ({ data: null, error: null }),
  remove: async () => ({ data: [], error: null }),
  list: async () => ({ data: [], error: null }),
  createSignedUrl: async () => ({ data: { signedUrl: '#' }, error: null }),
  getPublicUrl: () => ({ data: { publicUrl: '#' } }),
};
const demoStorage = { from: () => DEMO_STORAGE_FILE_API };

function demoChannel() {
  const channel = {
    on: () => channel,
    subscribe: (cb?: (status: string) => void) => { cb?.('SUBSCRIBED'); return channel; },
    unsubscribe: async () => ({ error: null }),
  };
  return channel;
}
const demoRealtime = { channel: demoChannel, removeChannel: async () => 'ok' as const };

// A fully self-contained mock — never wraps a real Supabase client, never
// reads a real URL/key, so demo mode genuinely never constructs anything
// that could reach a live project. Usable from both server and browser code
// (no Node-only APIs), so lib/supabase/server.ts and lib/supabase/client.ts
// share this one implementation instead of duplicating the Proxy.
export function createDemoClient<T>(): T {
  const auth = {
    getUser: async () => ({ data: { user: DEMO_USER }, error: null }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    mfa: {
      listFactors: async () => ({ data: { totp: [], all: [] }, error: null }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
      enroll: async () => ({
        data: {
          id: demoId(),
          totp: { qr_code: '', secret: 'DEMO2FASECRETNOTREAL' },
        },
        error: null,
      }),
      challenge: async () => ({ data: { id: demoId() }, error: null }),
      verify: async () => ({ data: {}, error: null }),
      challengeAndVerify: async () => ({ data: {}, error: null }),
      unenroll: async () => ({ data: {}, error: null }),
    },
  };
  // `schema()`/`rest` hand back this same proxy so a chain like
  // `.schema('public').from(...)` keeps working — the `get` handler only
  // runs after this assignment completes, so the self-reference is safe.
  const client: T = new Proxy({}, {
    get(_target, prop: string | symbol) {
      if (prop === 'from') return (table: string) => new MockQueryBuilder(table);
      if (prop === 'rpc') return (name: string, args?: Record<string, unknown>) => new MockRpcBuilder(name, args);
      if (prop === 'auth') return auth;
      if (prop === 'storage') return demoStorage;
      if (prop === 'channel') return demoChannel;
      if (prop === 'removeChannel') return demoRealtime.removeChannel;
      if (prop === 'realtime') return demoRealtime;
      if (prop === 'schema') return () => client;
      if (prop === 'rest') return client;
      // createClient()/createServiceClient() are `async function`s, so the
      // JS runtime's own Promise-resolution algorithm probes `.then` on
      // whatever they return to check if it's "thenable" — before any app
      // code ever touches the value. Returning undefined (not a function)
      // tells that probe "not thenable" and lets resolution proceed
      // normally; throwing here would fire on every single call, not just
      // real unmocked usage. Same story for other well-known introspection
      // symbols a Proxy can be probed with.
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      // Anything else is deliberately unimplemented — fail loudly during
      // development rather than silently no-op a code path nobody audited
      // for demo-safety.
      throw new Error(`createDemoClient: "${String(prop)}" is not mocked — this call path needs a demo-safe path added.`);
    },
  }) as T;
  return client;
}
