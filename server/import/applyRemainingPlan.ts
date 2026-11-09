import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'
import { prepareRemainingPlan } from './prepareRemainingPlan.ts'

export function remainingPlanFingerprint(plan:Awaited<ReturnType<typeof prepareRemainingPlan>>){return createHash('sha256').update(JSON.stringify(plan)).digest('hex')}
export async function applyRemainingPlan(pool:Pool,root:string,identity:Identity,batchId:string,fingerprint:string){
  if(identity.role!=='ADMIN'||!/^[0-9a-f]{64}$/.test(fingerprint))throw new Error('Not authorized or invalid plan')
  const db=await pool.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[identity.workspaceId,identity.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const batch=await db.query("SELECT id FROM seller_audit_local.import_batches WHERE workspace_id=$1 AND id=$2 AND status='PARTIALLY_APPLIED' FOR UPDATE",[identity.workspaceId,batchId])
    if(batch.rowCount!==1)throw new Error('Batch not eligible')
    await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[identity.workspaceId])
    for(const table of ['import_candidates','import_validation_issues','products','skus','product_components'])await db.query(`SELECT id FROM seller_audit_local.${table} WHERE workspace_id=$1 ORDER BY id FOR UPDATE`,[identity.workspaceId])
    const plan=await prepareRemainingPlan(db,root,identity.workspaceId,batchId)
    if(remainingPlanFingerprint(plan)!==fingerprint||!plan.products.length)throw new Error('Plan changed or empty')
    const workspace=identity.workspaceId;let skusCreated=0,productsCreated=0,componentsCreated=0,variantsCreated=0
    const ids=new Map<string,string>()
    for(const sku of plan.skus){
      const created=await db.query<{id:string}>("INSERT INTO seller_audit_local.skus(workspace_id,sku_code,model_name,color,status) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(workspace_id,sku_code) DO NOTHING RETURNING id",[workspace,sku.skuCode,sku.modelName,sku.color]);skusCreated+=created.rowCount??0
      const found=created.rowCount?created:await db.query<{id:string}>('SELECT id FROM seller_audit_local.skus WHERE workspace_id=$1 AND sku_code=$2',[workspace,sku.skuCode])
      if(found.rowCount!==1)throw new Error('SKU unavailable');ids.set(sku.skuCode,found.rows[0].id)
    }
    for(const item of plan.products){
      const p=item.product
      const product=await db.query<{id:string}>("INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,category,product_type,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING id",[workspace,p.sabangnetCode,p.productName,p.category,p.productType]);productsCreated++
      let variantId:string|null=null
      if(p.sourceChannel&&p.sourceChannel!=='공통'){
        const variant=await db.query<{id:string}>('INSERT INTO seller_audit_local.product_channel_variants(workspace_id,product_id,source_file_id,source_row,source_channel) VALUES($1,$2,$3,$4,$5) RETURNING id',[workspace,product.rows[0].id,plan.sourceFileId,p.sourceRow,p.sourceChannel]);variantId=variant.rows[0].id;variantsCreated++
      }
      for(const c of item.components){
        const skuId=ids.get(c.skuCode);if(!skuId)throw new Error('SKU dependency unavailable')
        await db.query('INSERT INTO seller_audit_local.product_components(workspace_id,product_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,product.rows[0].id,skuId,c.quantity]);componentsCreated++
        if(variantId)await db.query('INSERT INTO seller_audit_local.product_channel_variant_components(workspace_id,variant_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,variantId,skuId,c.quantity])
      }
    }
    const status=plan.excluded.length?'PARTIALLY_APPLIED':'APPLIED';const counts={productsCreated,skusCreated,componentsCreated,variantsCreated}
    await db.query('UPDATE seller_audit_local.import_batches SET status=$3,applied_count=applied_count+$4,remaining_count=$5,failed_count=0,applied_at=now() WHERE workspace_id=$1 AND id=$2',[workspace,batchId,status,Object.values(counts).reduce((a,b)=>a+b,0),plan.excluded.length])
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'IMPORT_APPLIED','IMPORT_BATCH',$4,$5::jsonb)`,[workspace,identity.userId,member.rows[0].actor_ref,batchId,JSON.stringify({mode:'CONFIRMED_REMAINING_CREATE',fingerprint,sourceHash:plan.sourceHash,skuApprovals:plan.approvals,...counts,excluded:plan.excluded})])
    await db.query('COMMIT');return {...counts,excluded:plan.excluded,status}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
