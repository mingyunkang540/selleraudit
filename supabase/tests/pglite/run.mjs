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
  `)
  const migrationDirectory = resolve(directory, '../../migrations')
  const migrations = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort()
  const importFoundationIndex = migrations.findIndex(name => name.includes('import_foundation_and_roles'))
  if (importFoundationIndex < 0) throw new Error('Expected the import foundation and roles migration')

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

  for (const name of migrations.slice(importFoundationIndex)) {
    await database.exec(await readFile(resolve(migrationDirectory, name), 'utf8'))
    log(`Migration PASS: ${name}`)
  }
  await database.exec(await readFile(resolve(directory, 'foundation_contract.sql'), 'utf8'))
  await database.exec(await readFile(resolve(directory, 'import_foundation_contract.sql'), 'utf8'))
  const tables = await database.query("select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
  if (tables.rows[0].count !== 14) throw new Error('Expected all 14 Foundation tables')
  log('Database contract PASS: 14 tables; role backfill, RLS, import constraints, tenant isolation, atomic mapping and issue transitions.')
} finally {
  await database.close()
}
