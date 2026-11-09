import pg from 'pg'
import {log} from 'node:console'
import {localDatabaseUrl} from '../server/config.ts'
import {applyOwnedStoreBatch} from '../server/business/ownedStoreBatch.ts'
const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1})
try{
 const admins=await pool.query("SELECT m.workspace_id,m.user_id,u.email,u.display_name FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id JOIN seller_audit_local.channels c ON c.workspace_id=m.workspace_id AND c.channel_code='OWN_STORE' WHERE m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'")
 if(admins.rowCount!==1)throw new Error('Administrator ambiguous')
 const a=admins.rows[0],actor={workspaceId:a.workspace_id,userId:a.user_id,email:a.email,displayName:a.display_name,role:'ADMIN'}
 const count=await applyOwnedStoreBatch(pool,actor)
 log(`Mapped ${count} own-store options.`)
}finally{await pool.end()}
