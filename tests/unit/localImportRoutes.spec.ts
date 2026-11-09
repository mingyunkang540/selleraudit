import { createHash } from 'node:crypto'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute,join,relative } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { expect,test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createApp } from '../../server/app'
import { activateEmployee, bootstrapAdmin, currentIdentity, inviteEmployee, login } from '../../server/auth/service'
import { LOCAL_MASTER_PARSER_VERSION } from '../../src/services/import/localPolicy'

test('synthetic file goes through verified source, dry-run and preview while new catalog apply remains blocked',async()=>{
  const root=await mkdtemp(join(tmpdir(),'seller-source-test-'));const rel=relative(tmpdir(),root)
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||!rel.startsWith('seller-source-test-'))throw new Error('Unexpected temp directory')
  const db=new PGlite()
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for(const name of ['0001_foundation','0002_local_business_tables','0003_local_identity','0004_local_mapping_audit','0005_local_pilot_apply','0006_local_import_contract']) await db.exec(await readFile(new URL(`../../server/migrations/${name}.sql`,import.meta.url),'utf8'))
    const pool={query:(sql:string,params?:unknown[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>db.query(sql,params),release:()=>{}})} as unknown as Pool
    await bootstrapAdmin(pool,{email:'admin@example.com',displayName:'Admin',password:'admin test password'})
    process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED='YES';process.env.SELLERAUDIT_LOCAL_DATA_DIR=root
    const app=createApp(async()=>{},pool)
    try {
      const headers={host:'127.0.0.1:5174',origin:'http://127.0.0.1:5174'}
      const auth=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:'admin@example.com',password:'admin test password'}})
      const cookie=auth.headers['set-cookie']!.toString().split(';')[0];const csrf=auth.json().csrf as string
      const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([[],[],[],[],[],['','', '단품','냉동용기','상품','AL00 1개',null,1]]),'단가표')
      XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([[],[],[],['','','원본','색상','AL00']]),'코드DB')
      const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}) as Buffer;const hash=createHash('sha256').update(bytes).digest('hex')
      const uploaded=await app.inject({method:'POST',url:'/api/import/sources',headers:{...headers,cookie,'x-csrf-token':csrf,'x-source-filename':'fixture.xlsx','x-source-sha256':hash,'content-type':'application/octet-stream'},payload:bytes})
      expect(uploaded.statusCode).toBe(200)
      const source=uploaded.json().id as string
      const edits=[{sheet:'단가표',address:'B6',before:'',after:'A1'}]
      expect((await app.inject({method:'POST',url:'/api/import/corrections',headers:{...headers,cookie,'x-csrf-token':csrf},payload:{sourceFileId:source,edits:[{...edits[0],before:'stale'}],newSkus:[],ignoredIssues:[]}})).statusCode).toBe(400)
      const adminLogin=await login(pool,'admin@example.com','admin test password')
      const admin=await currentIdentity(pool,adminLogin!.session)
      const activation=await inviteEmployee(pool,admin!,{email:'editor@example.com',displayName:'Editor',role:'EDITOR'})
      await activateEmployee(pool,'editor@example.com',activation,'editor test password')
      const editorLogin=await app.inject({method:'POST',url:'/api/auth/login',headers,payload:{email:'editor@example.com',password:'editor test password'}})
      const editorCookie=editorLogin.headers['set-cookie']!.toString().split(';')[0]
      expect((await app.inject({method:'POST',url:'/api/import/corrections',headers:{...headers,cookie:editorCookie,'x-csrf-token':editorLogin.json().csrf},payload:{sourceFileId:source,edits,newSkus:[],ignoredIssues:[]}})).statusCode).toBe(400)
      const newSkus=[{category:'기타',skuCode:'TEST99',modelName:'테스트',color:'파랑'}]
      const correction=await app.inject({method:'POST',url:'/api/import/corrections',headers:{...headers,cookie,'x-csrf-token':csrf},payload:{sourceFileId:source,edits,newSkus,ignoredIssues:[]}})
      expect(correction.statusCode).toBe(200)
      const original=await app.inject({method:'GET',url:`/api/import/sources/${source}/download`,headers:{host:headers.host,cookie}})
      expect(original.rawPayload.equals(bytes)).toBe(true)
      const derivedId=correction.json().id as string
      const derived=await app.inject({method:'GET',url:`/api/import/sources/${derivedId}/download`,headers:{host:headers.host,cookie}})
      expect(XLSX.read(derived.rawPayload,{type:'buffer'}).Sheets['단가표'].B6.v).toBe('A1')
      expect(XLSX.read(derived.rawPayload,{type:'buffer'}).Sheets['코드DB'].E7.v).toBe('TEST99')
      const audit=await db.query<{changed_fields:{originalSourceId:string;newSkus:typeof newSkus}}>("SELECT changed_fields FROM seller_audit_local.activity_logs WHERE action_type='IMPORT_SOURCE_CORRECTED' AND entity_id=$1",[derivedId])
      expect(audit.rows[0].changed_fields.originalSourceId).toBe(source)
      expect(audit.rows[0].changed_fields.newSkus).toEqual(newSkus)
      const batch=await app.inject({method:'POST',url:'/api/import/batches',headers:{...headers,cookie,'x-csrf-token':csrf},payload:{sourceFileId:source,parserVersion:LOCAL_MASTER_PARSER_VERSION,
        summary:{productCount:1,skuCount:0,bomCount:0,validCount:1,warningCount:0,errorCount:0,deferredCount:0},
        rawRows:[{sourceSheet:'Sheet',originalRowNumber:1,sourceBlock:'PRODUCT',rawCells:[]}],
        candidates:[{kind:'PRODUCT',candidateOrdinal:1,sourceSheet:'Sheet',sourceRow:1,sourceBlock:'PRODUCT',sourceFieldMap:{},status:'VALID',issueCodes:[],normalizedValues:{sabangnetCode:'A1',productName:'Product',category:null,productType:'SINGLE',rawBomText:null,sourceQuantity:null,sourceChannel:null,variantOfSourceRow:null},supportingRows:[]}],issues:[]}})
      expect(batch.statusCode).toBe(200)
      const batchId=batch.json().id as string
      const version=await db.query<{parser_version:string;log_version:string}>("SELECT b.parser_version,l.changed_fields->>'parserVersion' AS log_version FROM seller_audit_local.import_batches b JOIN seller_audit_local.activity_logs l ON l.entity_id=b.id AND l.action_type='IMPORT_VALIDATED' WHERE b.id=$1",[batchId])
      expect(version.rows[0]).toEqual({parser_version:LOCAL_MASTER_PARSER_VERSION,log_version:LOCAL_MASTER_PARSER_VERSION})
      const preview=await app.inject({method:'GET',url:`/api/import/batches/${batchId}/preview`,headers:{host:headers.host,cookie}})
      expect(preview.json().productNew).toBe(1)
      const sourceCheck=await app.inject({method:'GET',url:`/api/import/batches/${batchId}/source-check`,headers:{host:headers.host,cookie}})
      expect(sourceCheck.statusCode).toBe(200)
      expect(sourceCheck.json().matches).toBe(false)
      expect((await app.inject({method:'POST',url:`/api/import/batches/${batchId}/apply`,headers:{...headers,cookie,'x-csrf-token':csrf},payload:{confirmed:true}})).statusCode).toBe(403)
      process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED='YES'
      expect((await app.inject({method:'POST',url:`/api/import/batches/${batchId}/apply`,headers:{...headers,cookie,'x-csrf-token':csrf},payload:{}})).statusCode).toBe(400)
      expect((await app.inject({method:'POST',url:`/api/import/batches/${batchId}/apply`,headers:{...headers,cookie,'x-csrf-token':csrf},payload:{confirmed:true}})).statusCode).toBe(409)
      expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM seller_audit_local.products')).rows[0].n).toBe(0)
    }finally {await app.close()}
  }finally {delete process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED;delete process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED;delete process.env.SELLERAUDIT_LOCAL_DATA_DIR;await db.close();await rm(root,{recursive:true,force:true})}
})
