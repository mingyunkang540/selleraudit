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
  for (const name of (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort()) {
    await database.exec(await readFile(resolve(migrationDirectory, name), 'utf8'))
    log(`Migration PASS: ${name}`)
  }
  await database.exec(await readFile(resolve(directory, 'foundation_contract.sql'), 'utf8'))
  const tables = await database.query("select count(*)::int as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
  if (tables.rows[0].count !== 10) throw new Error('Expected all 10 Foundation tables')
  log('Database contract PASS: 10 tables; RLS, tenant constraints, atomic mapping and issue transitions.')
} finally {
  await database.close()
}
