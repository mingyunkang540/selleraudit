import {createHash} from 'node:crypto'
import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'
import {prepareOhouse} from './prepareOhouse.ts'

export function ohouseFingerprint(plan:Awaited<ReturnType<typeof prepareOhouse>>){return createHash('sha256').update(JSON.stringify(plan)).digest('hex')}
export async function applyOhouse(pool:Pool,root:string,identity:Identity,sourceId:string,fingerprint:string){
  if(identity.role!=='ADMIN'||!/^[0-9a-f]{64}$/.test(fingerprint))throw new Error('Not authorized')
  const db=await pool.connect()
  try{
    await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role='ADMIN' AND u.status='ACTIVE' FOR SHARE OF m,u`,[identity.workspaceId,identity.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[identity.workspaceId])
    for(const table of ['products','skus','product_components','channels','channel_listings','channel_offers'])await db.query(`SELECT id FROM seller_audit_local.${table} WHERE workspace_id=$1 ORDER BY id FOR UPDATE`,[identity.workspaceId])
    const plan=await prepareOhouse(db,root,identity.workspaceId,sourceId)
    if(ohouseFingerprint(plan)!==fingerprint)throw new Error('Plan changed')
    const workspace=identity.workspaceId
    const channel=await db.query<{id:string}>("INSERT INTO seller_audit_local.channels(workspace_id,channel_code,channel_name,status) VALUES($1,'OHOUSE','오늘의집','ACTIVE') RETURNING id",[workspace])
    const groups=new Map<string,typeof plan.options>()
    for(const option of plan.options){const group=groups.get(option.productCode)??[];group.push(option);groups.set(option.productCode,group)}
    let offers=0,mapped=0,inactive=0
    for(const group of groups.values()){
      const listing=await db.query<{id:string}>(`INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name,status) VALUES($1,$2,$3,$4,$5) RETURNING id`,[workspace,channel.rows[0].id,group[0].productCode,group[0].productName,group.some(o=>o.status==='ACTIVE')?'ACTIVE':'INACTIVE'])
      for(const o of group){
        await db.query(`INSERT INTO seller_audit_local.channel_offers(workspace_id,listing_id,channel_option_id,option_name,normal_price,sale_price,status,master_product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[workspace,listing.rows[0].id,o.optionCode,`${o.optionType==='추가옵션'?'[추가] ':''}${o.optionName}`,o.normalPrice,o.salePrice,o.status,o.masterProductId])
        offers++;if(o.masterProductId)mapped++;if(o.status==='INACTIVE')inactive++
      }
    }
    const result={channel:'오늘의집',listings:groups.size,offers,mapped,inactive,unmatched:offers-mapped}
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'CHANNEL_IMPORT_APPLIED','IMPORT_SOURCE_FILE',$4,$5::jsonb)`,[workspace,identity.userId,member.rows[0].actor_ref,sourceId,JSON.stringify({sourceHash:plan.sourceHash,masterHash:plan.masterHash,fingerprint,...result,decisions:plan.options.map(o=>({productCode:o.productCode,optionCode:o.optionCode,masterProductId:o.masterProductId,candidateCode:o.candidateCode,reason:o.reason}))})])
    await db.query('COMMIT');return result
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
