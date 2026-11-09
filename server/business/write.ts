import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'

export async function mapOffer(pool:Pool,actor:Identity,offerId:string,productId:string):Promise<void> {
  if(actor.role!=='ADMIN' && actor.role!=='EDITOR')throw new Error('Not authorized')
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    const offer=await db.query('SELECT id FROM seller_audit_local.channel_offers WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[actor.workspaceId,offerId])
    if(offer.rowCount!==1)throw new Error('Offer unavailable')
    const archived=await db.query("SELECT 1 FROM seller_audit_local.activity_logs a JOIN seller_audit_local.channel_offers o ON o.workspace_id=a.workspace_id AND o.id=$2 WHERE a.workspace_id=$1 AND ((a.entity_id=o.id AND a.action_type IN ('INACTIVE_OFFER_ARCHIVED','UNMATCHED_OFFER_ARCHIVED')) OR (a.entity_id=o.listing_id AND a.action_type='TEST_LISTING_ARCHIVED'))",[actor.workspaceId,offerId])
    if(archived.rowCount)throw new Error('Offer unavailable')
    await db.query('DELETE FROM seller_audit_local.offer_configurations WHERE workspace_id=$1 AND offer_id=$2',[actor.workspaceId,offerId])
    await db.query('SELECT seller_audit_local.map_offer($1,$2,$3,$4)',[actor.userId,actor.workspaceId,offerId,productId])
    await db.query('COMMIT')
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export async function archiveUnmatchedOffer(pool:Pool,actor:Identity,offerId:string):Promise<void> {
  if(actor.role!=='ADMIN' && actor.role!=='EDITOR')throw new Error('Not authorized')
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offerId))throw new Error('Invalid selection')
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const offer=await db.query(`SELECT o.id FROM seller_audit_local.channel_offers o WHERE o.workspace_id=$1 AND o.id=$2 AND o.master_product_id IS NULL AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=o.workspace_id AND ((a.entity_id=o.id AND a.action_type IN ('INACTIVE_OFFER_ARCHIVED','UNMATCHED_OFFER_ARCHIVED')) OR (a.entity_id=o.listing_id AND a.action_type='TEST_LISTING_ARCHIVED'))) FOR UPDATE OF o`,[actor.workspaceId,offerId])
    if(offer.rowCount!==1)throw new Error('Offer changed; refresh and retry')
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'UNMATCHED_OFFER_ARCHIVED','CHANNEL_OFFER',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,offerId,JSON.stringify({reason:'user_requested'})])
    await db.query('COMMIT')
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
export async function updateIssue(pool:Pool,actor:Identity,issueId:string,status:string):Promise<void> {
  if(actor.role!=='ADMIN' && actor.role!=='EDITOR')throw new Error('Not authorized')
  await pool.query('SELECT seller_audit_local.update_issue_status($1,$2,$3,$4)',[actor.userId,actor.workspaceId,issueId,status])
}

export async function archiveIssues(pool:Pool,actor:Identity,issueIds:string[]):Promise<number> {
  if(actor.role!=='ADMIN' && actor.role!=='EDITOR')throw new Error('Not authorized')
  if(!issueIds.length || issueIds.length>5000 || new Set(issueIds).size!==issueIds.length || issueIds.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw new Error('Invalid selection')
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const rows=await db.query<{id:string}>(`SELECT i.id FROM seller_audit_local.audit_issues i WHERE i.workspace_id=$1 AND i.id=ANY($2::uuid[]) AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=i.workspace_id AND a.entity_id=i.id AND a.action_type='AUDIT_ISSUE_ARCHIVED') ORDER BY i.id FOR UPDATE OF i`,[actor.workspaceId,issueIds])
    if(rows.rowCount!==issueIds.length)throw new Error('Issues changed; refresh and retry')
    for(const row of rows.rows)await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'AUDIT_ISSUE_ARCHIVED','AUDIT_ISSUE',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,row.id,JSON.stringify({reason:'user_requested'})])
    await db.query('COMMIT');return rows.rows.length
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export async function unmapOffer(pool:Pool,actor:Identity,offerId:string,expectedProductId:string):Promise<void> {
  if(actor.role!=='ADMIN' && actor.role!=='EDITOR')throw new Error('Not authorized')
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    const found=await db.query<{actor_ref:string;raw_product_name:string;raw_option_name:string|null;source_channel:string}>(`SELECT m.actor_ref,l.product_name AS raw_product_name,o.option_name AS raw_option_name,c.channel_code AS source_channel FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id JOIN seller_audit_local.channels c ON c.workspace_id=l.workspace_id AND c.id=l.channel_id JOIN seller_audit_local.workspace_members m ON m.workspace_id=o.workspace_id AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') JOIN seller_audit_local.app_users u ON u.id=m.user_id AND u.status='ACTIVE' WHERE o.workspace_id=$1 AND o.id=$3 AND o.master_product_id=$4 FOR UPDATE OF o FOR SHARE OF m,u`,[actor.workspaceId,actor.userId,offerId,expectedProductId])
    if(found.rowCount!==1)throw new Error('Mapping changed or not authorized')
    const row=found.rows[0]
    await db.query('DELETE FROM seller_audit_local.offer_configurations WHERE workspace_id=$1 AND offer_id=$2',[actor.workspaceId,offerId])
    await db.query('UPDATE seller_audit_local.channel_offers SET master_product_id=NULL WHERE workspace_id=$1 AND id=$2',[actor.workspaceId,offerId])
    await db.query(`DELETE FROM seller_audit_local.aliases a WHERE a.workspace_id=$1 AND a.raw_product_name=$2 AND a.raw_option_name IS NOT DISTINCT FROM $3 AND a.source_channel=$4 AND a.master_product_id=$5 AND NOT EXISTS (SELECT 1 FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id JOIN seller_audit_local.channels c ON c.workspace_id=l.workspace_id AND c.id=l.channel_id WHERE o.workspace_id=$1 AND l.product_name=$2 AND o.option_name IS NOT DISTINCT FROM $3 AND c.channel_code=$4 AND o.master_product_id=$5)`,[actor.workspaceId,row.raw_product_name,row.raw_option_name,row.source_channel,expectedProductId])
    await db.query(`UPDATE seller_audit_local.audit_issues SET status='OPEN',resolved_at=NULL WHERE workspace_id=$1 AND offer_id=$2 AND issue_type='UNMATCHED' AND status='RESOLVED'`,[actor.workspaceId,offerId])
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'OFFER_UNMAPPED','CHANNEL_OFFER',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,row.actor_ref,offerId,JSON.stringify({previousProductId:expectedProductId})])
    await db.query('COMMIT')
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}

export async function archiveInactiveOffers(pool:Pool,actor:Identity,offerIds:string[]):Promise<number> {
  if(actor.role!=='ADMIN' && actor.role!=='EDITOR')throw new Error('Not authorized')
  if(!offerIds.length || offerIds.length>5000 || new Set(offerIds).size!==offerIds.length || offerIds.some(id=>!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw new Error('Invalid selection')
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const rows=await db.query<{id:string}>(`SELECT o.id FROM seller_audit_local.channel_offers o WHERE o.workspace_id=$1 AND o.id=ANY($2::uuid[]) AND o.status='INACTIVE' AND o.master_product_id IS NULL AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=o.workspace_id AND ((a.entity_id=o.id AND a.action_type IN ('INACTIVE_OFFER_ARCHIVED','UNMATCHED_OFFER_ARCHIVED')) OR (a.entity_id=o.listing_id AND a.action_type='TEST_LISTING_ARCHIVED'))) ORDER BY o.id FOR UPDATE OF o`,[actor.workspaceId,offerIds])
    if(rows.rowCount!==offerIds.length)throw new Error('Options changed; refresh and retry')
    const prior=await db.query("SELECT 1 FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND entity_id=ANY($2::uuid[]) AND action_type='INACTIVE_OFFER_ARCHIVED' LIMIT 1",[actor.workspaceId,offerIds])
    if(prior.rowCount)throw new Error('Options changed; refresh and retry')
    for(const row of rows.rows)await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'INACTIVE_OFFER_ARCHIVED','CHANNEL_OFFER',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,row.id,JSON.stringify({reason:'inactive_unmatched_bulk'})])
    await db.query('COMMIT');return rows.rows.length
  } catch(error){await db.query('ROLLBACK');throw error} finally{db.release()}
}
