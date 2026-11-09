import type {Pool} from 'pg'
import type {Identity} from '../auth/service.ts'
const keys=['cost','normal','regular','basic','medium','large','live','group'] as const
type Key=typeof keys[number]
export type ProductMasterInput={id?:string;expectedUpdatedAt?:string;sabangnetCode:string;productName:string;category:string|null;productType:'SINGLE'|'SET';status:'ACTIVE'|'INACTIVE'|'DRAFT';prices:Record<Key,number|null>|null;components:{skuId:string;quantity:number}[]}
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
export async function saveProductMaster(pool:Pool,actor:Identity,input:ProductMasterInput){
 if(actor.role!=='ADMIN'&&actor.role!=='EDITOR')throw new Error('Not authorized')
 if(!input||(input.id!==undefined&&!uuid(input.id))||(input.id!==undefined&&(typeof input.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(input.expectedUpdatedAt))))||typeof input.sabangnetCode!=='string'||input.sabangnetCode.trim().length>100||typeof input.productName!=='string'||!input.productName.trim()||input.productName.trim().length>200||!(input.category===null||typeof input.category==='string'&&input.category.length<=100)||!['SINGLE','SET'].includes(input.productType)||!['ACTIVE','INACTIVE','DRAFT'].includes(input.status)||!Array.isArray(input.components)||!input.components.length||input.components.length>200)throw new Error('Invalid product')
 if(input.prices!==null){if(!input.prices||keys.some(k=>input.prices![k]!==null&&(!Number.isSafeInteger(input.prices![k])||Number(input.prices![k])<0||Number(input.prices![k])>999999999999)))throw new Error('Invalid prices')}
 if(input.components.some(c=>!c||!uuid(c.skuId)||!Number.isSafeInteger(c.quantity)||c.quantity<1||c.quantity>100000)||new Set(input.components.map(c=>c.skuId)).size!==input.components.length)throw new Error('Invalid components')
 const db=await pool.connect()
 try{
  await db.query('BEGIN')
  const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role IN ('ADMIN','EDITOR') AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId]);if(member.rowCount!==1)throw new Error('Not authorized')
  const code=input.sabangnetCode.trim()||null
  let id=input.id,needsReview=false
  if(id){
   const existing=await db.query<{sabangnet_code:string|null;product_name:string;product_type:string;status:string}>('SELECT sabangnet_code,product_name,product_type,status FROM seller_audit_local.products WHERE workspace_id=$1 AND id=$2 AND date_trunc(\'milliseconds\',updated_at)=$3::timestamptz FOR UPDATE',[actor.workspaceId,id,input.expectedUpdatedAt]);if(existing.rowCount!==1)throw new Error('Product changed; refresh')
   const oldComponents=await db.query<{sku_id:string;quantity:number}>('SELECT sku_id,quantity FROM seller_audit_local.product_components WHERE workspace_id=$1 AND product_id=$2 ORDER BY sku_id',[actor.workspaceId,id])
   const before=oldComponents.rows.map(c=>`${c.sku_id}:${c.quantity}`).sort(),after=input.components.map(c=>`${c.skuId}:${c.quantity}`).sort(),old=existing.rows[0]
   needsReview=old.sabangnet_code!==code||old.product_name!==input.productName.trim()||old.product_type!==input.productType||old.status!==input.status||JSON.stringify(before)!==JSON.stringify(after)
  }
  const skus=await db.query(`SELECT s.id FROM seller_audit_local.skus s WHERE s.workspace_id=$1 AND s.id=ANY($2::uuid[]) AND (s.status='ACTIVE' OR EXISTS (SELECT 1 FROM seller_audit_local.product_components c WHERE c.workspace_id=s.workspace_id AND c.sku_id=s.id AND c.product_id=$3::uuid))`,[actor.workspaceId,input.components.map(c=>c.skuId),id??null]);if(skus.rowCount!==input.components.length)throw new Error('SKU unavailable')
  const category=input.category?.trim()||null
  if(id){
   const collection=await db.query('SELECT 1 FROM seller_audit_local.market_collections WHERE workspace_id=$1 AND product_id=$2',[actor.workspaceId,id]);if(collection.rowCount&&input.prices!==null)throw new Error('Collection uses option prices')
   await db.query('UPDATE seller_audit_local.products SET sabangnet_code=$3,product_name=$4,category=$5,product_type=$6,status=$7 WHERE workspace_id=$1 AND id=$2',[actor.workspaceId,id,code,input.productName.trim(),category,input.productType,input.status])
   await db.query('DELETE FROM seller_audit_local.product_components WHERE workspace_id=$1 AND product_id=$2',[actor.workspaceId,id])
  }else{const created=await db.query<{id:string}>('INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,category,product_type,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',[actor.workspaceId,code,input.productName.trim(),category,input.productType,input.status]);id=created.rows[0].id}
  for(const c of input.components)await db.query('INSERT INTO seller_audit_local.product_components(workspace_id,product_id,sku_id,quantity) VALUES($1,$2,$3,$4)',[actor.workspaceId,id,c.skuId,c.quantity])
  if(input.prices!==null){const v=keys.map(k=>input.prices![k]);await db.query(`INSERT INTO seller_audit_local.product_manual_prices(workspace_id,product_id,cost,normal,regular,basic,medium,large,live,"group") VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(workspace_id,product_id) DO UPDATE SET cost=EXCLUDED.cost,normal=EXCLUDED.normal,regular=EXCLUDED.regular,basic=EXCLUDED.basic,medium=EXCLUDED.medium,large=EXCLUDED.large,live=EXCLUDED.live,"group"=EXCLUDED."group",updated_at=now()`,[actor.workspaceId,id,...v])}
  if(needsReview){const linked=await db.query('SELECT 1 FROM seller_audit_local.channel_offers WHERE workspace_id=$1 AND master_product_id=$2 LIMIT 1',[actor.workspaceId,id]);const prior=await db.query("SELECT 1 FROM seller_audit_local.audit_issues WHERE workspace_id=$1 AND product_id=$2 AND issue_type='CHANGED_LISTING' AND title='상품 마스터 변경 후 채널 연결 확인' AND status IN ('OPEN','IN_PROGRESS') LIMIT 1",[actor.workspaceId,id]);if(linked.rowCount&&!prior.rowCount)await db.query("INSERT INTO seller_audit_local.audit_issues(workspace_id,product_id,issue_type,severity,title,description) VALUES($1,$2,'CHANGED_LISTING','WARNING','상품 마스터 변경 후 채널 연결 확인','품번, 상품명, 상태 또는 기본 SKU 구성이 변경됐습니다. 연결된 채널 옵션과 구성 옵션을 다시 확인해 주세요.')",[actor.workspaceId,id])}
  await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'PRODUCT_MASTER_SAVED','PRODUCT',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,id,JSON.stringify({sabangnetCode:code,productName:input.productName.trim(),category,productType:input.productType,status:input.status,prices:input.prices,components:input.components})])
  await db.query('COMMIT');return {id}
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
