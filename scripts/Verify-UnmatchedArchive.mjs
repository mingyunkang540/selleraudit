import pg from 'pg'
import {log} from 'node:console'
import {localDatabaseUrl} from '../server/config.ts'
import {archiveUnmatchedOffer} from '../server/business/write.ts'
const pool=new pg.Pool({connectionString:localDatabaseUrl(),max:1}),db=await pool.connect()
try{
 const admins=await db.query("SELECT m.workspace_id,m.user_id,u.email,u.display_name FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'")
 if(admins.rowCount!==1)throw new Error('Administrator ambiguous')
 const a=admins.rows[0],actor={workspaceId:a.workspace_id,userId:a.user_id,email:a.email,displayName:a.display_name,role:'ADMIN'}
 const offers=await db.query(`SELECT o.id FROM seller_audit_local.channel_offers o WHERE o.workspace_id=$1 AND o.master_product_id IS NULL AND NOT EXISTS (SELECT 1 FROM seller_audit_local.activity_logs a WHERE a.workspace_id=o.workspace_id AND ((a.entity_id=o.id AND a.action_type IN ('INACTIVE_OFFER_ARCHIVED','UNMATCHED_OFFER_ARCHIVED')) OR (a.entity_id=o.listing_id AND a.action_type='TEST_LISTING_ARCHIVED'))) LIMIT 1`,[actor.workspaceId])
 if(offers.rowCount!==1)throw new Error('No unmatched offer to test')
 let inserted=false
 const fake={connect:async()=>({query:async(sql,...values)=>{if(sql==='COMMIT'){const q=await db.query("SELECT 1 FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND entity_id=$2 AND action_type='UNMATCHED_OFFER_ARCHIVED'",[actor.workspaceId,offers.rows[0].id]);inserted=q.rowCount===1;return db.query('ROLLBACK')}return db.query(sql,...values)},release:()=>{}})}
 await archiveUnmatchedOffer(fake,actor,offers.rows[0].id)
 if(!inserted)throw new Error('Archive was not recorded')
 const after=await db.query("SELECT 1 FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND entity_id=$2 AND action_type='UNMATCHED_OFFER_ARCHIVED'",[actor.workspaceId,offers.rows[0].id])
 if(after.rowCount)throw new Error('Rollback failed')
 try{await archiveUnmatchedOffer(fake,{...actor,role:'VIEWER'},offers.rows[0].id);throw new Error('Expected denial')}catch(error){if(error.message!=='Not authorized')throw error}
 log('Archive test passed: write, rollback and viewer denial.')
}finally{db.release();await pool.end()}
