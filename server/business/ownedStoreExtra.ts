import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'
type Part={sku:string;quantity:number}
type Item={offerId:string;productId:string;listingCode:string;optionId:string;listing:string;option:string;product:string;components:Part[];configurationId:string|null}
type TestItem={offerId:string;listingCode:string;optionId:string;listing:string;option:string}
const expectedHash='f8266eda3bcee6824dc5c6a6e5f0c835a09cf425e19f38e855a22caf658aef53'
export async function applyOwnedStoreExtra(pool:Pool,actor:Identity){
 if(actor.role!=='ADMIN')throw new Error('Not authorized')
 const bytes=await readFile(resolve('../outputs/local-registration/own-store-extra-plan.json'))
 if(createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new Error('Plan changed')
 const {plan,tests}=JSON.parse(bytes.toString('utf8')) as {plan:Item[];tests:TestItem[]}
 if(!Array.isArray(plan)||plan.length!==112||!Array.isArray(tests)||tests.length!==9||new Set([...plan,...tests].map(x=>x.offerId)).size!==121)throw new Error('Invalid plan')
 const db=await pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
  const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role='ADMIN' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
  if(member.rowCount!==1)throw new Error('Not authorized')
  await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[actor.workspaceId])
  for(const item of plan){
   const row=await db.query(`SELECT 1 FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id JOIN seller_audit_local.channels c ON c.workspace_id=l.workspace_id AND c.id=l.channel_id JOIN seller_audit_local.products p ON p.workspace_id=o.workspace_id AND p.id=$3 WHERE o.workspace_id=$1 AND o.id=$2 AND o.master_product_id IS NULL AND o.status='ACTIVE' AND o.channel_option_id=$4 AND o.option_name=$5 AND l.channel_product_id=$6 AND l.product_name=$7 AND c.channel_code='OWN_STORE' AND p.status='ACTIVE' AND p.product_name=$8 FOR UPDATE OF o,p`,[actor.workspaceId,item.offerId,item.productId,item.optionId,item.option,item.listingCode,item.listing,item.product])
   if(row.rowCount!==1)throw new Error('Mapping target changed')
   const parts=await db.query<Part>(`SELECT s.sku_code AS sku,pc.quantity FROM seller_audit_local.product_components pc JOIN seller_audit_local.skus s ON s.workspace_id=pc.workspace_id AND s.id=pc.sku_id WHERE pc.workspace_id=$1 AND pc.product_id=$2`,[actor.workspaceId,item.productId])
   if(JSON.stringify(parts.rows.sort((a,b)=>a.sku.localeCompare(b.sku)))!==JSON.stringify(item.components))throw new Error('Composition changed')
   const configs=await db.query<{id:string;name:string}>('SELECT id,name FROM seller_audit_local.product_configurations WHERE workspace_id=$1 AND product_id=$2 FOR SHARE',[actor.workspaceId,item.productId])
   if(item.configurationId){
    if(!configs.rows.some(c=>c.id===item.configurationId&&c.name==='용기+구성품'))throw new Error('Configuration changed')
    const configured=await db.query<Part>(`SELECT s.sku_code AS sku,pc.quantity FROM seller_audit_local.product_configuration_components pc JOIN seller_audit_local.skus s ON s.workspace_id=pc.workspace_id AND s.id=pc.sku_id WHERE pc.workspace_id=$1 AND pc.configuration_id=$2`,[actor.workspaceId,item.configurationId])
    if(JSON.stringify(configured.rows.sort((a,b)=>a.sku.localeCompare(b.sku)))!==JSON.stringify(item.components))throw new Error('Configuration composition changed')
   }else if(configs.rowCount)throw new Error('Configuration selection required')
   const alias=await db.query(`SELECT 1 FROM seller_audit_local.aliases WHERE workspace_id=$1 AND raw_product_name=$2 AND raw_option_name=$3 AND source_channel='OWN_STORE' AND master_product_id<>$4`,[actor.workspaceId,item.listing,item.option,item.productId])
   if(alias.rowCount)throw new Error('Alias conflict')
  }
  let testListing:string|null=null
  for(const item of tests){
   const row=await db.query<{listing_id:string}>(`SELECT l.id AS listing_id FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id JOIN seller_audit_local.channels c ON c.workspace_id=l.workspace_id AND c.id=l.channel_id WHERE o.workspace_id=$1 AND o.id=$2 AND o.master_product_id IS NULL AND o.channel_option_id=$3 AND o.option_name=$4 AND l.channel_product_id='P00000GA' AND l.product_name='테스트' AND c.channel_code='OWN_STORE' FOR UPDATE OF o,l`,[actor.workspaceId,item.offerId,item.optionId,item.option])
   if(row.rowCount!==1||(testListing&&testListing!==row.rows[0].listing_id))throw new Error('Test listing changed')
   testListing=row.rows[0].listing_id
  }
  const testCount=await db.query<{n:number}>('SELECT count(*)::int AS n FROM seller_audit_local.channel_offers WHERE workspace_id=$1 AND listing_id=$2',[actor.workspaceId,testListing])
  if(testCount.rows[0].n!==tests.length)throw new Error('Test options changed')
  for(const item of plan){
   await db.query('SELECT seller_audit_local.map_offer($1,$2,$3,$4)',[actor.userId,actor.workspaceId,item.offerId,item.productId])
   if(item.configurationId)await db.query('INSERT INTO seller_audit_local.offer_configurations(workspace_id,offer_id,configuration_id) VALUES($1,$2,$3)',[actor.workspaceId,item.offerId,item.configurationId])
  }
  await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'TEST_LISTING_ARCHIVED','CHANNEL_LISTING',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,testListing,JSON.stringify({reason:'user_requested',optionIds:tests.map(x=>x.offerId)})])
  await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'OWN_STORE_EXTRA_MATCHED','CHANNEL',NULL,$4::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,JSON.stringify({count:plan.length,testOptions:tests.length,planHash:expectedHash,offers:plan.map(item=>({offerId:item.offerId,productId:item.productId,configurationId:item.configurationId}))})])
  await db.query('COMMIT');return {mapped:plan.length,testOptions:tests.length}
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
