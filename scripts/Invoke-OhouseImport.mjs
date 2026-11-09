import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import process from 'node:process'
import pg from 'pg'
import {prepareOhouse} from '../server/import/prepareOhouse.ts'
import {applyOhouse,ohouseFingerprint} from '../server/import/applyOhouse.ts'
import {localDatabaseUrl} from '../server/config.ts'

const source=JSON.parse((await readFile('../outputs/local-registration/ohouse-source.json','utf8')).replace(/^\uFEFF/,''))
if(!/^[0-9a-f-]{36}$/i.test(source.id)||source.hash!=='6deeaa72798da9f768b174bbfe910425704ca399bc6b6995c3af3564895a1d79')throw new Error('Source record unavailable')
const response=await globalThis.fetch('http://127.0.0.1:4179/api/auth/session')
if(!response.ok)throw new Error('Local session unavailable')
const session=await response.json()
if(!session.openMode||session.user?.role!=='ADMIN'||!session.importEnabled)throw new Error('Local administrator unavailable')
const root=resolve('../SellerAudit-data');const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:2,connectionTimeoutMillis:3000})
try{
  const plan=await prepareOhouse(pool,root,session.user.workspaceId,source.id)
  const fingerprint=ohouseFingerprint(plan)
  const reasons=Object.fromEntries([...new Set(plan.options.map(item=>item.reason))].map(reason=>[reason,plan.options.filter(item=>item.reason===reason).length]))
  const report={status:'PLANNED',createdUtc:new Date().toISOString(),sourceId:source.id,sourceHash:source.hash,fingerprint,plan:{listings:new Set(plan.options.map(item=>item.productCode)).size,offers:plan.options.length,automatic:plan.options.filter(item=>item.masterProductId).length,reasons}}
  const dir=resolve('../outputs/local-registration');await mkdir(dir,{recursive:true});const file=join(dir,`ohouse-registration-${Date.now()}-${randomUUID().slice(0,8)}.json`)
  await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'})
  process.stdout.write(`오늘의집 상품 ${report.plan.listings}개, 옵션 ${report.plan.offers}개, 자동 연결 ${report.plan.automatic}개를 처리합니다.\n`)
  const result=await applyOhouse(pool,root,session.user,source.id,fingerprint)
  await writeFile(file,JSON.stringify({...report,status:'COMPLETED',completedUtc:new Date().toISOString(),result},null,2))
  process.stdout.write(`완료: 상품 ${result.listings}개, 옵션 ${result.offers}개, 자동 연결 ${result.mapped}개, 확인 대기 ${result.unmatched}개.\n결과: ${file}\n`)
}finally{await pool.end()}
