/* global console */
import {mkdtemp,mkdir,copyFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import pg from 'pg'
import {localDatabaseUrl} from '../server/config.ts'
import {prepareOwnedStore,ownedStoreFingerprint} from '../server/import/prepareOwnedStore.ts'
import {applyOwnedStore} from '../server/import/applyOwnedStore.ts'

const root=await mkdtemp(join(tmpdir(),'owned-store-verify-'))
const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1,connectionTimeoutMillis:3000}),db=await pool.connect()
try{
 const found=await db.query(`SELECT m.workspace_id,m.user_id,u.email,u.display_name FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE' LIMIT 2`)
 if(found.rowCount!==1)throw new Error('Administrator ambiguous')
 const x=found.rows[0],actor={workspaceId:x.workspace_id,userId:x.user_id,email:x.email,displayName:x.display_name,role:'ADMIN'}
 const sources=await db.query("SELECT id FROM seller_audit_local.import_source_files WHERE workspace_id=$1 AND server_verified_sha256=$2 AND verification_status='VERIFIED' LIMIT 1",[actor.workspaceId,'fb41458bab90f1a2a5f85ad165dc1e8ff25a383a63ecf482653bd70f30fd3779'])
 if(sources.rowCount!==1)throw new Error('Master unavailable')
 const folder=join(root,actor.workspaceId,sources.rows[0].id);await mkdir(folder,{recursive:true})
 await copyFile(join(resolve('../SellerAudit-data'),actor.workspaceId,sources.rows[0].id,'source.xlsx'),join(folder,'source.xlsx'))
 const plan=await prepareOwnedStore(db,root,actor.workspaceId)
 const fake={connect:async()=>({query:(sql,...args)=>db.query(sql==='COMMIT'?'ROLLBACK':sql,...args),release:()=>{}})}
 const result=await applyOwnedStore(fake,root,actor,ownedStoreFingerprint(plan))
 if((await db.query("SELECT 1 FROM seller_audit_local.channels WHERE workspace_id=$1 AND channel_code='OWN_STORE'",[actor.workspaceId])).rowCount)throw new Error('Rollback verification failed')
 console.log(JSON.stringify({status:'ROLLED_BACK_TEST',...result}))
}finally{db.release();await pool.end();await rm(root,{recursive:true,force:true})}
