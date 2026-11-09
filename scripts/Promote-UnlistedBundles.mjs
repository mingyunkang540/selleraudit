/* global fetch,process,console */
import pg from 'pg'
const expected=new Map([
 ['f9c8c67d-5110-43b3-945a-4eaab3d622d3',7],
 ['98b04414-2f8c-408c-8cb5-f0c0ac70ebb5',17],
 ['095f5af4-ee79-4c3f-a5ac-449845f26cf9',6],
])
const response=await fetch('http://127.0.0.1:4179/api/auth/session')
if(!response.ok)throw Error('Session unavailable')
const session=await response.json()
if(!session.openMode||session.user?.role!=='ADMIN')throw Error('Local admin unavailable')
const db=new pg.Client({host:'127.0.0.1',port:5432,database:'selleraudit_local',user:'selleraudit_app',password:process.env.SELLERAUDIT_TASK_DB_PASSWORD})
await db.connect()
try{
 await db.query('BEGIN')
 const {workspaceId,userId}=session.user
 const membership=await db.query("SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u",[workspaceId,userId])
 if(membership.rowCount!==1)throw Error('Admin membership unavailable')
 const created=[]
 for(const [id,count] of expected){
  const source=await db.query('SELECT * FROM seller_audit_local.unlisted_bundles WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,id])
  if(source.rowCount!==1)throw Error('Source unavailable')
  const bundle=source.rows[0]
  const components=await db.query("SELECT c.sku_id,c.quantity FROM seller_audit_local.unlisted_bundle_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id AND s.status='ACTIVE' WHERE c.workspace_id=$1 AND c.bundle_id=$2",[workspaceId,id])
  if(components.rowCount!==count)throw Error(`Composition unavailable: ${id}`)
  const prior=await db.query("SELECT 1 FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND action_type='UNLISTED_BUNDLE_PROMOTED' AND changed_fields->>'bundleId'=$2",[workspaceId,id])
  const duplicate=await db.query('SELECT 1 FROM seller_audit_local.products WHERE workspace_id=$1 AND product_name=$2',[workspaceId,bundle.name])
  if(prior.rowCount||duplicate.rowCount)throw Error(`Already promoted or duplicate name: ${id}`)
  const product=await db.query("INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,category,product_type,status) VALUES($1,NULL,$2,$3,'SET','ACTIVE') RETURNING id",[workspaceId,bundle.name,bundle.category])
  const productId=product.rows[0].id
  for(const component of components.rows)await db.query('INSERT INTO seller_audit_local.product_components(workspace_id,product_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[workspaceId,productId,component.sku_id,component.quantity])
  await db.query('INSERT INTO seller_audit_local.product_manual_prices(workspace_id,product_id) VALUES($1,$2)',[workspaceId,productId])
  await db.query("INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'UNLISTED_BUNDLE_PROMOTED','PRODUCT',$4,$5::jsonb)",[workspaceId,userId,membership.rows[0].actor_ref,productId,JSON.stringify({bundleId:id,sourceFileId:bundle.source_file_id,sourceRow:bundle.source_row})])
  created.push({name:bundle.name,productId,components:count})
 }
 await db.query('COMMIT');console.log(JSON.stringify(created))
}catch(error){await db.query('ROLLBACK');throw error}finally{await db.end()}
