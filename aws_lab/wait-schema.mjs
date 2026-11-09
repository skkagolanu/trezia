// Disposable-database readiness, not a replacement for migration or restore checks.
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const dbUrl = process.env.DATABASE_URL;
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
for (const value of [dbUrl, apiUrl]) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(value).hostname)) {
    throw new Error('Schema readiness probe requires a disposable localhost target');
  }
}
const db = new Client({ connectionString: dbUrl });
await db.connect();
try {
  const result = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='levy_configs' AND column_name='is_active_for_new_collections'");
  if (result.rowCount !== 1) throw new Error('Migrated SQL column is absent; not a cache-readiness problem');
  await db.query("NOTIFY pgrst, 'reload schema'");
} finally {
  await db.end();
}
const api = createClient(apiUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const deadline = Date.now() + 60000;
let ready = false;
while (Date.now() < deadline) {
  let schemaResponse;
  try {
    schemaResponse = await fetch(`${apiUrl}/rest/v1/`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    if (!['ECONNREFUSED','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error.cause?.code)
        && !['TimeoutError','AbortError'].includes(error.name)) throw error;
    console.log('PostgREST connection is still warming after reset');
    await new Promise(resolve => setTimeout(resolve, 500));
    continue;
  }
  if ([502,503,504].includes(schemaResponse.status)) {
    console.log(`PostgREST startup readiness: HTTP ${schemaResponse.status}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    continue;
  }
  if (!schemaResponse.ok) throw new Error(`Schema introspection failed: HTTP ${schemaResponse.status}`);
  const schema = await schemaResponse.json();
  if (!schema.definitions?.levy_configs?.properties?.is_active_for_new_collections) {
    console.log('SQL column exists; PostgREST OpenAPI cache has not exposed it yet');
    await new Promise(resolve => setTimeout(resolve, 500));
    continue;
  }
  const result = await api.from('levy_configs').select('id,is_active_for_new_collections').limit(0);
  if (!result.error) {
    // Auth is a separate container and can still return 503 after PostgREST is ready.
    const auth = await api.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!auth.error) { ready = true; break; }
    if (![500,502,503,504].includes(auth.error.status)
        && auth.error.name !== 'AuthRetryableFetchError') {
      throw new Error(`Unexpected Auth readiness failure: ${auth.error.status}`);
    }
    console.log(`Auth startup readiness: HTTP ${auth.error.status ?? 'connection retry'}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    continue;
  }
  if (!['PGRST204', 'PGRST205', '42703'].includes(result.error.code)) {
    throw new Error(`Unexpected schema-readiness failure: ${result.error.code}`);
  }
  console.log(`SQL column exists; PostgREST not ready (${result.error.code})`);
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) throw new Error('PostgREST did not expose the migrated column within 60 seconds');
console.log('SQL, PostgREST schema and Auth database readiness confirmed');
