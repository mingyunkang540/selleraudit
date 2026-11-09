import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Pool } from 'pg'
import type { Identity } from '../auth/service.ts'
import { storeSource } from './sourceStore.ts'

export async function registerSource(pool:Pool,actor:Identity,root:string,file:{name:string;bytes:Buffer;observedHash:string}):Promise<{id:string;serverSha256:string;serverByteSize:number}> {
  if(!/\.xlsx$/i.test(file.name)||file.name.length>255||/[/\\]/.test(file.name)||Array.from(file.name).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||!file.bytes.length||file.bytes.length>52428800||!/^[a-f0-9]{64}$/.test(file.observedHash))throw new Error('Invalid source')
  if(actor.role!=='ADMIN'&&actor.role!=='EDITOR')throw new Error('Not authorized')
  const id=randomUUID();const path=`${actor.workspaceId}/${id}/source.xlsx`
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    const permitted=await client.query(`SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
    if(permitted.rowCount!==1)throw new Error('Not authorized')
    await client.query(`INSERT INTO seller_audit_local.import_source_files(id,workspace_id,original_filename,storage_object_path,client_observed_byte_size,client_observed_sha256,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,actor.workspaceId,file.name,path,file.bytes.length,file.observedHash,actor.userId])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  try {
    const verified=await storeSource({root,workspaceId:actor.workspaceId,sourceId:id,stream:Readable.from(file.bytes),expectedHash:file.observedHash,expectedBytes:file.bytes.length})
    const final=await pool.connect()
    try {
      await final.query('BEGIN')
      const member=await final.query<{actor_ref:string}>(`SELECT m.actor_ref FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id
        WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN ('ADMIN','EDITOR') AND u.status='ACTIVE' FOR SHARE OF m,u`,[actor.workspaceId,actor.userId])
      if(member.rowCount!==1)throw new Error('Not authorized')
      const updated=await final.query("UPDATE seller_audit_local.import_source_files SET verification_status='VERIFIED',server_verified_sha256=$2,server_verified_byte_size=$3,verified_by=$4,verified_at=now(),updated_at=now() WHERE id=$1 AND workspace_id=$5 AND verification_status='PENDING_UPLOAD'",[id,verified.hash,verified.bytes,actor.userId,actor.workspaceId])
      if(updated.rowCount!==1)throw new Error('Source is no longer eligible')
      await final.query("INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id) VALUES($1,$2,$3,'IMPORT_SOURCE_VERIFIED','IMPORT_SOURCE_FILE',$4)",[actor.workspaceId,actor.userId,member.rows[0].actor_ref,id])
      await final.query('COMMIT')
    }catch(error){await final.query('ROLLBACK');throw error}finally{final.release()}
    return {id,serverSha256:verified.hash,serverByteSize:verified.bytes}
  }catch(error){
    const mismatch=error instanceof Error && error.message==='Source verification failed'
    await pool.query("UPDATE seller_audit_local.import_source_files SET verification_status=$2,verification_error_code=$3,updated_at=now() WHERE id=$1 AND verification_status='PENDING_UPLOAD'",[id,mismatch?'HASH_MISMATCH':'VERIFICATION_FAILED',mismatch?'HASH_MISMATCH':'LOCAL_SOURCE_FAILED']).catch(()=>{})
    throw error
  }
}
