import {createHash} from 'node:crypto'
import {readFile,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import type {Pool} from 'pg'
import {analyzeMasterWorkbook} from '../../src/services/import/index.ts'
import {LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS} from '../../src/services/import/localPolicy.ts'
import {planOhouse} from './ohousePlan.ts'

const sourceHash='6deeaa72798da9f768b174bbfe910425704ca399bc6b6995c3af3564895a1d79'
const masterHash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
type Reader=Pick<Pool,'query'>
export async function prepareOhouse(db:Reader,root:string,workspaceId:string,sourceId:string){
  const sources=await db.query<{id:string;server_verified_sha256:string;server_verified_byte_size:string}>(`SELECT id,server_verified_sha256,server_verified_byte_size FROM seller_audit_local.import_source_files WHERE workspace_id=$1 AND verification_status='VERIFIED' AND (id=$2 OR server_verified_sha256=$3) ORDER BY verified_at DESC`,[workspaceId,sourceId,masterHash])
  const source=sources.rows.find(s=>s.id===sourceId&&s.server_verified_sha256===sourceHash);const master=sources.rows.find(s=>s.server_verified_sha256===masterHash)
  if(!source||!master)throw new Error('Verified workbooks unavailable')
  const applied=await db.query("SELECT 1 FROM seller_audit_local.import_batches WHERE workspace_id=$1 AND source_file_hash=$2 AND status IN ('APPLIED','PARTIALLY_APPLIED') LIMIT 1",[workspaceId,masterHash])
  if(applied.rowCount!==1)throw new Error('Master source is not applied')
  const existingChannel=await db.query("SELECT 1 FROM seller_audit_local.channels WHERE workspace_id=$1 AND channel_code='OHOUSE'",[workspaceId])
  if(existingChannel.rowCount)throw new Error('Channel already exists; review before reimport')
  const base=await realpath(root)
  const readVerified=async(s:typeof source)=>{
    const expected=join(base,workspaceId,s.id,'source.xlsx');const actual=await realpath(expected)
    if(process.platform==='win32'?expected.toLowerCase()!==actual.toLowerCase():expected!==actual)throw new Error('Invalid source path')
    const bytes=await readFile(actual)
    if(bytes.length!==Number(s.server_verified_byte_size)||createHash('sha256').update(bytes).digest('hex')!==s.server_verified_sha256)throw new Error('Source mismatch')
    return bytes
  }
  const [sourceBytes,masterBytes]=await Promise.all([readVerified(source),readVerified(master)])
  const input=masterBytes.buffer.slice(masterBytes.byteOffset,masterBytes.byteOffset+masterBytes.byteLength) as ArrayBuffer
  const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
  if(!preview.workbook.schemaValid)throw new Error('Master schema invalid')
  const products=await db.query<{id:string;code:string;name:string;category:string|null;type:string;status:string}>('SELECT id,sabangnet_code AS code,product_name AS name,category,product_type AS type,status FROM seller_audit_local.products WHERE workspace_id=$1',[workspaceId])
  const components=await db.query<{product_id:string;sku:string;quantity:number}>(`SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1`,[workspaceId])
  const existing=products.rows.map(p=>({...p,components:components.rows.filter(c=>c.product_id===p.id).map(c=>({sku:c.sku,quantity:c.quantity}))}))
  const options=planOhouse(sourceBytes,masterBytes,preview,existing)
  if(options.length!==433||new Set(options.map(o=>o.productCode)).size!==92)throw new Error('Source count changed')
  return {sourceId,sourceHash,masterHash,options}
}
