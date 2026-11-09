import {PGlite} from '@electric-sql/pglite'
import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {log} from 'node:console'
import {parseOwnedStoreItems} from './owned-store-replacement-plan.mjs'
import {replaceOwnedStore} from './owned-store-replacement-transaction.mjs'

const db=new PGlite(),root=await mkdtemp(join(tmpdir(),'seller-replace-test-'))
try{
 await db.exec('CREATE SCHEMA seller_audit_local')
 for(const file of ['0001_foundation.sql','0002_local_business_tables.sql','0010_product_configurations.sql'])await db.exec(await readFile(`server/migrations/${file}`,'utf8'))
 const w=(await db.query("INSERT INTO seller_audit_local.workspaces(name) VALUES('test') RETURNING id")).rows[0].id
 await mkdir(join(root,w))
 const c=(await db.query("INSERT INTO seller_audit_local.channels(workspace_id,channel_code,channel_name) VALUES($1,'OWN_STORE','own') RETURNING id",[w])).rows[0].id
 const other=(await db.query("INSERT INTO seller_audit_local.channels(workspace_id,channel_code,channel_name) VALUES($1,'OTHER','other') RETURNING id",[w])).rows[0].id
 await db.query("INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name) SELECT $1,$2,'OLD'||n,'old' FROM generate_series(1,279) n",[w,c])
 await db.query("INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name) VALUES($1,$2,'other','other')",[w,other])
 const listing=(await db.query('SELECT id FROM seller_audit_local.channel_listings WHERE workspace_id=$1 AND channel_id=$2 LIMIT 1',[w,c])).rows[0].id
 await db.query("INSERT INTO seller_audit_local.audit_issues(workspace_id,listing_id,issue_type,severity,title,description) VALUES($1,$2,'NEW_LISTING','WARNING','old','old')",[w,listing])
 const source=await readFile('sample/자사몰 기본양식.csv'),hash=createHash('sha256').update(source).digest('hex'),groups=parseOwnedStoreItems(source)
 let fail=true,count=0
 const client={query:async(sql,values)=>{if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};if(fail&&sql.startsWith('INSERT INTO seller_audit_local.channel_offers')&&++count===10)throw new Error('test failure');return db.query(sql,values)}}
 try{await replaceOwnedStore(client,groups,source,hash,root);throw new Error('Expected failure')}catch(error){if(error.message!=='test failure')throw error}
 const original=(await db.query('SELECT count(*)::int AS n FROM seller_audit_local.channel_listings WHERE channel_id=$1',[c])).rows[0].n
 if(original!==279)throw new Error('Rollback failed')
 fail=false
 const result=await replaceOwnedStore(client,groups,source,hash,root)
 const counts=await db.query('SELECT (SELECT count(*) FROM seller_audit_local.channel_listings WHERE channel_id=$1)::int AS listings,(SELECT count(*) FROM seller_audit_local.channel_offers WHERE workspace_id=$2)::int AS offers,(SELECT count(*) FROM seller_audit_local.channel_listings WHERE channel_id=$3)::int AS other,(SELECT count(*) FROM seller_audit_local.audit_issues WHERE workspace_id=$2)::int AS issues',[c,w,other])
 if(result.products!==269||result.items!==698||counts.rows[0].listings!==269||counts.rows[0].offers!==698||counts.rows[0].other!==1||counts.rows[0].issues!==0)throw new Error('Counts do not match')
 try{await replaceOwnedStore(client,groups,source,hash,root);throw new Error('Expected duplicate failure')}catch(error){if(!error.message.includes('이미 등록'))throw error}
 log('Replacement test passed: rollback, counts, other channel, issue cascade and duplicate guard.')
}finally{await db.close();await rm(root,{recursive:true,force:true})}
