import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'
import {discountListings,readDiscountSnapshot} from './smartstoreDiscount.ts'

const tables = {
  products:'id,workspace_id,sabangnet_code,product_name,category,product_type,normal_price,status,created_at,updated_at',
  skus:'id,workspace_id,sku_code,model_name,color,status,created_at,updated_at',
  components:'id,workspace_id,product_id,sku_id,quantity,created_at',
  channels:'id,workspace_id,channel_code,channel_name,status,created_at',
  listings:'id,workspace_id,channel_id,channel_product_id,product_name,status,product_url,last_synced_at,created_at,updated_at',
  offers:'id,workspace_id,listing_id,channel_option_id,option_name,seller_code,normal_price,sale_price,status,master_product_id,created_at,updated_at',
  aliases:'id,workspace_id,raw_product_name,raw_option_name,source_channel,master_product_id,created_at',
  issues:'id,workspace_id,issue_type,severity,product_id,channel_id,listing_id,offer_id,title,description,status,detected_at,resolved_at',
} as const
const names={products:'products',skus:'skus',components:'product_components',channels:'channels',listings:'channel_listings',offers:'channel_offers',aliases:'aliases',issues:'audit_issues'} as const
function camel(row:Record<string,unknown>):Record<string,unknown> {
  return Object.fromEntries(Object.entries(row).map(([key,value])=>{
    const field=key.replace(/_([a-z])/g,(_match,letter:string)=>letter.toUpperCase())
    if (key==='sabangnet_code' && value===null) return [field,'']
    if (value instanceof Date) return [field,value.toISOString()]
    if ((key==='normal_price'||key==='sale_price') && value!==null) {
      const number=Number(value)
      if (!Number.isFinite(number) || number<0 || number>Number.MAX_SAFE_INTEGER) throw new Error('Invalid numeric value')
      return [field,number]
    }
    return [field,value]
  }))
}
export async function readBusinessData(pool:Pool,actor:Identity):Promise<Record<string,unknown>> {
  const client=await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    const member=await client.query(`SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id
      WHERE m.user_id=$1 AND m.workspace_id=$2 AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.userId,actor.workspaceId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const workspace=await client.query('SELECT id,name,created_at,updated_at FROM seller_audit_local.workspaces WHERE id=$1',[actor.workspaceId])
    if(workspace.rowCount!==1)throw new Error('Workspace unavailable')
    const data:Record<string,unknown>={workspace:camel(workspace.rows[0])}
    for(const key of Object.keys(tables) as Array<keyof typeof tables>){
      const hidden=key==='offers'?" AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=channel_offers.workspace_id AND a.entity_id=channel_offers.id AND a.action_type IN ('INACTIVE_OFFER_ARCHIVED','UNMATCHED_OFFER_ARCHIVED'))":key==='issues'?" AND (offer_id IS NULL OR NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=audit_issues.workspace_id AND a.entity_id=audit_issues.offer_id AND a.action_type IN ('INACTIVE_OFFER_ARCHIVED','UNMATCHED_OFFER_ARCHIVED')))":''
      const archivedIssues=key==='issues'?" AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=audit_issues.workspace_id AND a.entity_id=audit_issues.id AND a.action_type='AUDIT_ISSUE_ARCHIVED')":''
      const archivedTests=key==='listings'?" AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=channel_listings.workspace_id AND a.entity_id=channel_listings.id AND a.action_type='TEST_LISTING_ARCHIVED')":key==='offers'?" AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=channel_offers.workspace_id AND a.entity_id=channel_offers.listing_id AND a.action_type='TEST_LISTING_ARCHIVED')":key==='issues'?" AND (listing_id IS NULL OR NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=audit_issues.workspace_id AND a.entity_id=audit_issues.listing_id AND a.action_type='TEST_LISTING_ARCHIVED'))":''
      const rows=await client.query(`SELECT ${tables[key]} FROM seller_audit_local.${names[key]} WHERE workspace_id=$1${hidden}${archivedIssues}${archivedTests} ORDER BY id`,[actor.workspaceId])
      data[key]=rows.rows.map(camel)
    }
    const withoutOffers=await client.query<{id:string}>(`SELECT l.id FROM seller_audit_local.channel_listings l WHERE l.workspace_id=$1 AND NOT EXISTS (SELECT 1 FROM seller_audit_local.channel_offers o WHERE o.workspace_id=l.workspace_id AND o.listing_id=l.id)`,[actor.workspaceId])
    data.listingIdsWithoutOffers=withoutOffers.rows.map(row=>row.id)
    const listings=data.listings as Record<string,unknown>[]
    const channelsByListing=new Map(listings.map(row=>[row.id,row.channelId]))
    for(const issue of data.issues as Record<string,unknown>[]) if(issue.channelId===null && issue.listingId!==null) issue.channelId=channelsByListing.get(issue.listingId)??null
    const channels=data.channels as Record<string,unknown>[]
    const naver=new Set(channels.filter(channel=>channel.channelCode==='NAVER').map(channel=>channel.id))
    const latestRefresh=await client.query<{changed_fields:{sourceHash?:string}}>("SELECT changed_fields FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND action_type='SMARTSTORE_REFRESH_APPLIED' ORDER BY created_at DESC,id DESC LIMIT 1",[actor.workspaceId])
    const refreshHash=latestRefresh.rows[0]?.changed_fields?.sourceHash
    const refreshed=typeof refreshHash==='string'&&/^[0-9a-f]{64}$/.test(refreshHash)
    const targets=new Map(listings.filter(listing=>typeof listing.channelProductId==='string'&&(refreshed||(discountListings as readonly string[]).includes(listing.channelProductId))&&naver.has(listing.channelId)).map(listing=>[listing.id,String(listing.channelProductId)]))
    if(targets.size){
      let snapshot:Awaited<ReturnType<typeof readDiscountSnapshot>>|null=null
      try{if(process.env.SELLERAUDIT_LOCAL_DATA_DIR)snapshot=await readDiscountSnapshot(process.env.SELLERAUDIT_LOCAL_DATA_DIR,actor.workspaceId,Date.now(),refreshed?refreshHash:undefined,refreshed)}catch{/* Do not display an unverified price. */}
      for(const offer of data.offers as Record<string,unknown>[]){const listingId=targets.get(offer.listingId);if(!listingId)continue;const match=snapshot?.get(listingId)?.get(String(offer.channelOptionId));offer.salePrice=match&&offer.normalPrice===match.normal?match.sale:null}
    }
    await client.query('COMMIT')
    return data
  } catch(error) {await client.query('ROLLBACK');throw error} finally {client.release()}
}
