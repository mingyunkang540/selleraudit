import { createHash } from 'node:crypto'
import { readFile,realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { analyzeMasterWorkbook } from '../../src/services/import/index.ts'
import { LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_MASTER_PARSER_VERSION,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS } from '../../src/services/import/localPolicy.ts'
import { verifyCandidatesAgainstWorkbook,type StoredCandidateSnapshot } from './verifyCandidates.ts'
import { expandedCatalogPlan } from './expandedCatalogPlan.ts'

type Reader=Pick<Pool,'query'>
const hash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
const rows=[82,110,114,125,191,192,193,194]
const approved={D08:{name:'견출지',color:'화이트'},D16:{name:'쿨링 쇼퍼백',color:null},D17:{name:'쿨링 런치백',color:null},D18:{name:'키친마카',color:null}} as const

export async function prepareRemainingPlan(db:Reader,root:string,workspaceId:string,batchId:string){
  const batches=await db.query<{source_file_id:string;source_file_hash:string;parser_version:string;server_verified_byte_size:string}>(`SELECT b.source_file_id,b.source_file_hash,b.parser_version,s.server_verified_byte_size FROM seller_audit_local.import_batches b JOIN seller_audit_local.import_source_files s ON s.id=b.source_file_id AND s.workspace_id=b.workspace_id WHERE b.workspace_id=$1 AND b.id=$2 AND b.status='PARTIALLY_APPLIED' AND b.source_type='MASTER_WORKBOOK' AND s.verification_status='VERIFIED' AND b.source_hash_verification='SERVER_VERIFIED' AND b.source_file_hash=s.server_verified_sha256`,[workspaceId,batchId])
  if(batches.rowCount!==1||batches.rows[0].parser_version!==LOCAL_MASTER_PARSER_VERSION||batches.rows[0].source_file_hash!==hash)throw new Error('Source requires review')
  const audit=await db.query<{changed_fields:{mode?:string;excluded?:{row:number}[]}}>("SELECT changed_fields FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND entity_id=$2 AND action_type='IMPORT_APPLIED' ORDER BY created_at DESC LIMIT 1",[workspaceId,batchId])
  const recorded=audit.rows[0]?.changed_fields
  if(recorded?.mode!=='EXPANDED_CREATE'||!Array.isArray(recorded.excluded)||JSON.stringify(recorded.excluded.map(item=>item.row).sort((a,b)=>a-b))!==JSON.stringify(rows))throw new Error('Previous exclusions require review')
  const batch=batches.rows[0];const base=await realpath(root);const expected=join(base,workspaceId,batch.source_file_id,'source.xlsx');const actual=await realpath(expected)
  if(process.platform==='win32'?actual.toLowerCase()!==expected.toLowerCase():actual!==expected)throw new Error('Invalid source path')
  const bytes=await readFile(actual)
  if(bytes.length!==Number(batch.server_verified_byte_size)||createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Source hash mismatch')
  const snapshots=await db.query<StoredCandidateSnapshot>(`SELECT c.kind,c.candidate_ordinal,c.source_sheet,c.source_row,c.source_block,c.candidate_status,c.issue_codes,c.normalized_values,c.reviewed_values FROM seller_audit_local.import_candidates c JOIN seller_audit_local.import_batches b ON b.workspace_id=c.workspace_id AND b.id=c.import_batch_id AND b.validation_revision=c.validation_revision WHERE c.workspace_id=$1 AND c.import_batch_id=$2`,[workspaceId,batchId])
  if(!await verifyCandidatesAgainstWorkbook(bytes,hash,snapshots.rows))throw new Error('Source and validation differ')
  const input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
  const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
  const normalized=Object.entries(approved).map(([code,value])=>{
    const registry=preview.skus.filter(s=>s.skuCode===code&&s.registryStatus==='BOM_REGISTRY')
    const named=registry.find(s=>s.modelName===value.name)
    if(!named||!registry.some(s=>s.color===value.color))throw new Error('Approved SKU information changed')
    return {...named,modelName:value.name,color:value.color}
  })
  const selectedProducts=preview.products.filter(p=>rows.includes(p.sourceRow))
  if(selectedProducts.length!==rows.length)throw new Error('Expected rows changed')
  const scoped={...preview,products:selectedProducts,skus:[...preview.skus.filter(s=>!Object.hasOwn(approved,s.skuCode)),...normalized],bomComponents:preview.bomComponents.filter(c=>rows.includes(c.productSourceRow)),issues:preview.issues.filter(i=>i.sourceRow!==null&&rows.includes(i.sourceRow))}
  if(scoped.bomComponents.some(c=>Object.hasOwn(LOCAL_SKU_COMPONENTS,c.skuCode)))throw new Error('Bundle SKU requires review')
  const products=await db.query<{id:string;code:string;name:string;category:string|null;type:string;status:string}>('SELECT id,sabangnet_code AS code,product_name AS name,category,product_type AS type,status FROM seller_audit_local.products WHERE workspace_id=$1',[workspaceId])
  const components=await db.query<{product_id:string;sku:string;quantity:number}>(`SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1`,[workspaceId])
  const skus=await db.query<{code:string;name:string;color:string|null;status:string}>('SELECT sku_code AS code,model_name AS name,color,status FROM seller_audit_local.skus WHERE workspace_id=$1',[workspaceId])
  const existing=products.rows.map(p=>({...p,components:components.rows.filter(c=>c.product_id===p.id).map(c=>({sku:c.sku,quantity:c.quantity}))}))
  const plan=expandedCatalogPlan(scoped,{unlistedRows:[],collections:[]},existing,skus.rows)
  // Do not attach variants to products which appeared after the first import.
  const previouslyExisting=new Set(existing.map(p=>p.code))
  const overlap=plan.products.filter(p=>p.product.sabangnetCode&&previouslyExisting.has(p.product.sabangnetCode))
  const selected=plan.products.filter(p=>!p.product.sabangnetCode||!previouslyExisting.has(p.product.sabangnetCode))
  const needed=new Set(selected.flatMap(p=>p.components.map(c=>c.skuCode)))
  return {sourceFileId:batch.source_file_id,sourceHash:hash,approvals:approved,...plan,products:selected,skus:plan.skus.filter(s=>needed.has(s.skuCode)),excluded:[...plan.excluded,...overlap.map(p=>({row:p.product.sourceRow,name:p.product.productName,reasons:['기존 상품을 확인해야 합니다.']}))].sort((a,b)=>a.row-b.row)}
}
