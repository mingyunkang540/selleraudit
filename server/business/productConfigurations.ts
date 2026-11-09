import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'

const fields=['normal','regular','basic','medium','large','live','group'] as const
type PriceKey=typeof fields[number]
export type ConfigInput={id?:string;productId:string;name:string;prices:Record<PriceKey,number|null>;components:{skuId:string;quantity:number}[]}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const editable=(actor:Identity)=>{if(actor.role!=='ADMIN'&&actor.role!=='EDITOR')throw new Error('Not authorized')}
export async function readProductConfigurations(pool:Pool,actor:Identity){
 const db=await pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
  const member=await db.query(`SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId]);if(member.rowCount!==1)throw new Error('Not authorized')
  const configurations=await db.query(`SELECT id,product_id AS "productId",name,normal_price AS normal,regular_price AS regular,basic_price AS basic,medium_price AS medium,large_price AS large,live_price AS live,group_price AS "group" FROM seller_audit_local.product_configurations WHERE workspace_id=$1 ORDER BY name,id`,[actor.workspaceId])
  const components=await db.query(`SELECT configuration_id AS "configurationId",sku_id AS "skuId",quantity FROM seller_audit_local.product_configuration_components WHERE workspace_id=$1 ORDER BY sku_id`,[actor.workspaceId])
  const bindings=await db.query(`SELECT offer_id AS "offerId",configuration_id AS "configurationId" FROM seller_audit_local.offer_configurations WHERE workspace_id=$1`,[actor.workspaceId])
  await db.query('COMMIT')
  return {configurations:configurations.rows.map(row=>({id:row.id,productId:row.productId,name:row.name,prices:Object.fromEntries(fields.map(k=>[k,row[k]===null?null:Number(row[k])])),components:components.rows.filter(c=>c.configurationId===row.id).map(c=>({skuId:c.skuId,quantity:c.quantity}))})),bindings:bindings.rows}
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export async function saveProductConfiguration(pool:Pool,actor:Identity,input:ConfigInput){
 editable(actor)
 if(!input||!uuid(input.productId)||(input.id!==undefined&&!uuid(input.id))||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>120||!input.prices||!Array.isArray(input.components)||!input.components.length||input.components.length>200)throw new Error('Invalid configuration')
 for(const key of fields){const value=input.prices[key];if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>999999999999))throw new Error('Invalid price')}
 if(input.components.some(c=>!c||!uuid(c.skuId)||!Number.isSafeInteger(c.quantity)||c.quantity<1||c.quantity>100000)||new Set(input.components.map(c=>c.skuId)).size!==input.components.length)throw new Error('Invalid components')
 const db=await pool.connect()
 try{
  await db.query('BEGIN')
  const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId]);if(member.rowCount!==1)throw new Error('Not authorized')
  const product=await db.query("SELECT id FROM seller_audit_local.products WHERE workspace_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE",[actor.workspaceId,input.productId]);if(product.rowCount!==1)throw new Error('Product unavailable')
  const skus=await db.query("SELECT id FROM seller_audit_local.skus WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE'",[actor.workspaceId,input.components.map(c=>c.skuId)]);if(skus.rowCount!==input.components.length)throw new Error('SKU unavailable')
  const values=fields.map(key=>input.prices[key]);let id=input.id
  if(id){const existing=await db.query('UPDATE seller_audit_local.product_configurations SET name=$4,normal_price=$5,regular_price=$6,basic_price=$7,medium_price=$8,large_price=$9,live_price=$10,group_price=$11,updated_at=now() WHERE workspace_id=$1 AND product_id=$2 AND id=$3 RETURNING id',[actor.workspaceId,input.productId,id,input.name.trim(),...values]);if(existing.rowCount!==1)throw new Error('Configuration unavailable');await db.query('DELETE FROM seller_audit_local.product_configuration_components WHERE workspace_id=$1 AND configuration_id=$2',[actor.workspaceId,id])}
  else {const created=await db.query<{id:string}>('INSERT INTO seller_audit_local.product_configurations(workspace_id,product_id,name,normal_price,regular_price,basic_price,medium_price,large_price,live_price,group_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[actor.workspaceId,input.productId,input.name.trim(),...values]);id=created.rows[0].id}
  for(const component of input.components)await db.query('INSERT INTO seller_audit_local.product_configuration_components(workspace_id,configuration_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[actor.workspaceId,id,component.skuId,component.quantity])
  await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'PRODUCT_CONFIGURATION_SAVED','PRODUCT_CONFIGURATION',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,id,JSON.stringify({productId:input.productId,name:input.name.trim(),prices:input.prices,components:input.components})])
  await db.query('COMMIT');return {id}
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
export async function bindOfferConfiguration(pool:Pool,actor:Identity,offerId:string,configurationId:string){
 editable(actor);if(!uuid(offerId)||!uuid(configurationId))throw new Error('Invalid input')
 const db=await pool.connect()
 try{
  await db.query('BEGIN')
  const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId]);if(member.rowCount!==1)throw new Error('Not authorized')
  const offer=await db.query("SELECT id FROM seller_audit_local.channel_offers WHERE workspace_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE",[actor.workspaceId,offerId]);if(offer.rowCount!==1)throw new Error('Offer unavailable')
  const archived=await db.query("SELECT 1 FROM seller_audit_local.activity_logs a JOIN seller_audit_local.channel_offers o ON o.workspace_id=a.workspace_id AND o.id=$2 WHERE a.workspace_id=$1 AND ((a.entity_id=o.id AND a.action_type IN ('INACTIVE_OFFER_ARCHIVED','UNMATCHED_OFFER_ARCHIVED')) OR (a.entity_id=o.listing_id AND a.action_type='TEST_LISTING_ARCHIVED'))",[actor.workspaceId,offerId]);if(archived.rowCount)throw new Error('Offer unavailable')
  const target=await db.query<{product_id:string}>("SELECT c.product_id FROM seller_audit_local.product_configurations c JOIN seller_audit_local.products p ON p.workspace_id=c.workspace_id AND p.id=c.product_id AND p.status='ACTIVE' WHERE c.workspace_id=$1 AND c.id=$2 FOR SHARE OF c,p",[actor.workspaceId,configurationId]);if(target.rowCount!==1)throw new Error('Configuration unavailable')
  await db.query('SELECT seller_audit_local.map_offer($1,$2,$3,$4)',[actor.userId,actor.workspaceId,offerId,target.rows[0].product_id])
  await db.query('INSERT INTO seller_audit_local.offer_configurations(workspace_id,offer_id,configuration_id) VALUES($1,$2,$3) ON CONFLICT(workspace_id,offer_id) DO UPDATE SET configuration_id=EXCLUDED.configuration_id',[actor.workspaceId,offerId,configurationId])
  await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'OFFER_CONFIGURATION_MAPPED','CHANNEL_OFFER',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,offerId,JSON.stringify({configurationId,productId:target.rows[0].product_id})])
  await db.query('COMMIT');return {ok:true}
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
