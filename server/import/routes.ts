import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile,realpath } from 'node:fs/promises'
import { isAbsolute,join,relative,resolve } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'
import { registerSource } from './registerSource.ts'
import { correctWorkbook, type WorkbookEdit, type NewWorkbookSku, type ExcludedWorkbookRow } from './correctWorkbook.ts'
import { LOCAL_MASTER_PARSER_VERSION } from '../../src/services/import/localPolicy.ts'
import { verifyCandidatesAgainstWorkbook, type StoredCandidateSnapshot } from './verifyCandidates.ts'
import { prepareInitialPlan } from './prepareInitialPlan.ts'
import { applyInitialPlan, initialPlanFingerprint } from './applyInitialPlan.ts'
import { prepareExpandedPlan } from './prepareExpandedPlan.ts'
import { applyExpandedPlan,expandedPlanFingerprint } from './applyExpandedPlan.ts'
import { prepareRemainingPlan } from './prepareRemainingPlan.ts'
import { applyRemainingPlan,remainingPlanFingerprint } from './applyRemainingPlan.ts'
import { prepareRetireD08,applyRetireD08,retireD08Fingerprint } from './retireD08.ts'
import {prepareOhouse} from './prepareOhouse.ts'
import {applyOhouse,ohouseFingerprint} from './applyOhouse.ts'
import {prepareOwnedStore,ownedStoreFingerprint} from './prepareOwnedStore.ts'
import {applyOwnedStore} from './applyOwnedStore.ts'
import { analyzeMasterWorkbook } from '../../src/services/import/index.ts'
import { buildMasterImportPayload } from '../../src/services/importPersistence.ts'
import { LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS } from '../../src/services/import/localPolicy.ts'

type Actor = (request:FastifyRequest,mutation:boolean,admin?:boolean)=>Promise<Identity>
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function id(request:FastifyRequest):string {
  const value=(request.params as {id:string}).id
  if(!uuid.test(value))throw new Error('Invalid ID')
  return value
}
function payload(request:FastifyRequest):Record<string,unknown> {
  if(!request.body||typeof request.body!=='object'||Array.isArray(request.body))throw new Error('Invalid input')
  return request.body as Record<string,unknown>
}
export async function registerImportRoutes(app:FastifyInstance,pool:Pool,actor:Actor,root:string):Promise<void> {
  if(!isAbsolute(root))throw new Error('Local storage path must be absolute')
  const relativeToRepo=relative(process.cwd(),resolve(root))
  if(!relativeToRepo||(!relativeToRepo.startsWith('..')&&!isAbsolute(relativeToRepo)))throw new Error('Local storage must be outside repository')
  app.addContentTypeParser('application/octet-stream',{parseAs:'buffer',bodyLimit:52428800},(_request,data,done)=>done(null,data))
  const editor=async(request:FastifyRequest,mutation=false)=>{
    const current=await actor(request,mutation)
    if(current.role!=='ADMIN'&&current.role!=='EDITOR')throw new Error('Not authorized')
    return current
  }
  const fail=(reply:{code:(status:number)=>{send:(v:object)=>unknown}})=>reply.code(400).send({error:'요청을 처리하지 못했습니다. 권한과 저장 상태를 확인해 주세요.'})
  app.get('/api/import/owned-store/plan',async(request,reply)=>{
    try{const current=await actor(request,false,true),plan=await prepareOwnedStore(pool,root,current.workspaceId);return {fingerprint:ownedStoreFingerprint(plan),sourceModifiedAt:plan.sourceModifiedAt,listings:plan.listings.length,optionsNeedReview:plan.listings.filter(x=>x.hasOptions).length,mapped:plan.listings.filter(x=>x.masterProductId).length,unmatchedSingles:plan.listings.filter(x=>!x.hasOptions&&!x.masterProductId).length}}
    catch{return fail(reply)}
  })
  app.post('/api/import/owned-store/apply',async(request,reply)=>{
    try{const current=await actor(request,true,true),data=payload(request);if(process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED!=='YES')return reply.code(403).send({error:'채널 가져오기 기능이 꺼져 있습니다.'});if(data.confirmed!==true||typeof data.fingerprint!=='string')throw new Error('Invalid confirmation');return await applyOwnedStore(pool,root,current,data.fingerprint)}
    catch{return fail(reply)}
  })
  app.post('/api/import/sources',{bodyLimit:52428800},async(request,reply)=>{
    try {
      const current=await editor(request,true);const filename=request.headers['x-source-filename'];const hash=request.headers['x-source-sha256']
      if(typeof filename!=='string'||typeof hash!=='string'||!Buffer.isBuffer(request.body))throw new Error('Invalid source')
      return await registerSource(pool,current,root,{name:decodeURIComponent(filename),bytes:request.body,observedHash:hash})
    }catch{return fail(reply)}
  })
  app.get('/api/import/sources/:id',async(request,reply)=>{
    try {const current=await editor(request);const result=await pool.query(`SELECT s.id,s.workspace_id,s.original_filename,s.verification_status,s.server_verified_sha256,s.server_verified_byte_size,s.verified_at,
      (SELECT l.changed_fields FROM seller_audit_local.activity_logs l WHERE l.workspace_id=s.workspace_id AND l.entity_id=s.id AND l.action_type='IMPORT_SOURCE_CORRECTED' ORDER BY l.created_at DESC LIMIT 1) AS correction
      FROM seller_audit_local.import_source_files s WHERE s.workspace_id=$1 AND s.id=$2`,[current.workspaceId,id(request)])
      if(result.rowCount!==1)throw new Error('Not found');const row=result.rows[0];if(row.server_verified_byte_size!==null)row.server_verified_byte_size=Number(row.server_verified_byte_size);return row
    }catch{return fail(reply)}
  })
  app.get('/api/import/sources/:id/ohouse-plan',async(request,reply)=>{
    try{
      const current=await actor(request,false,true);const plan=await prepareOhouse(pool,root,current.workspaceId,id(request))
      const reasons=Object.fromEntries([...new Set(plan.options.map(o=>o.reason))].map(reason=>[reason,plan.options.filter(o=>o.reason===reason).length]))
      return {fingerprint:ohouseFingerprint(plan),listings:new Set(plan.options.map(o=>o.productCode)).size,options:plan.options.length,mapped:plan.options.filter(o=>o.masterProductId).length,inactive:plan.options.filter(o=>o.status==='INACTIVE').length,reasons}
    }catch{return fail(reply)}
  })
  app.post('/api/import/sources/:id/ohouse-apply',async(request,reply)=>{
    try{const current=await actor(request,true,true);const data=payload(request);if(process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED!=='YES')return reply.code(403).send({error:'채널 가져오기 기능이 꺼져 있습니다.'});if(data.confirmed!==true||typeof data.fingerprint!=='string')throw new Error('Invalid confirmation');return await applyOhouse(pool,root,current,id(request),data.fingerprint)}
    catch{return fail(reply)}
  })
  app.get('/api/import/sources/:id/download',async(request,reply)=>{
    try {const current=await editor(request);const sourceId=id(request);const result=await pool.query("SELECT 1 FROM seller_audit_local.import_source_files WHERE workspace_id=$1 AND id=$2 AND verification_status='VERIFIED'",[current.workspaceId,sourceId])
      if(result.rowCount!==1)throw new Error('Not found')
      const base=await realpath(root);const file=await realpath(join(base,current.workspaceId,sourceId,'source.xlsx'));const rel=relative(base,file)
      if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Invalid path')
      return reply.header('Content-Disposition','attachment; filename="source.xlsx"').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(createReadStream(file))
    }catch{return fail(reply)}
  })
  app.post('/api/import/corrections',{bodyLimit:1024*1024},async(request,reply)=>{
    try {
      const current=await actor(request,true,true);const data=payload(request)
      if(typeof data.sourceFileId!=='string'||!uuid.test(data.sourceFileId)||!Array.isArray(data.edits)||!Array.isArray(data.newSkus)||!Array.isArray(data.ignoredIssues)||data.ignoredIssues.length>100)throw new Error('Invalid correction')
      const excludedRows:ExcludedWorkbookRow[]=[]
      if(data.ignoredIssues.length){
        if(typeof data.batchId!=='string'||!uuid.test(data.batchId))throw new Error('Invalid batch')
        const seen=new Set<string>();const excluded=new Set<number>()
        for(const item of data.ignoredIssues){
          if(!item || typeof item!=='object' || typeof item.issueId!=='string' || !uuid.test(item.issueId) || typeof item.reason!=='string' || !item.reason.trim() || item.reason.length>500 || seen.has(item.issueId))throw new Error('Invalid exclusion')
          seen.add(item.issueId)
          const found=await pool.query<{source_row:number;raw_import_row_id:string;related_raw_row_ids:string[]}>(`SELECT i.source_row,i.raw_import_row_id,i.related_raw_row_ids
            FROM seller_audit_local.import_validation_issues i JOIN seller_audit_local.import_batches b ON b.id=i.import_batch_id AND b.workspace_id=i.workspace_id
            WHERE i.workspace_id=$1 AND b.id=$2 AND b.source_file_id=$3 AND i.id=$4 AND i.source_sheet='단가표' AND i.source_row IS NOT NULL AND i.status='OPEN' AND (i.blocking_scope='BATCH' OR i.severity='ERROR') AND i.validation_revision=b.validation_revision`,[current.workspaceId,data.batchId,data.sourceFileId,item.issueId])
          if(found.rowCount!==1 || !found.rows[0].raw_import_row_id)throw new Error('Issue is not eligible for exclusion')
          const ids=[...new Set([found.rows[0].raw_import_row_id,...found.rows[0].related_raw_row_ids])]
          const raw=await pool.query<{original_row_number:number}>('SELECT original_row_number FROM seller_audit_local.raw_import_rows WHERE workspace_id=$1 AND import_batch_id=$2 AND source_sheet=$3 AND id=ANY($4::uuid[])',[current.workspaceId,data.batchId,'단가표',ids])
          if(raw.rows.length!==ids.length)throw new Error('Excluded rows are not available')
          for(const row of raw.rows)excluded.add(row.original_row_number)
        }
        const linked=await pool.query<{source_row:number}>(`SELECT DISTINCT c.source_row FROM seller_audit_local.import_candidates c
          WHERE c.workspace_id=$1 AND c.import_batch_id=$2 AND c.kind='PRODUCT' AND c.source_sheet='단가표'
            AND btrim(coalesce(c.normalized_values->>'sabangnetCode','')) <> ''
            AND btrim(c.normalized_values->>'sabangnetCode') IN (
              SELECT btrim(coalesce(x.normalized_values->>'sabangnetCode','')) FROM seller_audit_local.import_candidates x
              WHERE x.workspace_id=$1 AND x.import_batch_id=$2 AND x.kind='PRODUCT' AND x.source_sheet='단가표' AND x.source_row=ANY($3::integer[])
            )`,[current.workspaceId,data.batchId,[...excluded]])
        for(const row of linked.rows)excluded.add(row.source_row)
        excludedRows.push(...[...excluded].sort((a,b)=>a-b).map(row=>({sheet:'단가표' as const,row})))
      }
      const parent=await pool.query<{changed_fields:{excludedRows?:unknown;ignoredHistory?:unknown;ignoredIssues?:unknown}}>("SELECT changed_fields FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND entity_id=$2 AND action_type='IMPORT_SOURCE_CORRECTED' ORDER BY created_at DESC LIMIT 1",[current.workspaceId,data.sourceFileId])
      const inherited=parent.rows[0]?.changed_fields?.excludedRows
      if(inherited!==undefined){
        if(!Array.isArray(inherited) || inherited.some(row=>!row || typeof row!=='object' || row.sheet!=='단가표' || !Number.isSafeInteger(row.row) || row.row<6))throw new Error('Invalid previous exclusions')
        const combined=new Set([...excludedRows.map(row=>row.row),...inherited.map(row=>row.row as number)])
        excludedRows.splice(0,excludedRows.length,...[...combined].sort((a,b)=>a-b).map(row=>({sheet:'단가표' as const,row})))
      }
      const priorDecisions=parent.rows[0]?.changed_fields?.ignoredHistory ?? parent.rows[0]?.changed_fields?.ignoredIssues ?? []
      if(!Array.isArray(priorDecisions) || priorDecisions.length>1000 || priorDecisions.some(item=>!item || typeof item!=='object' || typeof item.issueId!=='string' || !uuid.test(item.issueId) || typeof item.reason!=='string' || !item.reason.trim() || item.reason.length>500))throw new Error('Invalid previous exclusion decisions')
      const ignoredHistory=[...priorDecisions,...data.ignoredIssues]
      if(ignoredHistory.length>1000)throw new Error('Too many exclusions')
      const source=await pool.query<{server_verified_sha256:string;server_verified_byte_size:string}>("SELECT server_verified_sha256,server_verified_byte_size FROM seller_audit_local.import_source_files WHERE workspace_id=$1 AND id=$2 AND verification_status='VERIFIED'",[current.workspaceId,data.sourceFileId])
      if(source.rowCount!==1)throw new Error('Source not found')
      const base=await realpath(root);const expected=join(base,current.workspaceId,data.sourceFileId,'source.xlsx');const actual=await realpath(expected)
      if(process.platform==='win32' ? actual.toLowerCase()!==expected.toLowerCase() : actual!==expected)throw new Error('Invalid source path')
      const bytes=await readFile(actual)
      if(bytes.length!==Number(source.rows[0].server_verified_byte_size)||createHash('sha256').update(bytes).digest('hex')!==source.rows[0].server_verified_sha256)throw new Error('Source verification failed')
      const edits=data.edits as WorkbookEdit[];const newSkus=data.newSkus as NewWorkbookSku[];const corrected=correctWorkbook(bytes,edits,newSkus,excludedRows)
      if(corrected.length>52428800)throw new Error('Source too large')
      const hash=createHash('sha256').update(corrected).digest('hex')
      const created=await registerSource(pool,current,root,{name:`corrected-${data.sourceFileId.slice(0,8)}.xlsx`,bytes:corrected,observedHash:hash})
      const recorded=await pool.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields)
        SELECT m.workspace_id,m.user_id,m.actor_ref,'IMPORT_SOURCE_CORRECTED','IMPORT_SOURCE_FILE',$3,jsonb_build_object('originalSourceId',$4::text,'edits',$5::jsonb,'newSkus',$6::jsonb,'ignoredIssues',$7::jsonb,'excludedRows',$8::jsonb,'ignoredHistory',$9::jsonb)
        FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id
        WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role='ADMIN' AND u.status='ACTIVE'`,[current.workspaceId,current.userId,created.id,data.sourceFileId,JSON.stringify(edits),JSON.stringify(newSkus),JSON.stringify(data.ignoredIssues),JSON.stringify(excludedRows),JSON.stringify(ignoredHistory)])
      if(recorded.rowCount!==1)throw new Error('Not authorized')
      return created
    }catch{return fail(reply)}
  })
  app.post('/api/import/batches',{bodyLimit:100*1024*1024},async(request,reply)=>{
    try {const current=await editor(request,true);const data=payload(request);if(typeof data.sourceFileId!=='string'||!uuid.test(data.sourceFileId)||data.parserVersion!==LOCAL_MASTER_PARSER_VERSION)throw new Error('Invalid source or parser version')
      const client=await pool.connect()
      try {
        await client.query('BEGIN')
        const result=await client.query<{id:string}>('SELECT seller_audit_local.persist_verified_master_import_dry_run($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb) AS id',[current.userId,current.workspaceId,data.sourceFileId,JSON.stringify(data.summary),JSON.stringify(data.rawRows),JSON.stringify(data.candidates),JSON.stringify(data.issues)])
        const batchId=result.rows[0].id
        await client.query('UPDATE seller_audit_local.import_batches SET parser_version=$3 WHERE workspace_id=$1 AND id=$2',[current.workspaceId,batchId,LOCAL_MASTER_PARSER_VERSION])
        await client.query("UPDATE seller_audit_local.activity_logs SET changed_fields=jsonb_set(changed_fields,'{parserVersion}',to_jsonb($3::text)) WHERE workspace_id=$1 AND entity_id=$2 AND action_type='IMPORT_VALIDATED'",[current.workspaceId,batchId,LOCAL_MASTER_PARSER_VERSION])
        await client.query('COMMIT')
        return {id:batchId}
      }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    }catch{return fail(reply)}
  })
  app.post('/api/import/sources/:id/analyze',async(request,reply)=>{
    try {
      const current=await actor(request,true,true);const sourceId=id(request)
      const source=await pool.query<{server_verified_sha256:string;server_verified_byte_size:string}>("SELECT server_verified_sha256,server_verified_byte_size FROM seller_audit_local.import_source_files WHERE workspace_id=$1 AND id=$2 AND verification_status='VERIFIED'",[current.workspaceId,sourceId])
      if(source.rowCount!==1)throw new Error('Source not found')
      const base=await realpath(root);const expected=join(base,current.workspaceId,sourceId,'source.xlsx');const actual=await realpath(expected)
      if(process.platform==='win32'?actual.toLowerCase()!==expected.toLowerCase():actual!==expected)throw new Error('Invalid source path')
      const bytes=await readFile(actual);const hash=createHash('sha256').update(bytes).digest('hex')
      if(bytes.length!==Number(source.rows[0].server_verified_byte_size)||hash!==source.rows[0].server_verified_sha256)throw new Error('Source verification failed')
      const input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
      const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
      const data=buildMasterImportPayload(preview,hash);const client=await pool.connect()
      try {
        await client.query('BEGIN')
        const result=await client.query<{id:string}>('SELECT seller_audit_local.persist_verified_master_import_dry_run($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb) AS id',[current.userId,current.workspaceId,sourceId,JSON.stringify(data.p_summary),JSON.stringify(data.p_raw_rows),JSON.stringify(data.p_candidates),JSON.stringify(data.p_issues)])
        const batchId=result.rows[0].id
        await client.query('UPDATE seller_audit_local.import_batches SET parser_version=$3 WHERE workspace_id=$1 AND id=$2',[current.workspaceId,batchId,LOCAL_MASTER_PARSER_VERSION])
        await client.query("UPDATE seller_audit_local.activity_logs SET changed_fields=jsonb_set(changed_fields,'{parserVersion}',to_jsonb($3::text)) WHERE workspace_id=$1 AND entity_id=$2 AND action_type='IMPORT_VALIDATED'",[current.workspaceId,batchId,LOCAL_MASTER_PARSER_VERSION])
        await client.query('COMMIT');return {id:batchId,summary:preview.summary}
      }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
    }catch{return fail(reply)}
  })
  app.get('/api/import/batches',async(request,reply)=>{
    try {const current=await editor(request);const rows=await pool.query("SELECT * FROM seller_audit_local.import_batches WHERE workspace_id=$1 AND source_type='MASTER_WORKBOOK' ORDER BY created_at DESC LIMIT 20",[current.workspaceId]);return rows.rows}
    catch{return fail(reply)}
  })
  for(const [suffix,table] of [['issues','import_validation_issues'],['candidates','import_candidates']] as const){
    app.get(`/api/import/batches/:id/${suffix}`,async(request,reply)=>{
      try {const current=await editor(request);const batchId=id(request);const batch=await pool.query("SELECT 1 FROM seller_audit_local.import_batches WHERE workspace_id=$1 AND id=$2 AND source_type='MASTER_WORKBOOK'",[current.workspaceId,batchId]);if(batch.rowCount!==1)throw new Error('Not found')
        const rows=await pool.query(`SELECT * FROM seller_audit_local.${table} WHERE workspace_id=$1 AND import_batch_id=$2 ORDER BY id`,[current.workspaceId,batchId]);return rows.rows
      }catch{return fail(reply)}
    })
  }
  app.get('/api/import/raw/:id',async(request,reply)=>{
    try {const current=await editor(request);const rows=await pool.query('SELECT * FROM seller_audit_local.raw_import_rows WHERE workspace_id=$1 AND id=$2',[current.workspaceId,id(request)]);if(rows.rowCount!==1)throw new Error('Not found');return rows.rows[0]}
    catch{return fail(reply)}
  })
  app.post('/api/import/candidates/:id/review',async(request,reply)=>{
    try {const current=await actor(request,true,true);const data=payload(request);await pool.query('SELECT seller_audit_local.review_import_candidate($1,$2,$3,$4,$5,$6::jsonb,$7)',[current.userId,current.workspaceId,id(request),data.validationRevision,data.reviewRevision,JSON.stringify(data.reviewedValues),data.resolution]);return {ok:true}}
    catch{return fail(reply)}
  })
  app.post('/api/import/issues/:id/review',async(request,reply)=>{
    try {const current=await actor(request,true,true);const data=payload(request);await pool.query('SELECT seller_audit_local.review_import_validation_issue($1,$2,$3,$4,$5,$6,$7)',[current.userId,current.workspaceId,id(request),data.validationRevision,data.reviewRevision,data.status,data.resolution]);return {ok:true}}
    catch{return fail(reply)}
  })
  app.get('/api/import/batches/:id/preview',async(request,reply)=>{
    try {const current=await editor(request);const rows=await pool.query<{value:unknown}>('SELECT seller_audit_local.preview_master_import_apply($1,$2,$3) AS value',[current.userId,current.workspaceId,id(request)]);return rows.rows[0].value}
    catch{return fail(reply)}
  })
  app.get('/api/import/batches/:id/source-check',async(request,reply)=>{
    try {
      const current=await editor(request);const batchId=id(request)
      const batch=await pool.query<{source_file_id:string;source_file_hash:string;parser_version:string;server_verified_byte_size:string}>(`SELECT b.source_file_id,b.source_file_hash,b.parser_version,s.server_verified_byte_size
        FROM seller_audit_local.import_batches b JOIN seller_audit_local.import_source_files s ON s.id=b.source_file_id AND s.workspace_id=b.workspace_id
        WHERE b.workspace_id=$1 AND b.id=$2 AND s.verification_status='VERIFIED' AND b.source_hash_verification='SERVER_VERIFIED' AND b.source_file_hash=s.server_verified_sha256`,[current.workspaceId,batchId])
      if(batch.rowCount!==1 || batch.rows[0].parser_version!==LOCAL_MASTER_PARSER_VERSION)throw new Error('Batch must be revalidated')
      const sourceId=batch.rows[0].source_file_id;const base=await realpath(root);const expected=join(base,current.workspaceId,sourceId,'source.xlsx');const actual=await realpath(expected)
      if(process.platform==='win32' ? actual.toLowerCase()!==expected.toLowerCase() : actual!==expected)throw new Error('Invalid source path')
      const bytes=await readFile(actual)
      if(bytes.length!==Number(batch.rows[0].server_verified_byte_size))throw new Error('Invalid source size')
      const candidates=await pool.query<StoredCandidateSnapshot>(`SELECT c.kind,c.candidate_ordinal,c.source_sheet,c.source_row,c.source_block,c.candidate_status,c.issue_codes,c.normalized_values,c.reviewed_values
        FROM seller_audit_local.import_candidates c JOIN seller_audit_local.import_batches b ON b.workspace_id=c.workspace_id AND b.id=c.import_batch_id AND b.validation_revision=c.validation_revision
        WHERE c.workspace_id=$1 AND c.import_batch_id=$2 ORDER BY c.kind,c.candidate_ordinal`,[current.workspaceId,batchId])
      return {matches:await verifyCandidatesAgainstWorkbook(bytes,batch.rows[0].source_file_hash,candidates.rows)}
    }catch{return fail(reply)}
  })
  app.get('/api/import/batches/:id/initial-plan',async(request,reply)=>{
    try {
      const current=await editor(request);const plan=await prepareInitialPlan(pool,root,current.workspaceId,id(request))
      return {fingerprint:initialPlanFingerprint(plan),products:plan.products.map(item=>({row:item.product.sourceRow,code:item.product.sabangnetCode,name:item.product.productName,components:item.components.map(component=>({sku:component.skuCode,quantity:component.quantity}))})),skuCount:plan.skus.length,excluded:plan.excluded}
    }catch{return fail(reply)}
  })
  app.post('/api/import/batches/:id/initial-apply',async(request,reply)=>{
    try {
      const current=await actor(request,true,true);const data=payload(request)
      if(process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED!=='YES')return reply.code(403).send({error:'Master 등록 기능이 꺼져 있습니다.'})
      if(data.confirmed!==true || typeof data.fingerprint!=='string')throw new Error('Confirmation required')
      return await applyInitialPlan(pool,root,current,id(request),data.fingerprint)
    }catch{return fail(reply)}
  })
  app.get('/api/import/batches/:id/expanded-plan',async(request,reply)=>{
    try {
      const current=await actor(request,false,true);const plan=await prepareExpandedPlan(pool,root,current.workspaceId,id(request))
      return {fingerprint:expandedPlanFingerprint(plan),productCount:plan.products.length,unlistedCount:plan.unlisted.length,optionCount:plan.collections.reduce((n,c)=>n+c.options.length,0),variantCount:plan.variants.length,skuCount:plan.skus.length,excluded:plan.excluded}
    }catch{return fail(reply)}
  })
  app.post('/api/import/batches/:id/expanded-apply',async(request,reply)=>{
    try {
      const current=await actor(request,true,true);const data=payload(request)
      if(process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED!=='YES')return reply.code(403).send({error:'Master 등록 기능이 꺼져 있습니다.'})
      if(data.confirmed!==true||typeof data.fingerprint!=='string')throw new Error('Confirmation required')
      return await applyExpandedPlan(pool,root,current,id(request),data.fingerprint)
    }catch{return fail(reply)}
  })
  app.get('/api/import/batches/:id/remaining-plan',async(request,reply)=>{
    try {const current=await actor(request,false,true);const plan=await prepareRemainingPlan(pool,root,current.workspaceId,id(request));return {fingerprint:remainingPlanFingerprint(plan),products:plan.products.map(p=>({row:p.product.sourceRow,code:p.product.sabangnetCode,name:p.product.productName})),skuCount:plan.skus.length,excluded:plan.excluded}}
    catch{return fail(reply)}
  })
  app.post('/api/import/batches/:id/remaining-apply',async(request,reply)=>{
    try {const current=await actor(request,true,true);const data=payload(request);if(process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED!=='YES')return reply.code(403).send({error:'Master 등록 기능이 꺼져 있습니다.'});if(data.confirmed!==true||typeof data.fingerprint!=='string')throw new Error('Confirmation required');return await applyRemainingPlan(pool,root,current,id(request),data.fingerprint)}
    catch{return fail(reply)}
  })
  app.get('/api/import/batches/:id/retire-d08-plan',async(request,reply)=>{
    try {const current=await actor(request,false,true);const plan=await prepareRetireD08(pool,root,current.workspaceId,id(request));return {fingerprint:retireD08Fingerprint(plan),productName:plan.product.product.productName,productCode:plan.product.product.sabangnetCode,retiredSku:plan.sku.code,retiredProduct:plan.sticker.code,components:plan.product.components.map(c=>({sku:c.skuCode,quantity:c.quantity}))}}
    catch{return fail(reply)}
  })
  app.post('/api/import/batches/:id/retire-d08-apply',async(request,reply)=>{
    try {const current=await actor(request,true,true);const data=payload(request);if(process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED!=='YES')return reply.code(403).send({error:'Master 등록 기능이 꺼져 있습니다.'});if(data.confirmed!==true||typeof data.fingerprint!=='string')throw new Error('Confirmation required');return await applyRetireD08(pool,root,current,id(request),data.fingerprint)}
    catch{return fail(reply)}
  })
  app.post('/api/import/batches/:id/apply',async(request,reply)=>{
    try {await actor(request,true,true);if(process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED!=='YES')return reply.code(403).send({error:'Master 적용은 별도 승인 전까지 사용할 수 없습니다.'});const data=payload(request);if(data.confirmed!==true)throw new Error('Confirmation required')
      return reply.code(409).send({error:'묶음과 채널별 구성의 적용 기능을 확인하는 중입니다.'})
    }catch{return fail(reply)}
  })
}
