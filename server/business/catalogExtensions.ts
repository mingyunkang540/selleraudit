import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'

export async function readCatalogExtensions(pool:Pool,actor:Identity){
  const db=await pool.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    const member=await db.query(`SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const [bundles,options,variants,assemblies]=await Promise.all([
      db.query(`SELECT b.id,b.name,b.category,s.sku_code AS sku,c.quantity FROM seller_audit_local.unlisted_bundles b JOIN seller_audit_local.unlisted_bundle_components c ON c.workspace_id=b.workspace_id AND c.bundle_id=b.id JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE b.workspace_id=$1 AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=b.workspace_id AND a.action_type='UNLISTED_BUNDLE_PROMOTED' AND a.changed_fields->>'bundleId'=b.id::text) ORDER BY b.name,s.sku_code`,[actor.workspaceId]),
      db.query(`SELECT c.product_id AS "productId",o.option_name AS name,s.sku_code AS sku,o.quantity FROM seller_audit_local.market_collections c JOIN seller_audit_local.market_collection_options o ON o.workspace_id=c.workspace_id AND o.collection_id=c.id JOIN seller_audit_local.skus s ON s.workspace_id=o.workspace_id AND s.id=o.sku_id WHERE c.workspace_id=$1 ORDER BY o.source_row`,[actor.workspaceId]),
      db.query(`SELECT v.product_id AS "productId",v.source_channel AS channel,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_channel_variants v JOIN seller_audit_local.product_channel_variant_components c ON c.workspace_id=v.workspace_id AND c.variant_id=v.id JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE v.workspace_id=$1 ORDER BY v.source_row,s.sku_code`,[actor.workspaceId]),
      db.query(`SELECT parent.sku_code AS assembly,child.sku_code AS sku,c.quantity FROM seller_audit_local.sku_assembly_components c JOIN seller_audit_local.skus parent ON parent.workspace_id=c.workspace_id AND parent.id=c.assembly_sku_id JOIN seller_audit_local.skus child ON child.workspace_id=c.workspace_id AND child.id=c.component_sku_id WHERE c.workspace_id=$1 ORDER BY parent.sku_code,child.sku_code`,[actor.workspaceId]),
    ])
    await db.query('COMMIT');return {bundles:bundles.rows,options:options.rows,variants:variants.rows,assemblies:assemblies.rows}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export async function readOhouseCandidates(pool:Pool,actor:Identity){
  const rows=await pool.query<{changed_fields:{decisions?:unknown}}>(`SELECT changed_fields FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND action_type='CHANNEL_IMPORT_APPLIED' ORDER BY created_at DESC,id DESC LIMIT 1`,[actor.workspaceId])
  const decisions=rows.rows[0]?.changed_fields?.decisions
  if(!Array.isArray(decisions))return {candidates:[]}
  const candidates=decisions.flatMap(item=>{
    if(!item||typeof item!=='object')return []
    const value=item as Record<string,unknown>
    if(value.reason!=='옵션 구성 또는 색상 확인 필요'||typeof value.productCode!=='string'||typeof value.optionCode!=='string'||typeof value.candidateCode!=='string')return []
    return [{productCode:value.productCode,optionCode:value.optionCode,candidateCode:value.candidateCode}]
  })
  return {candidates}
}
