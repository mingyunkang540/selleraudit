import pg from 'pg'
import {log} from 'node:console'
import {localDatabaseUrl} from '../server/config.ts'
import {applyOwnedStoreBatch} from '../server/business/ownedStoreBatch.ts'
const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1})
const db=await pool.connect()
try{
 const admins=await db.query("SELECT m.workspace_id,m.user_id,u.email,u.display_name FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'")
 if(admins.rowCount!==1)throw new Error('Administrator ambiguous')
 const a=admins.rows[0],actor={workspaceId:a.workspace_id,userId:a.user_id,email:a.email,displayName:a.display_name,role:'ADMIN'}
 const fake={connect:async()=>({query:(sql,...values)=>db.query(sql==='COMMIT'?'ROLLBACK':sql,...values),release:()=>{}})}
 const count=await applyOwnedStoreBatch(fake,actor)
 if(count!==533)throw new Error('Count mismatch')
 const result=await db.query("SELECT count(*)::int AS n FROM seller_audit_local.activity_logs WHERE action_type='OWN_STORE_MATCHED_BATCH'")
 if(result.rows[0].n!==0)throw new Error('Rollback failed')
 log(`Rollback test passed: ${count} mappings validated against live database.`)
}finally{db.release();await pool.end()}
