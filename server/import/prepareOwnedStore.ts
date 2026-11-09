import {createHash} from 'node:crypto'
import {readFile,realpath,stat} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import type {Pool} from 'pg'
import {analyzeMasterWorkbook} from '../../src/services/import/index.ts'
import {LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS} from '../../src/services/import/localPolicy.ts'
import {planOwnedStore} from './ownedStorePlan.ts'

const masterHash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
export async function prepareOwnedStore(db:Pick<Pool,'query'>,root:string,workspaceId:string){
 if((await db.query("SELECT 1 FROM seller_audit_local.channels WHERE workspace_id=$1 AND channel_code='OWN_STORE'",[workspaceId])).rowCount)throw new Error('Channel already exists')
 const sourcePath=resolve('sample/자사몰 상품목록.csv'),info=await stat(sourcePath)
 if(!info.isFile()||info.size>10_000_000)throw new Error('Source unavailable')
 const source=await readFile(sourcePath),sourceHash=sha(source)
 const records=await db.query<{id:string;server_verified_byte_size:string}>(`SELECT s.id,s.server_verified_byte_size FROM seller_audit_local.import_source_files s JOIN seller_audit_local.import_batches b ON b.workspace_id=s.workspace_id AND b.source_file_id=s.id WHERE s.workspace_id=$1 AND s.verification_status='VERIFIED' AND s.server_verified_sha256=$2 AND b.source_file_hash=$2 AND b.status IN ('APPLIED','PARTIALLY_APPLIED') ORDER BY b.created_at DESC LIMIT 1`,[workspaceId,masterHash])
 if(records.rowCount!==1)throw new Error('Verified master unavailable')
 const record=records.rows[0],base=await realpath(root),expected=join(base,workspaceId,record.id,'source.xlsx'),actual=await realpath(expected)
 if(process.platform==='win32'?actual.toLowerCase()!==expected.toLowerCase():actual!==expected)throw new Error('Invalid master path')
 const master=await readFile(actual)
 if(sha(master)!==masterHash||master.length!==Number(record.server_verified_byte_size))throw new Error('Master changed')
 const input=master.buffer.slice(master.byteOffset,master.byteOffset+master.byteLength) as ArrayBuffer
 const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
 if(!preview.workbook.schemaValid)throw new Error('Master invalid')
 const products=await db.query<{id:string;code:string;name:string;category:string|null;type:string;status:string}>('SELECT id,sabangnet_code AS code,product_name AS name,category,product_type AS type,status FROM seller_audit_local.products WHERE workspace_id=$1',[workspaceId])
 const components=await db.query<{product_id:string;sku:string;quantity:number}>(`SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1`,[workspaceId])
 const existing=products.rows.map(p=>({...p,components:components.rows.filter(c=>c.product_id===p.id).map(c=>({sku:c.sku,quantity:c.quantity}))}))
 const listings=planOwnedStore(source,master,preview,existing)
 if(!listings.length||listings.length>10000)throw new Error('Invalid listing count')
 return {sourceHash,masterHash,sourceModifiedAt:info.mtime.toISOString(),listings}
}
export const ownedStoreFingerprint=(plan:Awaited<ReturnType<typeof prepareOwnedStore>>)=>createHash('sha256').update(JSON.stringify(plan)).digest('hex')
