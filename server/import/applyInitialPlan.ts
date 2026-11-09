import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'
import { prepareInitialPlan } from './prepareInitialPlan.ts'

export function initialPlanFingerprint(plan:Awaited<ReturnType<typeof prepareInitialPlan>>):string {
  const value={products:plan.products.map(item=>({row:item.product.sourceRow,code:item.product.sabangnetCode,name:item.product.productName,category:item.product.category,type:item.product.productType,components:item.components.map(component=>({sku:component.skuCode,quantity:component.quantity}))})),skus:plan.skus.map(sku=>({code:sku.skuCode,name:sku.modelName,color:sku.color})),excluded:plan.excluded}
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

// Create-only, transactional initial subset. The caller must present the hash
// of the proposal it reviewed. Unsupported cases remain excluded and audited.
export async function applyInitialPlan(pool:Pool,root:string,identity:Identity,batchId:string,expectedFingerprint:string) {
  if(identity.role!=='ADMIN' || !/^[0-9a-f]{64}$/.test(expectedFingerprint))throw new Error('Not authorized or invalid plan')
  const db=await pool.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[identity.workspaceId,identity.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const locked=await db.query("SELECT id FROM seller_audit_local.import_batches WHERE workspace_id=$1 AND id=$2 AND status='REVIEW_REQUIRED' FOR UPDATE",[identity.workspaceId,batchId])
    if(locked.rowCount!==1)throw new Error('Batch is not eligible')
    await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[identity.workspaceId])
    await db.query('SELECT id FROM seller_audit_local.import_candidates WHERE workspace_id=$1 AND import_batch_id=$2 FOR UPDATE',[identity.workspaceId,batchId])
    await db.query('SELECT id FROM seller_audit_local.import_validation_issues WHERE workspace_id=$1 AND import_batch_id=$2 FOR UPDATE',[identity.workspaceId,batchId])
    await db.query('SELECT id FROM seller_audit_local.products WHERE workspace_id=$1 ORDER BY id FOR UPDATE',[identity.workspaceId])
    await db.query('SELECT id FROM seller_audit_local.skus WHERE workspace_id=$1 ORDER BY id FOR UPDATE',[identity.workspaceId])
    await db.query('SELECT id FROM seller_audit_local.product_components WHERE workspace_id=$1 ORDER BY id FOR UPDATE',[identity.workspaceId])
    const plan=await prepareInitialPlan(db,root,identity.workspaceId,batchId)
    if(initialPlanFingerprint(plan)!==expectedFingerprint || !plan.products.length)throw new Error('Plan changed or empty')
    let productsCreated=0,skusCreated=0,componentsCreated=0
    for(const sku of plan.skus){
      const result=await db.query(`INSERT INTO seller_audit_local.skus(workspace_id,sku_code,model_name,color,status) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(workspace_id,sku_code) DO NOTHING RETURNING id`,[identity.workspaceId,sku.skuCode,sku.modelName,sku.color])
      skusCreated+=result.rowCount??0
    }
    for(const item of plan.products){
      const product=item.product
      const created=await db.query(`INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,category,product_type,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') ON CONFLICT(workspace_id,sabangnet_code) DO NOTHING RETURNING id`,[identity.workspaceId,product.sabangnetCode,product.productName,product.category,product.productType])
      productsCreated+=created.rowCount??0
      if(!created.rowCount)continue
      for(const component of item.components){
        const inserted=await db.query(`INSERT INTO seller_audit_local.product_components(workspace_id,product_id,sku_id,quantity)
          SELECT $1,$2,s.id,$4 FROM seller_audit_local.skus s WHERE s.workspace_id=$1 AND s.sku_code=$3 AND s.status='ACTIVE' RETURNING id`,[identity.workspaceId,created.rows[0].id,component.skuCode,component.quantity])
        if(inserted.rowCount!==1)throw new Error('Component SKU missing')
        componentsCreated++
      }
    }
    const status=plan.excluded.length?'PARTIALLY_APPLIED':'APPLIED'
    await db.query('UPDATE seller_audit_local.import_batches SET status=$3,applied_count=$4,remaining_count=$5,failed_count=0,applied_at=now() WHERE workspace_id=$1 AND id=$2',[identity.workspaceId,batchId,status,productsCreated+skusCreated+componentsCreated,plan.excluded.length])
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields)
      VALUES($1,$2,$3,'IMPORT_APPLIED','IMPORT_BATCH',$4,$5::jsonb)`,[identity.workspaceId,identity.userId,member.rows[0].actor_ref,batchId,JSON.stringify({mode:'SAFE_INITIAL_CREATE',fingerprint:expectedFingerprint,productsCreated,skusCreated,componentsCreated,excluded:plan.excluded})])
    await db.query('COMMIT')
    return {productsCreated,skusCreated,componentsCreated,excluded:plan.excluded,status}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
