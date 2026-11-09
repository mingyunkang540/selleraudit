/* global console */
import {writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import pg from 'pg'
import {localDatabaseUrl} from '../server/config.ts'
import {prepareOwnedStore,ownedStoreFingerprint} from '../server/import/prepareOwnedStore.ts'

const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1,connectionTimeoutMillis:3000})
try{
 const workspace=await pool.query("SELECT DISTINCT workspace_id FROM seller_audit_local.workspace_members WHERE role='ADMIN' AND status='ACTIVE' LIMIT 2")
 if(workspace.rowCount!==1)throw new Error('Workspace is ambiguous')
 const plan=await prepareOwnedStore(pool,resolve('../SellerAudit-data'),workspace.rows[0].workspace_id)
 const reasons=Object.fromEntries([...new Set(plan.listings.map(x=>x.reason))].map(reason=>[reason,plan.listings.filter(x=>x.reason===reason).length]))
 const file=resolve('../outputs/local-registration/owned-store-preview.json')
 await mkdir(resolve('../outputs/local-registration'),{recursive:true})
 await writeFile(file,JSON.stringify({...plan,fingerprint:ownedStoreFingerprint(plan)},null,2),'utf8')
 console.log(JSON.stringify({listings:plan.listings.length,options:plan.listings.filter(x=>x.hasOptions).length,singles:plan.listings.filter(x=>!x.hasOptions).length,mapped:plan.listings.filter(x=>x.masterProductId).length,inactive:plan.listings.filter(x=>x.status==='INACTIVE').length,reasons,file}))
}finally{await pool.end()}
