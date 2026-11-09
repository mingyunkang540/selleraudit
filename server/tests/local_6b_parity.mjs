import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { log, error } from 'node:console'
import process from 'node:process'

const db=new PGlite()
try {
  await db.exec('CREATE SCHEMA seller_audit_local')
  for(const file of ['0001_foundation.sql','0002_local_business_tables.sql','0003_local_identity.sql','0004_local_mapping_audit.sql','0005_local_pilot_apply.sql']) {
    await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'))
  }
  let sql=await readFile(new URL('../../supabase/tests/pglite/pilot_master_safe_update_contract.sql',import.meta.url),'utf8')
  const users=Array.from({length:5},(_,i)=>`('00000000-0000-0000-0000-00000000070${i+1}'::uuid,'user${i+1}@example.invalid','Fixture','test','ACTIVE')`).join(',')
  sql=sql.replace(/insert into auth\.users \(id\) values[\s\S]*?;/i,`INSERT INTO seller_audit_local.app_users(id,email,display_name,password_hash,status) VALUES ${users};`)
    .replaceAll('public.','seller_audit_local.')
    .replace(/\bset role authenticated;|\breset role;/gi,'')
    .replace(/seller_audit_local\.(preview_master_import_apply|apply_master_import_batch)\(/g,
      "seller_audit_local.$1(nullif(current_setting('request.jwt.claim.sub',true),'')::uuid,'10000000-0000-0000-0000-000000000701'::uuid,")
  await db.exec(sql)
  log('Local 6B parity contract PASS against synthetic PostgreSQL fixture.')
} catch(cause) {
  error('Local 6B parity contract failed:',cause instanceof Error ? cause.message : 'unknown error')
  process.exitCode=1
} finally {await db.close()}
