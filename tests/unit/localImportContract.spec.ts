import { readFile } from 'node:fs/promises'
import { mkdtemp,rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join,relative,isAbsolute } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { expect,test } from '@playwright/test'
import { activateEmployee,bootstrapAdmin,currentIdentity,inviteEmployee,login } from '../../server/auth/service'
import { registerSource } from '../../server/import/registerSource'

test('local import SQL requires a verified source and restricts review to ADMIN',async()=>{
  const db=new PGlite()
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for(const name of ['0001_foundation','0002_local_business_tables','0003_local_identity','0004_local_mapping_audit','0005_local_pilot_apply','0006_local_import_contract']) await db.exec(await readFile(new URL(`../../server/migrations/${name}.sql`,import.meta.url),'utf8'))
    const pool={query:(sql:string,params?:unknown[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>db.query(sql,params),release:()=>{}})} as unknown as Pool
    await bootstrapAdmin(pool,{email:'admin@example.com',displayName:'Admin',password:'admin test password'})
    const adminSession=await login(pool,'admin@example.com','admin test password');const admin=(await currentIdentity(pool,adminSession!.session))!
    const code=await inviteEmployee(pool,admin,{email:'editor@example.com',displayName:'Editor',role:'EDITOR'})
    await activateEmployee(pool,'editor@example.com',code,'editor test password')
    const editorSession=await login(pool,'editor@example.com','editor test password');const editor=(await currentIdentity(pool,editorSession!.session))!
    const source=randomUUID(), hash='a'.repeat(64)
    await db.query(`INSERT INTO seller_audit_local.import_source_files(id,workspace_id,original_filename,storage_object_path,client_observed_byte_size,client_observed_sha256,created_by)
      VALUES($1,$2,'fixture.xlsx',$3,1,$4,$5)`,[source,admin.workspaceId,`${admin.workspaceId}/${source}/source.xlsx`,hash,admin.userId])
    const summary={productCount:1,skuCount:0,bomCount:0,validCount:1,warningCount:0,errorCount:0,deferredCount:0}
    const raw=[{sourceSheet:'Sheet',originalRowNumber:1,sourceBlock:'PRODUCT',rawCells:[]}]
    const candidates=[{kind:'PRODUCT',candidateOrdinal:1,sourceSheet:'Sheet',sourceRow:1,sourceBlock:'PRODUCT',sourceFieldMap:{},status:'VALID',issueCodes:[],normalizedValues:{sabangnetCode:'A1',productName:'Product',category:null,productType:'SINGLE',rawBomText:null,sourceQuantity:null,sourceChannel:null,variantOfSourceRow:null},supportingRows:[]}]
    const save=(actor:string)=>db.query<{id:string}>('SELECT seller_audit_local.persist_verified_master_import_dry_run($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb) AS id',[actor,admin.workspaceId,source,JSON.stringify(summary),JSON.stringify(raw),JSON.stringify(candidates),'[]'])
    await expect(save(admin.userId)).rejects.toThrow('verified source')
    await db.query("UPDATE seller_audit_local.import_source_files SET verification_status='VERIFIED',server_verified_byte_size=1,server_verified_sha256=$2,verified_by=$3,verified_at=now() WHERE id=$1",[source,hash,admin.userId])
    const saved=await save(editor.userId)
    const candidate=await db.query<{id:string}>('SELECT id FROM seller_audit_local.import_candidates WHERE import_batch_id=$1',[saved.rows[0].id])
    const review=(actor:string)=>db.query('SELECT seller_audit_local.review_import_candidate($1,$2,$3,1,0,$4::jsonb,$5)',[actor,admin.workspaceId,candidate.rows[0].id,JSON.stringify({productName:'Reviewed'}),'synthetic evidence'])
    await expect(review(editor.userId)).rejects.toThrow()
    await review(admin.userId)
    await expect(review(admin.userId)).rejects.toThrow()
    const current=await db.query<{value:string}>('SELECT normalized_values->>\'productName\' AS value FROM seller_audit_local.import_candidates WHERE id=$1',[candidate.rows[0].id])
    expect(current.rows[0].value).toBe('Product')
    expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM seller_audit_local.products')).rows[0].n).toBe(0)
  } finally {await db.close()}
})

test('local source registration verifies bytes and records role-checked metadata',async()=>{
  const db=new PGlite();const root=await mkdtemp(join(tmpdir(),'seller-source-test-'));const rel=relative(tmpdir(),root)
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!rel.startsWith('seller-source-test-'))throw new Error('Unexpected temp directory')
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for(const name of ['0001_foundation','0002_local_business_tables','0003_local_identity']) await db.exec(await readFile(new URL(`../../server/migrations/${name}.sql`,import.meta.url),'utf8'))
    const pool={query:(sql:string,params?:unknown[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>db.query(sql,params),release:()=>{}})} as unknown as Pool
    await bootstrapAdmin(pool,{email:'admin@example.com',displayName:'Admin',password:'admin test password'})
    const session=await login(pool,'admin@example.com','admin test password');const actor=(await currentIdentity(pool,session!.session))!
    const bytes=Buffer.from('synthetic');const hash=createHash('sha256').update(bytes).digest('hex')
    const source=await registerSource(pool,actor,root,{name:'fixture.xlsx',bytes,observedHash:hash})
    const row=await db.query<{verification_status:string;server_verified_sha256:string}>('SELECT verification_status,server_verified_sha256 FROM seller_audit_local.import_source_files WHERE id=$1',[source.id])
    expect(row.rows[0]).toEqual({verification_status:'VERIFIED',server_verified_sha256:hash})
    await expect(registerSource(pool,{...actor,role:'VIEWER'},root,{name:'fixture.xlsx',bytes,observedHash:hash})).rejects.toThrow('Not authorized')
    await expect(registerSource(pool,actor,root,{name:'fixture.xlsx',bytes,observedHash:'0'.repeat(64)})).rejects.toThrow('verification')
    const counts=await db.query<{n:number}>("SELECT count(*)::int AS n FROM seller_audit_local.import_source_files WHERE verification_status='HASH_MISMATCH'")
    expect(counts.rows[0].n).toBe(1)
  }finally{await db.close();await rm(root,{recursive:true,force:true})}
})
