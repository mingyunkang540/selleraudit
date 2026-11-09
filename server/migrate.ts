import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createPool } from './db.ts'

try { process.loadEnvFile('.env.local-server') } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}
const pool = createPool()
try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('select pg_advisory_xact_lock($1)', [736245980])
    await client.query('CREATE SCHEMA IF NOT EXISTS seller_audit_local')
    await client.query('CREATE TABLE IF NOT EXISTS seller_audit_local.schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    const dir = fileURLToPath(new URL('./migrations/', import.meta.url))
    const files = (await readdir(dir)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()
    const applied = await client.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM seller_audit_local.schema_migrations')
    const known = new Map(applied.rows.map(row => [row.name, row.sha256]))
    if (applied.rows.some(row => !files.includes(row.name))) throw new Error('Applied migration missing from disk')
    for (const name of files) {
      const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8')
      const hash = createHash('sha256').update(sql).digest('hex')
      if (known.has(name)) {
        if (known.get(name) !== hash) throw new Error('Applied migration checksum mismatch')
        continue
      }
      await client.query(sql)
      await client.query('INSERT INTO seller_audit_local.schema_migrations(name, sha256) VALUES ($1, $2)', [name, hash])
      console.log(`Applied ${name}`)
    }
    await client.query('COMMIT')
    console.log(`Local migrations OK (${files.length})`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
} catch {
  console.error('Local migration failed; check database configuration and migration history.')
  process.exitCode = 1
} finally { await pool.end() }
