/* global fetch, console */
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {resolve,join} from 'node:path'
import pg from 'pg'
import {localDatabaseUrl} from '../server/config.ts'
import {analyzeMasterWorkbook} from '../src/services/import/index.ts'
import {LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS} from '../src/services/import/localPolicy.ts'
import {planSmartstore} from '../server/import/smartstorePlan.ts'

const hash=b=>createHash('sha256').update(b).digest('hex')
const sourceHash='aa34891edce0647bfac641176a5ce3b503f13270d2ae3f0293c347d006e2f0c0'
const masterHash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
const source=await readFile('sample/스마트스토어 상품목록.csv')
if(hash(source)!==sourceHash)throw Error('Source file changed')
const session=await (await fetch('http://127.0.0.1:4179/api/auth/session')).json()
if(!session.openMode||session.user?.role!=='ADMIN')throw Error('Local administrator unavailable')
const actor=session.user,root=await realpath(resolve('../SellerAudit-data'))
const folder=join(root,actor.workspaceId,'channel-sources');await mkdir(folder,{recursive:true})
const stored=join(folder,`${sourceHash}.csv`)
try{await writeFile(stored,source,{flag:'wx'})}catch(e){if(e.code!=='EEXIST'||hash(await readFile(stored))!==sourceHash)throw e}
const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1,connectionTimeoutMillis:3000})
const db=await pool.connect()
try{
 await db.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
 const member=await db.query(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
 if(member.rowCount!==1)throw Error('Not authorized')
 await db.query('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))',[actor.workspaceId])
 for(const table of ['products','skus','product_components','channels','channel_listings','channel_offers'])await db.query(`SELECT id FROM seller_audit_local.${table} WHERE workspace_id=$1 ORDER BY id FOR UPDATE`,[actor.workspaceId])
 if((await db.query("SELECT 1 FROM seller_audit_local.channels WHERE workspace_id=$1 AND channel_code='NAVER'",[actor.workspaceId])).rowCount)throw Error('Naver channel already exists')
 const records=await db.query(`SELECT s.id,s.server_verified_byte_size FROM seller_audit_local.import_source_files s JOIN seller_audit_local.import_batches b ON b.workspace_id=s.workspace_id AND b.source_file_id=s.id WHERE s.workspace_id=$1 AND s.verification_status='VERIFIED' AND s.server_verified_sha256=$2 AND b.source_file_hash=$2 AND b.status IN ('APPLIED','PARTIALLY_APPLIED') ORDER BY b.created_at DESC LIMIT 1`,[actor.workspaceId,masterHash])
 if(records.rowCount!==1)throw Error('Verified master unavailable')
 const record=records.rows[0],expected=join(root,actor.workspaceId,record.id,'source.xlsx'),actual=await realpath(expected)
 if(expected.toLowerCase()!==actual.toLowerCase())throw Error('Invalid master path')
 const master=await readFile(actual)
 if(hash(master)!==masterHash||master.length!==Number(record.server_verified_byte_size))throw Error('Master source changed')
 const input=master.buffer.slice(master.byteOffset,master.byteOffset+master.byteLength)
 const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
 if(!preview.workbook.schemaValid)throw Error('Master invalid')
 const products=await db.query('SELECT id,sabangnet_code AS code,product_name AS name,category,product_type AS type,status FROM seller_audit_local.products WHERE workspace_id=$1',[actor.workspaceId])
 const components=await db.query(`SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1`,[actor.workspaceId])
 const existing=products.rows.map(p=>({...p,components:components.rows.filter(c=>c.product_id===p.id).map(c=>({sku:c.sku,quantity:c.quantity}))}))
 const plan=planSmartstore(source,master,preview,existing)
 if(plan.length!==210||plan.filter(p=>p.hasOptions).length!==113)throw Error('Source counts changed')
 const channel=await db.query("INSERT INTO seller_audit_local.channels(workspace_id,channel_code,channel_name,status) VALUES($1,'NAVER','스마트스토어','ACTIVE') RETURNING id",[actor.workspaceId])
 let offers=0,mapped=0
 for(const item of plan){
  const listing=await db.query("INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name,status) VALUES($1,$2,$3,$4,'ACTIVE') RETURNING id",[actor.workspaceId,channel.rows[0].id,item.id,item.name])
  if(!item.hasOptions){await db.query("INSERT INTO seller_audit_local.channel_offers(workspace_id,listing_id,channel_option_id,option_name,normal_price,sale_price,status,master_product_id) VALUES($1,$2,'BASE','단품',$3,$4,'ACTIVE',$5)",[actor.workspaceId,listing.rows[0].id,item.normalPrice,item.salePrice,item.masterProductId]);offers++;if(item.masterProductId)mapped++}
 }
 const summary={sourceHash,masterHash,sourcePath:`${actor.workspaceId}/channel-sources/${sourceHash}.csv`,listings:plan.length,offers,mapped,optionDetailsMissing:plan.filter(p=>p.hasOptions).length,extrasMissing:plan.filter(p=>p.hasExtras).length,decisions:plan.map(({id,hasOptions,hasExtras,candidateCode,masterProductId})=>({id,hasOptions,hasExtras,candidateCode,masterProductId}))}
 await db.query("INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'SMARTSTORE_IMPORT_APPLIED','CHANNEL',$4,$5::jsonb)",[actor.workspaceId,actor.userId,member.rows[0].actor_ref,channel.rows[0].id,JSON.stringify(summary)])
 const file=resolve(`../outputs/local-registration/smartstore-${Date.now()}-${randomUUID().slice(0,8)}.json`)
 await writeFile(file,JSON.stringify({status:'PLANNED',...summary},null,2),{flag:'wx'})
 await db.query('COMMIT')
 await writeFile(file,JSON.stringify({status:'COMPLETED',...summary},null,2))
 console.log(JSON.stringify({status:'COMPLETED',listings:summary.listings,offers,mapped,optionDetailsMissing:summary.optionDetailsMissing,extrasMissing:summary.extrasMissing,file}))
}catch(e){await db.query('ROLLBACK');throw e}finally{db.release();await pool.end()}
