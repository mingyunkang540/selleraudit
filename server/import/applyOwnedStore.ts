import {createHash} from 'node:crypto'
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'
import {prepareOwnedStore,ownedStoreFingerprint} from './prepareOwnedStore.ts'

export async function applyOwnedStore(pool:Pool,root:string,actor:Identity,fingerprint:string){
 if(actor.role!=='ADMIN'||!/^[0-9a-f]{64}$/.test(fingerprint))throw new Error('Not authorized')
 const db=await pool.connect()
 try{
  await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
  const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
  if(member.rowCount!==1)throw new Error('Not authorized')
  await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[actor.workspaceId])
  for(const table of ['products','skus','product_components','channels','channel_listings','channel_offers'])await db.query(`SELECT id FROM seller_audit_local.${table} WHERE workspace_id=$1 ORDER BY id FOR UPDATE`,[actor.workspaceId])
  const plan=await prepareOwnedStore(db,root,actor.workspaceId)
  if(ownedStoreFingerprint(plan)!==fingerprint)throw new Error('Plan changed')
  const source=await readFile(resolve('sample/자사몰 상품목록.csv'))
  if(createHash('sha256').update(source).digest('hex')!==plan.sourceHash)throw new Error('Source changed')
  const base=await realpath(root),workspace=join(base,actor.workspaceId),actual=await realpath(workspace)
  if(process.platform==='win32'?actual.toLowerCase()!==workspace.toLowerCase():actual!==workspace)throw new Error('Invalid workspace path')
  const dir=join(actual,'channel-sources');await mkdir(dir,{recursive:true})
  if((await realpath(dir)).toLowerCase()!==dir.toLowerCase())throw new Error('Invalid source path')
  const stored=join(dir,`${plan.sourceHash}.csv`)
  try{await writeFile(stored,source,{flag:'wx'})}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||createHash('sha256').update(await readFile(stored)).digest('hex')!==plan.sourceHash)throw error}
  const channel=await db.query<{id:string}>("INSERT INTO seller_audit_local.channels(workspace_id,channel_code,channel_name,status) VALUES($1,'OWN_STORE','자사몰','ACTIVE') RETURNING id",[actor.workspaceId])
  let offers=0,mapped=0
  for(const item of plan.listings){
   const listing=await db.query<{id:string}>("INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name,status) VALUES($1,$2,$3,$4,$5) RETURNING id",[actor.workspaceId,channel.rows[0].id,item.id,item.name,item.status])
   if(!item.hasOptions){await db.query("INSERT INTO seller_audit_local.channel_offers(workspace_id,listing_id,channel_option_id,option_name,normal_price,sale_price,status,master_product_id) VALUES($1,$2,'BASE','단품',NULL,$3,$4,$5)",[actor.workspaceId,listing.rows[0].id,item.price,item.status,item.masterProductId]);offers++;if(item.masterProductId)mapped++}
   else if(item.status==='ACTIVE')await db.query("INSERT INTO seller_audit_local.audit_issues(workspace_id,issue_type,severity,listing_id,title,description) VALUES($1,'NEW_LISTING','WARNING',$2,'자사몰 옵션 상세 확인 필요','옵션별 고유번호와 가격·구성을 확인한 뒤 연결해 주세요.')",[actor.workspaceId,listing.rows[0].id])
  }
  const result={listings:plan.listings.length,offers,mapped,optionsNeedReview:plan.listings.filter(x=>x.hasOptions).length,unmatchedSingles:plan.listings.filter(x=>!x.hasOptions&&!x.masterProductId).length,inactive:plan.listings.filter(x=>x.status==='INACTIVE').length}
  await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'OWN_STORE_IMPORT_APPLIED','CHANNEL',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,channel.rows[0].id,JSON.stringify({...result,sourceHash:plan.sourceHash,masterHash:plan.masterHash,fingerprint,sourceModifiedAt:plan.sourceModifiedAt,decisions:plan.listings.map(item=>({id:item.id,candidateCode:item.candidateCode,masterProductId:item.masterProductId,reason:item.reason}))})])
  await db.query('COMMIT');return result
 }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
