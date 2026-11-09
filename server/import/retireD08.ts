import { createHash } from 'node:crypto'
import { readFile,realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'
import { analyzeMasterWorkbook } from '../../src/services/import/index.ts'
import { LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_MASTER_PARSER_VERSION,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS } from '../../src/services/import/localPolicy.ts'
import { verifyCandidatesAgainstWorkbook,type StoredCandidateSnapshot } from './verifyCandidates.ts'
import { expandedCatalogPlan } from './expandedCatalogPlan.ts'

type Reader=Pick<Pool,'query'>
const sourceHash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
export async function prepareRetireD08(db:Reader,root:string,workspaceId:string,batchId:string){
  const batchResult=await db.query<{source_file_id:string;source_file_hash:string;parser_version:string;server_verified_byte_size:string}>(`SELECT b.source_file_id,b.source_file_hash,b.parser_version,s.server_verified_byte_size FROM seller_audit_local.import_batches b JOIN seller_audit_local.import_source_files s ON s.id=b.source_file_id AND s.workspace_id=b.workspace_id WHERE b.workspace_id=$1 AND b.id=$2 AND b.status='PARTIALLY_APPLIED' AND b.source_type='MASTER_WORKBOOK' AND s.verification_status='VERIFIED' AND b.source_hash_verification='SERVER_VERIFIED' AND b.source_file_hash=s.server_verified_sha256`,[workspaceId,batchId])
  if(batchResult.rowCount!==1||batchResult.rows[0].source_file_hash!==sourceHash||batchResult.rows[0].parser_version!==LOCAL_MASTER_PARSER_VERSION)throw new Error('Source requires review')
  const audit=await db.query<{changed_fields:{mode?:string;excluded?:{row:number}[]}}>("SELECT changed_fields FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND entity_id=$2 AND action_type='IMPORT_APPLIED' ORDER BY created_at DESC LIMIT 1",[workspaceId,batchId])
  const prior=audit.rows[0]?.changed_fields
  if(prior?.mode!=='CONFIRMED_REMAINING_CREATE'||!Array.isArray(prior.excluded)||![125,194].every(row=>prior.excluded!.some(item=>item.row===row)))throw new Error('Prior exclusions require review')
  const batch=batchResult.rows[0];const base=await realpath(root);const expected=join(base,workspaceId,batch.source_file_id,'source.xlsx');const actual=await realpath(expected)
  if(process.platform==='win32'?actual.toLowerCase()!==expected.toLowerCase():actual!==expected)throw new Error('Invalid source path')
  const bytes=await readFile(actual)
  if(bytes.length!==Number(batch.server_verified_byte_size)||createHash('sha256').update(bytes).digest('hex')!==sourceHash)throw new Error('Source hash mismatch')
  const snapshots=await db.query<StoredCandidateSnapshot>(`SELECT c.kind,c.candidate_ordinal,c.source_sheet,c.source_row,c.source_block,c.candidate_status,c.issue_codes,c.normalized_values,c.reviewed_values FROM seller_audit_local.import_candidates c JOIN seller_audit_local.import_batches b ON b.workspace_id=c.workspace_id AND b.id=c.import_batch_id AND b.validation_revision=c.validation_revision WHERE c.workspace_id=$1 AND c.import_batch_id=$2`,[workspaceId,batchId])
  if(!await verifyCandidatesAgainstWorkbook(bytes,sourceHash,snapshots.rows))throw new Error('Source and validation differ')
  const input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
  const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
  const original=preview.products.find(p=>p.sourceRow===125);const bom=preview.bomComponents.filter(c=>c.productSourceRow===125)
  if(!original||original.sabangnetCode!=='100472'||original.productName!=='땡스소윤 냉동용기 완벽정리세트 27P'||original.sourceQuantity!==27||bom.filter(c=>c.skuCode==='D08'&&c.quantity===1).length!==1)throw new Error('Original product changed')
  const remaining=bom.filter(c=>c.skuCode!=='D08')
  if(remaining.some(c=>Object.hasOwn(LOCAL_SKU_COMPONENTS,c.skuCode)||LOCAL_NON_COUNTED_SKUS.includes(c.skuCode as typeof LOCAL_NON_COUNTED_SKUS[number]))||remaining.reduce((n,c)=>n+c.quantity,0)!==26)throw new Error('Composition requires review')
  const product={...original,productName:'땡스소윤 냉동용기 완벽정리세트 26P',sourceQuantity:26}
  const scoped={...preview,products:[product],bomComponents:remaining,issues:preview.issues.filter(i=>i.sourceRow===125)}
  const products=await db.query<{id:string;code:string;name:string;category:string|null;type:string;status:string}>('SELECT id,sabangnet_code AS code,product_name AS name,category,product_type AS type,status FROM seller_audit_local.products WHERE workspace_id=$1',[workspaceId])
  const components=await db.query<{product_id:string;sku:string;quantity:number}>(`SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1`,[workspaceId])
  const skus=await db.query<{id:string;code:string;name:string;color:string|null;status:string}>('SELECT id,sku_code AS code,model_name AS name,color,status FROM seller_audit_local.skus WHERE workspace_id=$1',[workspaceId])
  const sku=skus.rows.filter(s=>s.code==='D08');const sticker=products.rows.filter(p=>p.code==='100089')
  if(sku.length!==1||sku[0].name!=='견출지'||sku[0].status!=='ACTIVE'||sticker.length!==1||sticker[0].name!=='견출지'||sticker[0].status!=='ACTIVE'||products.rows.some(p=>p.code==='100472'))throw new Error('Current SKU or product requires review')
  const refs=components.rows.filter(c=>c.sku==='D08')
  if(refs.length!==1||refs[0].product_id!==sticker[0].id||refs[0].quantity!==1)throw new Error('SKU is used by another product')
  const extra=await db.query<{n:string}>(`SELECT (SELECT count(*) FROM seller_audit_local.unlisted_bundle_components WHERE workspace_id=$1 AND sku_id=$2)+(SELECT count(*) FROM seller_audit_local.market_collection_options WHERE workspace_id=$1 AND sku_id=$2)+(SELECT count(*) FROM seller_audit_local.product_channel_variant_components WHERE workspace_id=$1 AND sku_id=$2)+(SELECT count(*) FROM seller_audit_local.sku_assembly_components WHERE workspace_id=$1 AND (assembly_sku_id=$2 OR component_sku_id=$2)) AS n`,[workspaceId,sku[0].id])
  if(Number(extra.rows[0].n)!==0)throw new Error('SKU has additional dependencies')
  const existing=products.rows.map(p=>({...p,components:components.rows.filter(c=>c.product_id===p.id).map(c=>({sku:c.sku,quantity:c.quantity}))}))
  const plan=expandedCatalogPlan(scoped,{unlistedRows:[],collections:[]},existing,skus.rows)
  if(plan.products.length!==1||plan.excluded.length)throw new Error('Product or SKU conflict requires review')
  return {sourceHash,sourceFileId:batch.source_file_id,sku:sku[0],sticker:sticker[0],product:plan.products[0],skus:plan.skus}
}
export function retireD08Fingerprint(plan:Awaited<ReturnType<typeof prepareRetireD08>>){return createHash('sha256').update(JSON.stringify(plan)).digest('hex')}
export async function applyRetireD08(pool:Pool,root:string,identity:Identity,batchId:string,fingerprint:string){
  if(identity.role!=='ADMIN'||!/^[0-9a-f]{64}$/.test(fingerprint))throw new Error('Not authorized')
  const db=await pool.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[identity.workspaceId,identity.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[identity.workspaceId])
    for(const table of ['import_batches','import_candidates','import_validation_issues','products','skus','product_components'])await db.query(`SELECT id FROM seller_audit_local.${table} WHERE workspace_id=$1 ORDER BY id FOR UPDATE`,[identity.workspaceId])
    const plan=await prepareRetireD08(db,root,identity.workspaceId,batchId)
    if(retireD08Fingerprint(plan)!==fingerprint)throw new Error('Plan changed')
    const workspace=identity.workspaceId;let skusCreated=0
    const ids=new Map<string,string>()
    for(const s of plan.skus){
      const created=await db.query<{id:string}>("INSERT INTO seller_audit_local.skus(workspace_id,sku_code,model_name,color,status) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(workspace_id,sku_code) DO NOTHING RETURNING id",[workspace,s.skuCode,s.modelName,s.color]);skusCreated+=created.rowCount??0
      const found=created.rowCount?created:await db.query<{id:string}>('SELECT id FROM seller_audit_local.skus WHERE workspace_id=$1 AND sku_code=$2',[workspace,s.skuCode])
      if(found.rowCount!==1)throw new Error('SKU unavailable');ids.set(s.skuCode,found.rows[0].id)
    }
    const p=plan.product.product
    const product=await db.query<{id:string}>("INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,category,product_type,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING id",[workspace,p.sabangnetCode,p.productName,p.category,p.productType])
    let variantId:string|null=null
    if(p.sourceChannel&&p.sourceChannel!=='공통'){
      const variant=await db.query<{id:string}>('INSERT INTO seller_audit_local.product_channel_variants(workspace_id,product_id,source_file_id,source_row,source_channel) VALUES($1,$2,$3,$4,$5) RETURNING id',[workspace,product.rows[0].id,plan.sourceFileId,p.sourceRow,p.sourceChannel]);variantId=variant.rows[0].id
    }
    for(const c of plan.product.components){const skuId=ids.get(c.skuCode);if(!skuId)throw new Error('SKU unavailable');await db.query('INSERT INTO seller_audit_local.product_components(workspace_id,product_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,product.rows[0].id,skuId,c.quantity]);if(variantId)await db.query('INSERT INTO seller_audit_local.product_channel_variant_components(workspace_id,variant_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,variantId,skuId,c.quantity])}
    const updatedSku=await db.query("UPDATE seller_audit_local.skus SET status='INACTIVE' WHERE workspace_id=$1 AND id=$2 AND status='ACTIVE' RETURNING id",[workspace,plan.sku.id])
    const updatedProduct=await db.query("UPDATE seller_audit_local.products SET status='INACTIVE' WHERE workspace_id=$1 AND id=$2 AND status='ACTIVE' RETURNING id",[workspace,plan.sticker.id])
    if(updatedSku.rowCount!==1||updatedProduct.rowCount!==1)throw new Error('Retirement changed')
    const result={productsCreated:1,skusCreated,componentsCreated:plan.product.components.length,retiredSku:'D08',retiredProduct:'100089',productCode:p.sabangnetCode,productName:p.productName}
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'SKU_RETIRED_AND_PRODUCT_CREATED','IMPORT_BATCH',$4,$5::jsonb)`,[workspace,identity.userId,member.rows[0].actor_ref,batchId,JSON.stringify({fingerprint,sourceHash,...result,removedSku:'D08',sourceRow:125})])
    await db.query('COMMIT');return result
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
