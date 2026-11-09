import {createHash,randomUUID} from 'node:crypto'
import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

export async function replaceOwnedStore(db,groups,source,hash,storageRoot){
 await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
 try {
 const channels=await db.query("SELECT workspace_id,id FROM seller_audit_local.channels WHERE channel_code='OWN_STORE' FOR UPDATE")
 if(channels.rowCount!==1)throw new Error('자사몰 채널이 하나가 아닙니다.')
 const {workspace_id:workspaceId,id:channelId}=channels.rows[0]
 await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[workspaceId])
 const previous=await db.query("SELECT 1 FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND action_type='OWN_STORE_REPLACED' AND changed_fields->>'sourceHash'=$2",[workspaceId,hash])
 if(previous.rowCount)throw new Error('이 파일은 이미 등록되었습니다. 중복 실행을 중단했습니다.')
 const listings=await db.query('SELECT id FROM seller_audit_local.channel_listings WHERE workspace_id=$1 AND channel_id=$2 FOR UPDATE',[workspaceId,channelId])
 if(listings.rowCount!==279)throw new Error('기존 자사몰 자료가 준비 이후 변경됐습니다. 재확인이 필요합니다.')
 const base=await realpath(storageRoot)
 const workspace=join(base,workspaceId),actual=await realpath(workspace)
 if(actual.toLowerCase()!==workspace.toLowerCase())throw new Error('원본 저장 경로를 확인해 주세요.')
 const folder=join(actual,'channel-sources');await mkdir(folder,{recursive:true})
 if((await realpath(folder)).toLowerCase()!==folder.toLowerCase())throw new Error('원본 저장 경로를 확인해 주세요.')
 const path=join(folder,`${hash}.csv`)
 try{await writeFile(path,source,{flag:'wx'})}catch(error){if(error.code!=='EEXIST'||createHash('sha256').update(await readFile(path)).digest('hex')!==hash)throw error}
 await db.query(`DELETE FROM seller_audit_local.offer_configurations WHERE workspace_id=$1 AND offer_id IN (SELECT o.id FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id WHERE l.workspace_id=$1 AND l.channel_id=$2)`,[workspaceId,channelId])
 await db.query("DELETE FROM seller_audit_local.aliases WHERE workspace_id=$1 AND source_channel='OWN_STORE'",[workspaceId])
 await db.query('DELETE FROM seller_audit_local.audit_issues WHERE workspace_id=$1 AND channel_id=$2 AND listing_id IS NULL',[workspaceId,channelId])
 await db.query('DELETE FROM seller_audit_local.channel_listings WHERE workspace_id=$1 AND channel_id=$2',[workspaceId,channelId])
 let itemCount=0,inactive=0
 for(const group of groups){
  const status=group.items.some(item=>item.status==='ACTIVE')?'ACTIVE':'INACTIVE'
  const listing=await db.query("INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name,status) VALUES($1,$2,$3,$4,$5) RETURNING id",[workspaceId,channelId,group.code,group.name,status])
  for(const item of group.items){
   await db.query('INSERT INTO seller_audit_local.channel_offers(workspace_id,listing_id,channel_option_id,option_name,seller_code,normal_price,sale_price,status,master_product_id) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,NULL)',[workspaceId,listing.rows[0].id,item.optionId,item.name,item.sellerCode,item.price,item.status])
   itemCount++;if(item.status==='INACTIVE')inactive++
  }
 }
 const result={products:groups.length,items:itemCount,inactive,sourceHash:hash,previousListings:listings.rowCount,priceRule:'base_plus_option_extra',productStatusRule:'derived_from_item_status',mappings:'cleared'}
 await db.query("INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,NULL,$2,'OWN_STORE_REPLACED','CHANNEL',$3,$4::jsonb)",[workspaceId,randomUUID(),channelId,JSON.stringify(result)])
 await db.query('COMMIT')
 return result
}catch(error){await db.query('ROLLBACK');throw error}

}
