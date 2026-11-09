import pg from 'pg'
import {log} from 'node:console'
import process from 'node:process'
import {localDatabaseUrl} from '../server/config.ts'
import {applyOwnedStoreExtra} from '../server/business/ownedStoreExtra.ts'
const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1}),db=await pool.connect()
try{
 const admins=await db.query("SELECT m.workspace_id,m.user_id,u.email,u.display_name FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id JOIN seller_audit_local.channels c ON c.workspace_id=m.workspace_id AND c.channel_code='OWN_STORE' WHERE m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'")
 if(admins.rowCount!==1)throw new Error('Administrator ambiguous')
 const a=admins.rows[0],actor={workspaceId:a.workspace_id,userId:a.user_id,email:a.email,displayName:a.display_name,role:'ADMIN'}
 const dry=process.argv[2]!=='--apply'
 const fake={connect:async()=>({query:(sql,...values)=>db.query(dry&&sql==='COMMIT'?'ROLLBACK':sql,...values),release:()=>{}})}
 const result=await applyOwnedStoreExtra(fake,actor)
 log(JSON.stringify({mode:dry?'rolled-back-test':'applied',...result}))
}finally{db.release();await pool.end()}
