import { createHash } from 'node:crypto'
import { readFile,realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'
import { extractWorkbookPrices,type PriceValues } from './workbookPrices.ts'
import { analyzeMasterWorkbook } from '../../src/services/import/index.ts'
import { LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS } from '../../src/services/import/localPolicy.ts'
import {readMasterPriceUpdates,mergeSafePrices} from './masterPriceSync.ts'

const expectedHash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
const columns=['cost','normal','regular','basic','medium','large','live','group'] as const
export async function readProductPrices(pool:Pool,actor:Identity,root:string){
  const manual=await pool.query<{product_id:string}&Record<typeof columns[number],string|null>>('SELECT product_id,cost,normal,regular,basic,medium,large,live,"group" FROM seller_audit_local.product_manual_prices WHERE workspace_id=$1',[actor.workspaceId])
  const manualProducts=manual.rows.map(row=>({productId:row.product_id,values:Object.fromEntries(columns.map(key=>[key,row[key]===null?null:Number(row[key])])) as PriceValues,options:[],manual:true}))
  try{
  const source=await pool.query<{id:string;server_verified_byte_size:string}>(`SELECT s.id,s.server_verified_byte_size FROM seller_audit_local.import_source_files s JOIN seller_audit_local.import_batches b ON b.workspace_id=s.workspace_id AND b.source_file_id=s.id WHERE s.workspace_id=$1 AND s.verification_status='VERIFIED' AND s.server_verified_sha256=$2 AND b.source_file_hash=$2 AND b.status IN ('APPLIED','PARTIALLY_APPLIED') ORDER BY b.created_at DESC LIMIT 1`,[actor.workspaceId,expectedHash])
  if(source.rowCount!==1)throw new Error('Verified source unavailable')
  const base=await realpath(root);const expected=join(base,actor.workspaceId,source.rows[0].id,'source.xlsx');const actual=await realpath(expected)
  if(process.platform==='win32'?expected.toLowerCase()!==actual.toLowerCase():expected!==actual)throw new Error('Invalid source path')
  const bytes=await readFile(actual)
  if(bytes.length!==Number(source.rows[0].server_verified_byte_size)||createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new Error('Source changed')
  const rows=extractWorkbookPrices(bytes)
  const input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
  const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
  if(!preview.workbook.schemaValid)throw new Error('Workbook validation failed')
  const products=await pool.query<{id:string;code:string|null;name:string}>('SELECT id,sabangnet_code AS code,product_name AS name FROM seller_audit_local.products WHERE workspace_id=$1',[actor.workspaceId])
  const options=await pool.query<{product_id:string;name:string;source_row:number;sku:string;quantity:number}>(`SELECT c.product_id,o.option_name AS name,o.source_row,s.sku_code AS sku,o.quantity FROM seller_audit_local.market_collections c JOIN seller_audit_local.market_collection_options o ON o.workspace_id=c.workspace_id AND o.collection_id=c.id JOIN seller_audit_local.skus s ON s.workspace_id=o.workspace_id AND s.id=o.sku_id WHERE c.workspace_id=$1`,[actor.workspaceId])
  const components=await pool.query<{product_id:string;sku:string;quantity:number}>(`SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1`,[actor.workspaceId])
  const approvals=await pool.query<{entity_id:string;changed_fields:{sourceHash?:string;cost?:number;retainSourceSalePrices?:boolean}}>(`SELECT entity_id,changed_fields FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND action_type='PRODUCT_PRICE_SOURCE_CONFIRMED' ORDER BY created_at DESC,id DESC`,[actor.workspaceId])
  const result=products.rows.flatMap<{productId:string;values:PriceValues|null;options:{name:string;values:PriceValues}[]}>(product=>{
    if(!product.code)return []
    const candidates=rows.filter(row=>row.code===product.code)
    if(!candidates.length)return []
    const collection=options.rows.filter(option=>option.product_id===product.id)
    if(collection.length){
      if(collection.length!==candidates.length||collection.some(option=>{
        const row=candidates.find(item=>item.row===option.source_row&&item.name===option.name)
        const bom=preview.bomComponents.filter(item=>item.productSourceRow===option.source_row)
        return !row||bom.length!==1||bom[0].skuCode!==option.sku||bom[0].quantity!==option.quantity
      }))return []
      return [{productId:product.id,values:null,options:collection.map(option=>({name:option.name,values:candidates.find(row=>row.row===option.source_row)!.values}))}]
    }
    if(product.code==='100472' && product.name==='땡스소윤 냉동용기 완벽정리세트 26P' && candidates.length===1 && candidates[0].row===125 && candidates[0].name==='땡스소윤 냉동용기 완벽정리세트 27P'){
      const approval=approvals.rows.find(item=>item.entity_id===product.id)?.changed_fields
      const expected=preview.bomComponents.filter(item=>item.productSourceRow===125&&item.skuCode!=='D08').map(item=>`${item.skuCode}:${item.quantity}`).sort()
      const actual=components.rows.filter(item=>item.product_id===product.id).map(item=>`${item.sku}:${item.quantity}`).sort()
      if(approval?.sourceHash!==expectedHash||approval.retainSourceSalePrices!==true||!Number.isSafeInteger(approval.cost)||Number(approval.cost)<0||!expected.length||JSON.stringify(expected)!==JSON.stringify(actual))return []
      return [{productId:product.id,values:{...candidates[0].values,cost:approval.cost!},options:[]}]
    }
    if(candidates.some(row=>row.name!==product.name))return []
    const source=candidates.length===1?candidates[0]:candidates.find(row=>row.channel==='공통')
    if(!source)return []
    const sourceBom=preview.bomComponents.filter(item=>item.productSourceRow===source.row).map(item=>`${item.skuCode}:${item.quantity}`).sort()
    const currentBom=components.rows.filter(item=>item.product_id===product.id).map(item=>`${item.sku}:${item.quantity}`).sort()
    if(!sourceBom.length||JSON.stringify(sourceBom)!==JSON.stringify(currentBom))return []
    const values={} as PriceValues
    for(const key of columns){const choices=new Set(candidates.map(row=>row.values[key]));values[key]=choices.size===1?candidates[0].values[key]:null}
    return [{productId:product.id,values,options:[]}]
  })
  const manualIds=new Set(manualProducts.map(row=>row.productId))
  const sync=await readMasterPriceUpdates(root,actor.workspaceId,bytes,rows,preview.bomComponents)
  let updated=0
  const synchronized=result.filter(row=>!manualIds.has(row.productId)).map(row=>{
    const product=products.rows.find(item=>item.id===row.productId)
    if(!product?.code||product.code==='100472')return row
    const update=sync.updates.get(product.code);if(!update)return row
    if(row.values){if(update.rows.some(item=>item.name!==product.name))return row;const values=mergeSafePrices(row.values,update.rows);if(JSON.stringify(values)!==JSON.stringify(row.values))updated++;return {...row,values}}
    if(!update.fullyMatched)return row
    const collection=options.rows.filter(option=>option.product_id===row.productId)
    const mapped=row.options.map(option=>{const original=collection.find(item=>item.name===option.name),candidate=original?update.byOldRow.get(original.source_row):undefined;return candidate?{...option,values:mergeSafePrices(option.values,[candidate])}:option})
    if(JSON.stringify(mapped)!==JSON.stringify(row.options))updated++
    return {...row,options:mapped}
  })
  return {source:'직접 입력 및 Master 가격',products:[...synchronized,...manualProducts],syncWarning:sync.warning,syncSkipped:sync.skipped,syncUpdated:updated}
  }catch{return {source:'직접 입력',sourceUnavailable:true,products:manualProducts}}
}

// Stores an explicit, product-specific owner decision without altering the workbook.
export async function confirm26pPrice(pool:Pool,actor:Identity,cost:number,retainSourceSalePrices:boolean){
  if(actor.role!=='ADMIN'||!Number.isSafeInteger(cost)||cost<0||retainSourceSalePrices!==true)throw new Error('Invalid price confirmation')
  const db=await pool.connect()
  try{
    await db.query('BEGIN')
    const member=await db.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
    if(member.rowCount!==1)throw new Error('Not authorized')
    const product=await db.query<{id:string}>("SELECT id FROM seller_audit_local.products WHERE workspace_id=$1 AND sabangnet_code='100472' AND product_name='땡스소윤 냉동용기 완벽정리세트 26P' AND status='ACTIVE' FOR UPDATE",[actor.workspaceId])
    if(product.rowCount!==1)throw new Error('Product unavailable')
    const source=await db.query("SELECT 1 FROM seller_audit_local.import_source_files s JOIN seller_audit_local.import_batches b ON b.workspace_id=s.workspace_id AND b.source_file_id=s.id WHERE s.workspace_id=$1 AND s.verification_status='VERIFIED' AND s.server_verified_sha256=$2 AND b.source_file_hash=$2 AND b.status IN ('APPLIED','PARTIALLY_APPLIED') LIMIT 1",[actor.workspaceId,expectedHash])
    if(source.rowCount!==1)throw new Error('Source unavailable')
    await db.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id,changed_fields) VALUES($1,$2,$3,'PRODUCT_PRICE_SOURCE_CONFIRMED','PRODUCT',$4,$5::jsonb)`,[actor.workspaceId,actor.userId,member.rows[0].actor_ref,product.rows[0].id,JSON.stringify({sourceHash:expectedHash,cost,retainSourceSalePrices})])
    await db.query('COMMIT');return {ok:true}
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
