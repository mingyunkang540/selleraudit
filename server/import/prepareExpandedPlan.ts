import { createHash } from 'node:crypto'
import { readFile,realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { analyzeMasterWorkbook } from '../../src/services/import/index.ts'
import { LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_MASTER_PARSER_VERSION,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS } from '../../src/services/import/localPolicy.ts'
import { verifyCandidatesAgainstWorkbook,type StoredCandidateSnapshot } from './verifyCandidates.ts'
import { expandedCatalogPlan } from './expandedCatalogPlan.ts'

type Reader=Pick<Pool,'query'>
// Decisions are tied to the exact file the owner reviewed, never to row
// numbers in an arbitrary subsequent workbook.
const approvedHash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
export async function prepareExpandedPlan(db:Reader,root:string,workspaceId:string,batchId:string){
  const batches=await db.query<{source_file_id:string;source_file_hash:string;parser_version:string;server_verified_byte_size:string}>(`SELECT b.source_file_id,b.source_file_hash,b.parser_version,s.server_verified_byte_size
    FROM seller_audit_local.import_batches b JOIN seller_audit_local.import_source_files s ON s.id=b.source_file_id AND s.workspace_id=b.workspace_id
    WHERE b.workspace_id=$1 AND b.id=$2 AND b.status='REVIEW_REQUIRED' AND b.source_type='MASTER_WORKBOOK' AND s.verification_status='VERIFIED' AND b.source_hash_verification='SERVER_VERIFIED' AND b.source_file_hash=s.server_verified_sha256`,[workspaceId,batchId])
  if(batches.rowCount!==1 || batches.rows[0].parser_version!==LOCAL_MASTER_PARSER_VERSION || batches.rows[0].source_file_hash!==approvedHash)throw new Error('This source requires owner review')
  const batch=batches.rows[0];const base=await realpath(root);const expected=join(base,workspaceId,batch.source_file_id,'source.xlsx');const actual=await realpath(expected)
  if(process.platform==='win32'?actual.toLowerCase()!==expected.toLowerCase():actual!==expected)throw new Error('Invalid source path')
  const bytes=await readFile(actual)
  if(bytes.length!==Number(batch.server_verified_byte_size)||createHash('sha256').update(bytes).digest('hex')!==approvedHash)throw new Error('Source hash mismatch')
  const snapshots=await db.query<StoredCandidateSnapshot>(`SELECT c.kind,c.candidate_ordinal,c.source_sheet,c.source_row,c.source_block,c.candidate_status,c.issue_codes,c.normalized_values,c.reviewed_values
    FROM seller_audit_local.import_candidates c JOIN seller_audit_local.import_batches b ON b.workspace_id=c.workspace_id AND b.id=c.import_batch_id AND b.validation_revision=c.validation_revision
    WHERE c.workspace_id=$1 AND c.import_batch_id=$2`,[workspaceId,batchId])
  if(!await verifyCandidatesAgainstWorkbook(bytes,approvedHash,snapshots.rows))throw new Error('Source and validation differ')
  const input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
  const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
  const channelVariants=Array.from({length:21},(_,i)=>{
    const channel=preview.products.find(p=>p.sourceRow===200+i)
    const common=preview.products.filter(p=>p.sourceChannel==='공통' && p.sabangnetCode===channel?.sabangnetCode)
    if(!channel||common.length!==1)throw new Error('Channel rows changed')
    return {commonRow:common[0].sourceRow,channelRow:channel.sourceRow}
  })
  const products=await db.query<{id:string;code:string;name:string;category:string|null;type:string;status:string}>('SELECT id,sabangnet_code AS code,product_name AS name,category,product_type AS type,status FROM seller_audit_local.products WHERE workspace_id=$1',[workspaceId])
  const components=await db.query<{product_id:string;sku:string;quantity:number}>(`SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1`,[workspaceId])
  const skus=await db.query<{code:string;name:string;color:string|null;status:string}>('SELECT sku_code AS code,model_name AS name,color,status FROM seller_audit_local.skus WHERE workspace_id=$1',[workspaceId])
  const existing=products.rows.map(product=>({...product,components:components.rows.filter(c=>c.product_id===product.id).map(c=>({sku:c.sku,quantity:c.quantity}))}))
  const sidecars=await db.query<{n:number}>(`SELECT (SELECT count(*) FROM seller_audit_local.unlisted_bundles WHERE workspace_id=$1)+(SELECT count(*) FROM seller_audit_local.market_collections WHERE workspace_id=$1)+(SELECT count(*) FROM seller_audit_local.product_channel_variants WHERE workspace_id=$1)+(SELECT count(*) FROM seller_audit_local.sku_assembly_components WHERE workspace_id=$1) AS n`,[workspaceId])
  if(Number(sidecars.rows[0].n)!==0)throw new Error('Existing catalog extensions require review')
  const plan=expandedCatalogPlan(preview,{unlistedRows:[115,141,142],collections:[{code:'100526',rows:[158,159,160,161,162,163,164]}],channelVariants},existing,skus.rows)
  return {sourceFileId:batch.source_file_id,sourceHash:approvedHash,...plan}
}
