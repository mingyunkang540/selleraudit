import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { Identity } from '../auth/service.ts'
import { LOCAL_SKU_COMPONENTS } from '../../src/services/import/localPolicy.ts'
import { prepareExpandedPlan } from './prepareExpandedPlan.ts'

export function expandedPlanFingerprint(plan:Awaited<ReturnType<typeof prepareExpandedPlan>>):string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}
export async function applyExpandedPlan(pool:Pool,root:string,identity:Identity,batchId:string,fingerprint:string){
  if(identity.role!=='ADMIN'||!/^[0-9a-f]{64}$/.test(fingerprint))throw new Error('Not authorized or invalid plan')
  const db=await pool.connect()
  try {
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[identity.workspaceId,identity.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const batch=await db.query("SELECT id FROM seller_audit_local.import_batches WHERE workspace_id=$1 AND id=$2 AND status='REVIEW_REQUIRED' FOR UPDATE",[identity.workspaceId,batchId])
    if(batch.rowCount!==1)throw new Error('Batch is not eligible')
    await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[identity.workspaceId])
    for(const table of ['import_candidates','import_validation_issues','products','skus','product_components'])await db.query(`SELECT id FROM seller_audit_local.${table} WHERE workspace_id=$1 ORDER BY id FOR UPDATE`,[identity.workspaceId])
    const plan=await prepareExpandedPlan(db,root,identity.workspaceId,batchId)
    if(expandedPlanFingerprint(plan)!==fingerprint)throw new Error('Plan changed')
    if(!plan.products.length&&!plan.unlisted.length&&!plan.collections.length)throw new Error('Plan is empty')
    const workspace=identity.workspaceId
    const skuIds=new Map<string,string>()
    let skusCreated=0,productsCreated=0,componentsCreated=0,variantsCreated=0,unlistedCreated=0,optionsCreated=0,assembliesCreated=0
    for(const sku of plan.skus){
      const created=await db.query<{id:string}>(`INSERT INTO seller_audit_local.skus(workspace_id,sku_code,model_name,color,status) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(workspace_id,sku_code) DO NOTHING RETURNING id`,[workspace,sku.skuCode,sku.modelName,sku.color])
      skusCreated+=created.rowCount??0
      const found=created.rowCount?created:await db.query<{id:string}>('SELECT id FROM seller_audit_local.skus WHERE workspace_id=$1 AND sku_code=$2',[workspace,sku.skuCode])
      if(found.rowCount!==1)throw new Error('SKU unavailable');skuIds.set(sku.skuCode,found.rows[0].id)
    }
    const skuId=(code:string)=>{const id=skuIds.get(code);if(!id)throw new Error('SKU dependency missing');return id}
    for(const [code,components] of Object.entries(LOCAL_SKU_COMPONENTS))if(skuIds.has(code))for(const component of components){
      await db.query('INSERT INTO seller_audit_local.sku_assembly_components(workspace_id,assembly_sku_id,component_sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,skuId(code),skuId(component.skuCode),component.quantity]);assembliesCreated++
    }
    const productIds=new Map<string,string>()
    for(const item of plan.products){
      const p=item.product;if(!p.sabangnetCode)throw new Error('Product code missing')
      const created=await db.query<{id:string}>(`INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,category,product_type,status) VALUES($1,$2,$3,$4,$5,'ACTIVE') ON CONFLICT(workspace_id,sabangnet_code) DO NOTHING RETURNING id`,[workspace,p.sabangnetCode,p.productName,p.category,p.productType])
      productsCreated+=created.rowCount??0
      const found=created.rowCount?created:await db.query<{id:string}>('SELECT id FROM seller_audit_local.products WHERE workspace_id=$1 AND sabangnet_code=$2',[workspace,p.sabangnetCode])
      if(found.rowCount!==1)throw new Error('Product unavailable');const id=found.rows[0].id;productIds.set(p.sabangnetCode,id)
      if(created.rowCount)for(const component of item.components){await db.query('INSERT INTO seller_audit_local.product_components(workspace_id,product_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,id,skuId(component.skuCode),component.quantity]);componentsCreated++}
      if(p.sourceChannel&&p.sourceChannel!=='공통'){
        const variant=await insertVariant(db,workspace,id,plan.sourceFileId,p.sourceRow,p.sourceChannel)
        for(const c of item.components)await db.query('INSERT INTO seller_audit_local.product_channel_variant_components(workspace_id,variant_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,variant,skuId(c.skuCode),c.quantity])
        variantsCreated++
      }
    }
    for(const item of plan.variants){
      const productId=productIds.get(item.code);if(!productId)throw new Error('Channel product unavailable')
      const variant=await insertVariant(db,workspace,productId,plan.sourceFileId,item.channel.sourceRow,item.channel.sourceChannel!)
      await db.query('INSERT INTO seller_audit_local.product_channel_variant_components(workspace_id,variant_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,variant,skuId(item.channelComponent.skuCode),item.channelComponent.quantity]);variantsCreated++
    }
    for(const item of plan.unlisted){
      const result=await db.query<{id:string}>('INSERT INTO seller_audit_local.unlisted_bundles(workspace_id,source_file_id,source_row,name,category) VALUES($1,$2,$3,$4,$5) RETURNING id',[workspace,plan.sourceFileId,item.product.sourceRow,item.product.productName,item.product.category])
      for(const c of item.components)await db.query('INSERT INTO seller_audit_local.unlisted_bundle_components(workspace_id,bundle_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspace,result.rows[0].id,skuId(c.skuCode),c.quantity])
      unlistedCreated++
    }
    for(const group of plan.collections){
      const product=await db.query<{id:string}>("INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,product_type,status) VALUES($1,$2,$3,'SET','ACTIVE') RETURNING id",[workspace,group.code,`모음전 ${group.code}`]);productsCreated++
      const collection=await db.query<{id:string}>('INSERT INTO seller_audit_local.market_collections(workspace_id,product_id) VALUES($1,$2) RETURNING id',[workspace,product.rows[0].id])
      for(const option of group.options){await db.query(`INSERT INTO seller_audit_local.market_collection_options(workspace_id,collection_id,sku_id,source_file_id,source_row,option_name,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)`,[workspace,collection.rows[0].id,skuId(option.component.skuCode),plan.sourceFileId,option.product.sourceRow,option.product.productName,option.component.quantity]);optionsCreated++}
    }
    const status=plan.excluded.length?'PARTIALLY_APPLIED':'APPLIED'
    const counts={productsCreated,skusCreated,componentsCreated,variantsCreated,unlistedCreated,optionsCreated,assembliesCreated}
    await db.query('UPDATE seller_audit_local.import_batches SET status=$3,applied_count=$4,remaining_count=$5,failed_count=0,applied_at=now() WHERE workspace_id=$1 AND id=$2',[workspace,batchId,status,Object.values(counts).reduce((a,b)=>a+b,0),plan.excluded.length])
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'IMPORT_APPLIED','IMPORT_BATCH',$4,$5::jsonb)`,[workspace,identity.userId,member.rows[0].actor_ref,batchId,JSON.stringify({mode:'EXPANDED_CREATE',fingerprint,sourceHash:plan.sourceHash,...counts,excluded:plan.excluded})])
    await db.query('COMMIT')
    return {...counts,excluded:plan.excluded,status}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
async function insertVariant(db:PoolClient,workspace:string,productId:string,sourceFileId:string,row:number,channel:string):Promise<string>{
  const result=await db.query<{id:string}>('INSERT INTO seller_audit_local.product_channel_variants(workspace_id,product_id,source_file_id,source_row,source_channel) VALUES($1,$2,$3,$4,$5) RETURNING id',[workspace,productId,sourceFileId,row,channel])
  return result.rows[0].id
}
