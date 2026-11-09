import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import process from 'node:process'
import pg from 'pg'
import {prepareOhouse} from '../server/import/prepareOhouse.ts'
import {localDatabaseUrl} from '../server/config.ts'

const source=JSON.parse((await readFile('../outputs/local-registration/ohouse-source.json','utf8')).replace(/^\uFEFF/,''))
const response=await globalThis.fetch('http://127.0.0.1:4179/api/auth/session');if(!response.ok)throw new Error('Local session unavailable')
const session=await response.json();if(!session.openMode||session.user?.role!=='ADMIN')throw new Error('Local administrator unavailable')
const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1,connectionTimeoutMillis:3000})
try{
  const plan=await prepareOhouse(pool,resolve('../SellerAudit-data'),session.user.workspaceId,source.id)
  const reasons=Object.fromEntries([...new Set(plan.options.map(item=>item.reason))].map(reason=>[reason,plan.options.filter(item=>item.reason===reason).length]))
  process.stdout.write(JSON.stringify({listings:new Set(plan.options.map(item=>item.productCode)).size,options:plan.options.length,mapped:plan.options.filter(item=>item.masterProductId).length,inactive:plan.options.filter(item=>item.status==='INACTIVE').length,reasons})+'\n')
}finally{await pool.end()}
