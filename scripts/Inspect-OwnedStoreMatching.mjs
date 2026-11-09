import {writeFile} from 'node:fs/promises'
import {log} from 'node:console'
import pg from 'pg'
import {localDatabaseUrl} from '../server/config.ts'

const pool=new pg.Pool({connectionString:localDatabaseUrl()})
try{
 const products=await pool.query(`SELECT p.id,p.product_name,p.sabangnet_code,p.status,coalesce(json_agg(json_build_object('sku',s.sku_code,'name',s.model_name,'quantity',pc.quantity)) FILTER(WHERE s.id IS NOT NULL),'[]') AS components FROM seller_audit_local.products p LEFT JOIN seller_audit_local.product_components pc ON pc.workspace_id=p.workspace_id AND pc.product_id=p.id LEFT JOIN seller_audit_local.skus s ON s.workspace_id=pc.workspace_id AND s.id=pc.sku_id WHERE p.status='ACTIVE' GROUP BY p.id ORDER BY p.product_name`)
 const offers=await pool.query(`SELECT o.id,o.channel_option_id,o.option_name,o.sale_price,o.status,l.channel_product_id,l.product_name FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id JOIN seller_audit_local.channels c ON c.workspace_id=l.workspace_id AND c.id=l.channel_id WHERE c.channel_code='OWN_STORE' AND o.master_product_id IS NULL ORDER BY l.product_name,o.option_name`)
 const mapped=await pool.query(`SELECT l.product_name,o.option_name,p.product_name AS master_name,p.sabangnet_code,p.id AS product_id FROM seller_audit_local.channel_offers o JOIN seller_audit_local.channel_listings l ON l.workspace_id=o.workspace_id AND l.id=o.listing_id JOIN seller_audit_local.channels c ON c.workspace_id=l.workspace_id AND c.id=l.channel_id JOIN seller_audit_local.products p ON p.workspace_id=o.workspace_id AND p.id=o.master_product_id WHERE c.channel_code IN ('NAVER','OHOUSE') AND o.status='ACTIVE'`)
 await writeFile('../outputs/local-registration/own-store-matching-input.json',JSON.stringify({products:products.rows,offers:offers.rows,mapped:mapped.rows},null,2),'utf8')
 log(JSON.stringify({products:products.rowCount,offers:offers.rowCount,otherChannelMappings:mapped.rowCount}))
}finally{await pool.end()}
