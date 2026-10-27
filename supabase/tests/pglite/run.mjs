import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL, URL } from 'node:url'
import process from 'node:process'
import { log } from 'node:console'

// The QA package is supplied from a temporary installation, never a production dependency.
if (!process.argv[2]) throw new Error('Usage: node supabase/tests/pglite/run.mjs <absolute PGlite dist/index.js path>')
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href)
const database = new PGlite()
const directory = fileURLToPath(new URL('.', import.meta.url))
try {
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text not null, public boolean not null default false,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null, name text not null,
      unique (bucket_id, name)
    );
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, service_role;
    grant insert, select, update, delete on storage.objects to authenticated;
    grant all on storage.objects to service_role;
  `)
  const migrationDirectory = resolve(directory, '../../migrations')
  const migrations = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort()
  const importFoundationIndex = migrations.findIndex(name => name.includes('import_foundation_and_roles'))
  const candidateReviewIndex = migrations.findIndex(name => name.includes('import_candidate_snapshot_and_review'))
  const sourceVerificationIndex = migrations.findIndex(name => name.includes('private_master_source_verification'))
  if (importFoundationIndex < 0) throw new Error('Expected the import foundation and roles migration')
  if (candidateReviewIndex < 0) throw new Error('Expected the candidate snapshot and review migration')
  if (sourceVerificationIndex < 0) throw new Error('Expected the source verification migration')

  for (const name of migrations.slice(0, importFoundationIndex)) {
    await database.exec(await readFile(resolve(migrationDirectory, name), 'utf8'))
    log(`Migration PASS: ${name}`)
  }

  // Exercise migration of real legacy values rather than only asserting the
  // final constraint. These records intentionally use the old role contract.
  await database.exec(`
    insert into auth.users (id) values
      ('00000000-0000-0000-0000-000000000101'),
      ('00000000-0000-0000-0000-000000000102'),
      ('00000000-0000-0000-0000-000000000103');
    insert into public.workspaces (id, name)
    values ('10000000-0000-0000-0000-000000000101', 'Legacy role migration');
    insert into public.workspace_members (workspace_id, user_id, role) values
      ('10000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000101', 'OWNER'),
      ('10000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'ADMIN'),
      ('10000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000103', 'MEMBER');
  `)

  for (const name of migrations.slice(importFoundationIndex, candidateReviewIndex)) {
    await database.exec(await readFile(resolve(migrationDirectory, name), 'utf8'))
    log(`Migration PASS: ${name}`)
  }
  await database.exec(await readFile(resolve(directory, 'foundation_contract.sql'), 'utf8'))
  await database.exec(await readFile(resolve(directory, 'import_foundation_contract.sql'), 'utf8'))
  await database.exec(await readFile(resolve(directory, 'master_import_persistence_contract.sql'), 'utf8'))

  for (const name of migrations.slice(candidateReviewIndex, sourceVerificationIndex)) {
    await database.exec(await readFile(resolve(migrationDirectory, name), 'utf8'))
    log(`Migration PASS: ${name}`)
  }
  await database.exec(await readFile(resolve(directory, 'import_candidate_review_contract.sql'), 'utf8'))
  for (const name of migrations.slice(sourceVerificationIndex)) {
    await database.exec(await readFile(resolve(migrationDirectory, name), 'utf8'))
    log(`Migration PASS: ${name}`)
  }
  await database.exec(await readFile(resolve(directory, 'import_source_verification_contract.sql'), 'utf8'))
  await database.exec(await readFile(resolve(directory, 'pilot_master_apply_contract.sql'), 'utf8'))
  log('Pilot Master Apply contract PASS: preview, create-only apply, conflicts, roles, source trust, idempotency, rollback, and audit.')
  const tables = await database.query("select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
  if (tables.rows[0].count !== 16) throw new Error('Expected all 16 Foundation tables')
  log('Database contract PASS: 16 tables; role backfill, RLS, atomic candidate persistence, verified source trust, tenant isolation, mapping and issue transitions.')
} finally {
  await database.close()
}
