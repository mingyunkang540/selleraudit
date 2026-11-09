import {readFile,writeFile} from 'node:fs/promises'
import {log} from 'node:console'
import pg from 'pg'
import {localDatabaseUrl} from '../server/config.ts'
import {readBusinessData} from '../server/business/read.ts'
const pool=new pg.Pool({connectionString:localDatabaseUrl()})
try{
 const admins=await pool.query("SELECT m.workspace_id,m.user_id,u.email,u.display_name FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id JOIN seller_audit_local.channels c ON c.workspace_id=m.workspace_id AND c.channel_code='OWN_STORE' WHERE m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'")
 if(admins.rowCount!==1)throw new Error('Administrator ambiguous')
 const a=admins.rows[0],actor={workspaceId:a.workspace_id,userId:a.user_id,email:a.email,displayName:a.display_name,role:'ADMIN'}
 const data=await readBusinessData(pool,actor),{plan,tests}=JSON.parse(await readFile('../outputs/local-registration/own-store-extra-plan.json','utf8'))
 const rows=await pool.query('SELECT offer_id,configuration_id FROM seller_audit_local.offer_configurations WHERE workspace_id=$1',[a.workspace_id])
 const bindings=new Map(rows.rows.map(x=>[x.offer_id,x.configuration_id]))
 const offers=new Map(data.offers.map(o=>[o.id,o]))
 const bad=plan.filter(x=>offers.get(x.offerId)?.masterProductId!==x.productId||(x.configurationId&&bindings.get(x.offerId)!==x.configurationId))
 if(bad.length||tests.some(x=>offers.has(x.offerId))||data.listings.some(l=>l.channelProductId==='P00000GA'))throw new Error('Mismatch after apply')
 const own=data.channels.find(c=>c.channelCode==='OWN_STORE'),listings=new Set(data.listings.filter(l=>l.channelId===own.id).map(l=>l.id)),remaining=data.offers.filter(o=>listings.has(o.listingId)&&!o.masterProductId)
 const clean=x=>String(x??'').replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|')
 const lines=['# 자사몰 미매칭 확인 목록','','상품명이나 옵션만으로 구성을 확정하기 어려운 항목입니다.','','| 상품코드 | 상품명 | 품목코드 | 옵션명 | 상태 |','| --- | --- | --- | --- | --- |',...remaining.map(o=>{const l=data.listings.find(x=>x.id===o.listingId);return `| ${clean(l?.channelProductId)} | ${clean(l?.productName)} | ${clean(o.channelOptionId)} | ${clean(o.optionName)} | ${o.status==='ACTIVE'?'판매 중':'미사용'} |`})]
 await writeFile('../outputs/local-registration/자사몰-남은-확인목록.md',lines.join('\n'),'utf8')
 log(JSON.stringify({verified:plan.length,testHidden:tests.length,remainingActive:remaining.filter(x=>x.status==='ACTIVE').length,remainingInactive:remaining.filter(x=>x.status==='INACTIVE').length}))
}finally{await pool.end()}
