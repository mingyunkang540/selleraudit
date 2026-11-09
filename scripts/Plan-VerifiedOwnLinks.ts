import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {log} from 'node:console'
import pg from 'pg'
import * as XLSX from 'xlsx'
import {localDatabaseUrl} from '../server/config.ts'
import {analyzeMasterWorkbook} from '../src/services/import/index.ts'
import {LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS} from '../src/services/import/localPolicy.ts'
import {planOwnedStore} from '../server/import/ownedStorePlan.ts'

const hash='fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'
const pool=new pg.Pool({connectionString:localDatabaseUrl()})
try{
 const channels=await pool.query("SELECT workspace_id FROM seller_audit_local.channels WHERE channel_code='OWN_STORE'")
 if(channels.rowCount!==1)throw new Error('Workspace unavailable')
 const workspace=channels.rows[0].workspace_id
 const source=await pool.query("SELECT id FROM seller_audit_local.import_source_files WHERE workspace_id=$1 AND server_verified_sha256=$2 AND verification_status='VERIFIED' LIMIT 1",[workspace,hash])
 if(source.rowCount!==1)throw new Error('Master unavailable')
 const master=await readFile(join(resolve('../SellerAudit-data'),workspace,source.rows[0].id,'source.xlsx'))
 if(createHash('sha256').update(master).digest('hex')!==hash)throw new Error('Master changed')
 const input=master.buffer.slice(master.byteOffset,master.byteOffset+master.byteLength) as ArrayBuffer
 const preview=await analyzeMasterWorkbook(input,'source.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
 const products=await pool.query('SELECT id,sabangnet_code AS code,product_name AS name,category,product_type AS type,status FROM seller_audit_local.products WHERE workspace_id=$1',[workspace])
 const components=await pool.query('SELECT c.product_id,s.sku_code AS sku,c.quantity FROM seller_audit_local.product_components c JOIN seller_audit_local.skus s ON s.workspace_id=c.workspace_id AND s.id=c.sku_id WHERE c.workspace_id=$1',[workspace])
 const existing=products.rows.map(p=>({...p,components:components.rows.filter(c=>c.product_id===p.id).map(c=>({sku:c.sku,quantity:c.quantity}))}))
 const original=await readFile('sample/자사몰 상품목록.csv')
 const workbook=XLSX.read(new TextDecoder('utf-8',{fatal:true}).decode(original),{type:'string',raw:true})
 const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets[workbook.SheetNames[0]],{defval:'',raw:true})
 for(const row of rows)row['옵션사용']='N'
 const csv=XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows))
 const verified=planOwnedStore(Buffer.from(csv),master,preview,existing).filter(item=>item.masterProductId)
 await writeFile('../outputs/local-registration/own-store-verified-links.json',JSON.stringify(verified,null,2),'utf8')
 log(`Verified original master links: ${verified.length}`)
}finally{await pool.end()}
