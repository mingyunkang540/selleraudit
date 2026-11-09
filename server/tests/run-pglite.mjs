import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { URL, pathToFileURL } from 'node:url'
import process from 'node:process'
import { log } from 'node:console'

if (!process.argv[2]) throw new Error('Provide an absolute PGlite dist/index.js path')
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href)
const db = new PGlite()
try {
  await db.exec('CREATE SCHEMA seller_audit_local')
  for (const name of ['0001_foundation.sql', '0002_local_business_tables.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  }
  const result = await db.query("select count(*)::int as count from information_schema.tables where table_schema = 'seller_audit_local' and table_type = 'BASE TABLE'")
  if (result.rows[0].count !== 18) throw new Error('Unexpected local table count')
  await db.exec(await readFile(new URL('./local_schema_contract.sql', import.meta.url), 'utf8'))
  log('Local schema contract PASS: 16 business tables, identity placeholder, foundation, workspace isolation, keys, role defaults and immutable candidate.')
  await db.exec(await readFile(new URL('../migrations/0003_local_identity.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('./local_identity_contract.sql', import.meta.url), 'utf8'))
  log('Local identity schema PASS: unique normalized email, active password requirement, hashed token constraints and foreign keys.')
} finally { await db.close() }
