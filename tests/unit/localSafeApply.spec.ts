import { createHash } from 'node:crypto'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute,join,relative } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { expect,test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createApp } from '../../server/app'
import { bootstrapAdmin, currentIdentity, login } from '../../server/auth/service'
import { prepareInitialPlan } from '../../server/import/prepareInitialPlan'
import { applyInitialPlan, initialPlanFingerprint } from '../../server/import/applyInitialPlan'
import { analyzeMasterWorkbook } from '../../src/services/import'
import { buildMasterImportPayload } from '../../src/services/importPersistence'
import { LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_MASTER_PARSER_VERSION,LOCAL_SKU_COMPONENTS } from '../../src/services/import/localPolicy'

test('initial application commits complete products and records excluded products atomically',async()=>{
  const root=await mkdtemp(join(tmpdir(),'seller-safe-test-'));const rel=relative(tmpdir(),root)
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!rel.startsWith('seller-safe-test-'))throw new Error('Unexpected temporary directory')
  const db=new PGlite()
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for(const file of ['0001_foundation','0002_local_business_tables','0003_local_identity','0004_local_mapping_audit','0005_local_pilot_apply','0006_local_import_contract'])await db.exec(await readFile(new URL(`../../server/migrations/${file}.sql`,import.meta.url),'utf8'))
    const pool={query:(sql:string,params?:unknown[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>db.query(sql,params),release:()=>{}})} as unknown as Pool
    await bootstrapAdmin(pool,{email:'admin@example.com',displayName:'Admin',password:'test admin password'})
    process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED='YES';process.env.SELLERAUDIT_LOCAL_DATA_DIR=root
    const app=createApp(async()=>{},pool)
    try {
      const headers={host:'127.0.0.1:5174',origin:'http://127.0.0.1:5174'}
      const auth=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:'admin@example.com',password:'test admin password'}})
      const cookie=auth.headers['set-cookie']!.toString().split(';')[0];const csrf=auth.json().csrf as string
      const book=XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],[],[],[],[null,'사방넷품번','구분','카테고리','모델명','구성 상세',null,'구성수'],[null,'1001','단품','냉동용기','정상','AL00 1개',null,1],[null,null,'단품','냉동용기','보류','AL00 1개',null,1]]),'단가표')
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],[],[null,null,'상품명','옵션명','상품코드'],[null,'냉동용기'],[null,null,'상품','라벤더','AL00']]),'코드DB')
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],[],['마스터 상품명',null,'사방넷 품번코드']]),'상품DB')
      const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer;const hash=createHash('sha256').update(bytes).digest('hex')
      const upload=await app.inject({method:'POST',url:'/api/import/sources',headers:{...headers,cookie,'x-csrf-token':csrf,'x-source-filename':'fixture.xlsx','x-source-sha256':hash,'content-type':'application/octet-stream'},payload:bytes})
      expect(upload.statusCode).toBe(200)
      const preview=await analyzeMasterWorkbook(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer,'fixture.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS})
      const payload=buildMasterImportPayload(preview,hash)
      const saved=await app.inject({method:'POST',url:'/api/import/batches',headers:{...headers,cookie,'x-csrf-token':csrf},payload:{sourceFileId:upload.json().id,parserVersion:LOCAL_MASTER_PARSER_VERSION,summary:payload.p_summary,rawRows:payload.p_raw_rows,candidates:payload.p_candidates,issues:payload.p_issues}})
      expect(saved.statusCode).toBe(200)
      const batchId=saved.json().id as string;const session=await login(pool,'admin@example.com','test admin password');const identity=await currentIdentity(pool,session!.session)
      await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields)
        SELECT workspace_id,user_id,actor_ref,'IMPORT_SOURCE_CORRECTED','IMPORT_SOURCE_FILE',$3,$4::jsonb FROM seller_audit_local.workspace_members WHERE workspace_id=$1 AND user_id=$2`,[identity!.workspaceId,identity!.userId,upload.json().id,JSON.stringify({excludedRows:[{sheet:'단가표',row:20}]})])
      const plan=await prepareInitialPlan(pool,root,identity!.workspaceId,batchId)
      expect(plan.products.map(item=>item.product.sabangnetCode)).toEqual(['1001'])
      expect(plan.excluded.map(item=>item.row)).toEqual([7,20])
      const apiPlan=await app.inject({method:'GET',url:`/api/import/batches/${batchId}/initial-plan`,headers:{host:headers.host,cookie}})
      expect(apiPlan.statusCode).toBe(200)
      expect(apiPlan.json().fingerprint).toBe(initialPlanFingerprint(plan))
      await expect(applyInitialPlan(pool,root,identity!,batchId,'0'.repeat(64))).rejects.toThrow('Plan changed or empty')
      expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM seller_audit_local.products')).rows[0].n).toBe(0)
      await db.exec("CREATE FUNCTION seller_audit_local.fixture_reject_component() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER fixture_reject BEFORE INSERT ON seller_audit_local.product_components FOR EACH ROW EXECUTE FUNCTION seller_audit_local.fixture_reject_component()")
      await expect(applyInitialPlan(pool,root,identity!,batchId,initialPlanFingerprint(plan))).rejects.toThrow('synthetic failure')
      expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM seller_audit_local.products')).rows[0].n).toBe(0)
      expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM seller_audit_local.skus')).rows[0].n).toBe(0)
      await db.exec('DROP TRIGGER fixture_reject ON seller_audit_local.product_components; DROP FUNCTION seller_audit_local.fixture_reject_component()')
      const blocked=await app.inject({method:'POST',url:`/api/import/batches/${batchId}/initial-apply`,headers:{...headers,cookie,'x-csrf-token':csrf},payload:{confirmed:true,fingerprint:initialPlanFingerprint(plan)}})
      expect(blocked.statusCode).toBe(403)
      process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED='YES'
      const applied=await app.inject({method:'POST',url:`/api/import/batches/${batchId}/initial-apply`,headers:{...headers,cookie,'x-csrf-token':csrf},payload:{confirmed:true,fingerprint:initialPlanFingerprint(plan)}})
      expect(applied.statusCode).toBe(200)
      const result=applied.json()
      expect(result).toMatchObject({productsCreated:1,skusCreated:1,componentsCreated:1,status:'PARTIALLY_APPLIED'})
      expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM seller_audit_local.product_components')).rows[0].n).toBe(1)
      expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM seller_audit_local.activity_logs WHERE action_type='IMPORT_APPLIED'")).rows[0].n).toBe(1)
      await expect(applyInitialPlan(pool,root,identity!,batchId,initialPlanFingerprint(plan))).rejects.toThrow('Batch is not eligible')
    }finally{await app.close()}
  }finally{delete process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED;delete process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED;delete process.env.SELLERAUDIT_LOCAL_DATA_DIR;await db.close();await rm(root,{recursive:true,force:true})}
})
