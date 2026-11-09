import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'

type Item={offerId:string;productId:string;listingCode:string;optionId:string;listing:string;option:string;product:string;components:{sku:string;quantity:number}[]}
const expectedHash='2c3985005a003f7393836106618cab46228a908030cc051ac51d86c0eb4ad0ef'
export async function applyOwnedStoreBatch(pool:Pool,actor:Identity):Promise<number>{
 if(actor.role!=='ADMIN')throw new Error('Not authorized')
 const bytes=await readFile(resolve('../outputs/local-registration/own-store-mapping-plan.json'))
 if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new Error('Plan changed')
 const {plan}=JSON.parse(bytes.toString('utf8')) as {plan:Item[]}
 if(!Array.isArray(plan)||plan.length!==533||new Set(plan.map(x=>x.offerId)).size!==533)throw new Error('Invalid plan')
 const db=await pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
  const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role='ADMIN' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
  if(member.rowCount!==1)throw new Error('Not authorized')
  await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[actor.workspaceId])
  for(const item of plan){
   const row=await db.query(`SELECT 1 FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id JOIN seller_audit_local.channels c ON c.workspace_id=l.workspace_id AND c.id=l.channel_id JOIN seller_audit_local.products p ON p.workspace_id=o.workspace_id AND p.id=$3 WHERE o.workspace_id=$1 AND o.id=$2 AND o.master_product_id IS NULL AND o.status='ACTIVE' AND o.channel_option_id=$4 AND o.option_name=$5 AND l.channel_product_id=$6 AND l.product_name=$7 AND c.channel_code='OWN_STORE' AND p.status='ACTIVE' AND p.product_name=$8 FOR UPDATE OF o,p`,[actor.workspaceId,item.offerId,item.productId,item.optionId,item.option,item.listingCode,item.listing,item.product])
   if(row.rowCount!==1)throw new Error('Mapping target changed')
   if((await db.query('SELECT 1 FROM seller_audit_local.product_configurations WHERE workspace_id=$1 AND product_id=$2 LIMIT 1',[actor.workspaceId,item.productId])).rowCount)throw new Error('Configuration selection required')
   const parts=await db.query<{sku:string;quantity:number}>(`SELECT s.sku_code AS sku,pc.quantity FROM seller_audit_local.product_components pc JOIN seller_audit_local.skus s ON s.workspace_id=pc.workspace_id AND s.id=pc.sku_id WHERE pc.workspace_id=$1 AND pc.product_id=$2`,[actor.workspaceId,item.productId])
   const actual=parts.rows.sort((a,b)=>a.sku.localeCompare(b.sku))
   if(JSON.stringify(actual)!==JSON.stringify(item.components))throw new Error('Composition changed')
   const aliases=await db.query(`SELECT 1 FROM seller_audit_local.aliases WHERE workspace_id=$1 AND raw_product_name=$2 AND raw_option_name=$3 AND source_channel='OWN_STORE' AND master_product_id<>$4`,[actor.workspaceId,item.listing,item.option,item.productId])
   if(aliases.rowCount)throw new Error('Existing alias conflict')
  }
  for(const item of plan)await db.query('SELECT seller_audit_local.map_offer($1,$2,$3,$4)',[actor.userId,actor.workspaceId,item.offerId,item.productId])
  await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'OWN_STORE_MATCHED_BATCH','CHANNEL',NULL,$4::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,JSON.stringify({count:plan.length,planHash:expectedHash,offers:plan.map(item=>({offerId:item.offerId,productId:item.productId}))})])
  await db.query('COMMIT');return plan.length
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
