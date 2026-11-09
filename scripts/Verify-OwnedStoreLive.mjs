import {readFile} from 'node:fs/promises'
import {log} from 'node:console'
import pg from 'pg'
import {localDatabaseUrl} from '../server/config.ts'
import {parseOwnedStoreItems} from './owned-store-replacement-plan.mjs'

const groups=parseOwnedStoreItems(await readFile('sample/자사몰 기본양식.csv'))
const pool=new pg.Pool({connectionString:localDatabaseUrl()})
try{
 const rows=await pool.query("SELECT l.channel_product_id,o.channel_option_id,o.option_name,o.sale_price,o.status,o.master_product_id FROM seller_audit_local.channels c JOIN seller_audit_local.channel_listings l ON l.workspace_id=c.workspace_id AND l.channel_id=c.id JOIN seller_audit_local.channel_offers o ON o.workspace_id=l.workspace_id AND o.listing_id=l.id WHERE c.channel_code='OWN_STORE'")
 const actual=new Map(rows.rows.map(row=>[`${row.channel_product_id}:${row.channel_option_id}`,row]))
 const expected=groups.flatMap(group=>group.items.map(item=>({code:group.code,...item})))
 let mismatch=0
 for(const item of expected){const row=actual.get(`${item.code}:${item.optionId}`);if(!row||row.option_name!==item.name||Number(row.sale_price)!==item.price||row.status!==item.status||row.master_product_id!==null)mismatch++}
 if(actual.size!==expected.length||mismatch)throw new Error(`Mismatch: ${mismatch}, expected ${expected.length}, actual ${actual.size}`)
 log(`Verified ${groups.length} products and ${expected.length} item codes, names, prices, statuses and cleared mappings.`)
}finally{await pool.end()}
