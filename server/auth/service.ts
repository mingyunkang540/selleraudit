import type { Pool, PoolClient } from 'pg'
import { hashPassword, normalizeEmail, randomToken, tokenHash, tokenMatches, verifyPassword } from './crypto.ts'

export type Role = 'ADMIN' | 'EDITOR' | 'VIEWER'
export interface Identity { userId: string; workspaceId: string; role: Role; email: string; displayName: string }
type Row = Record<string, unknown>

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function bootstrapAdmin(pool: Pool, input: { email: string; displayName: string; password: string }): Promise<void> {
  const email = normalizeEmail(input.email)
  const displayName = input.displayName.trim()
  if (!displayName || displayName.length > 100) throw new Error('Invalid display name')
  const passwordHash = await hashPassword(input.password)
  await transaction(pool, async client => {
    const state = await client.query<{ initialized_at: Date | null }>('SELECT initialized_at FROM seller_audit_local.foundation WHERE singleton FOR UPDATE')
    if (state.rowCount !== 1 || state.rows[0].initialized_at !== null) throw new Error('Local installation already initialized')
    const existing = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM seller_audit_local.app_users')
    if (existing.rows[0].count !== '0') throw new Error('Local identity store is not empty')
    const workspaces = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM seller_audit_local.workspaces')
    if (workspaces.rows[0].count !== '0') throw new Error('Local workspace store is not empty')
    const user = await client.query<{ id: string }>("INSERT INTO seller_audit_local.app_users(email,display_name,password_hash,status,password_changed_at) VALUES($1,$2,$3,'ACTIVE',now()) RETURNING id", [email, displayName, passwordHash])
    const workspace = await client.query<{ id: string }>("INSERT INTO seller_audit_local.workspaces(name) VALUES('땡스소윤') RETURNING id")
    await client.query("INSERT INTO seller_audit_local.workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'ADMIN','ACTIVE')", [workspace.rows[0].id, user.rows[0].id])
    await client.query('UPDATE seller_audit_local.foundation SET initialized_at=now() WHERE singleton')
  })
}

export async function login(pool: Pool, emailInput: string, password: string): Promise<{ session: string; csrf: string } | null> {
  let email: string
  try { email = normalizeEmail(emailInput) } catch { return null }
  const userResult = await pool.query<{ id: string; password_hash: string | null; status: string }>('SELECT id,password_hash,status FROM seller_audit_local.app_users WHERE email=$1', [email])
  const user = userResult.rows[0]
  if (!user || user.status !== 'ACTIVE' || !user.password_hash || !(await verifyPassword(user.password_hash, password))) return null
  const session = randomToken(); const csrf = tokenHash(`csrf:${session}`)
  const inserted = await pool.query("INSERT INTO seller_audit_local.user_sessions(user_id,token_hash,csrf_hash,expires_at) SELECT id,$2,$3,now()+interval '8 hours' FROM seller_audit_local.app_users WHERE id=$1 AND status='ACTIVE' AND password_hash=$4", [user.id, tokenHash(session), tokenHash(csrf), user.password_hash])
  if (inserted.rowCount !== 1) return null
  return { session, csrf }
}

export async function currentIdentity(pool: Pool, session: string): Promise<(Identity & { csrfHash: string }) | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(session)) return null
  const result = await pool.query<{ user_id: string; workspace_id: string; role: Role; email: string; display_name: string; csrf_hash: string }>(`
    SELECT u.id AS user_id,m.workspace_id,m.role,u.email,u.display_name,s.csrf_hash
    FROM seller_audit_local.user_sessions s
    JOIN seller_audit_local.app_users u ON u.id=s.user_id AND u.status='ACTIVE'
    JOIN seller_audit_local.workspace_members m ON m.user_id=u.id AND m.status='ACTIVE'
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
    ORDER BY m.workspace_id LIMIT 2`, [tokenHash(session)])
  if (result.rows.length !== 1) return null
  const row = result.rows[0]
  return { userId: row.user_id, workspaceId: row.workspace_id, role: row.role, email: row.email, displayName: row.display_name, csrfHash: row.csrf_hash }
}

export async function logout(pool: Pool, session: string): Promise<void> {
  await pool.query('UPDATE seller_audit_local.user_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash(session)])
}

export async function changePassword(pool: Pool, actor: Identity, currentPassword: string, nextPassword: string): Promise<void> {
  const hash=await hashPassword(nextPassword)
  await transaction(pool, async client => {
    const user=await client.query<{password_hash:string|null;status:string}>('SELECT password_hash,status FROM seller_audit_local.app_users WHERE id=$1 FOR UPDATE',[actor.userId])
    if (user.rowCount!==1 || user.rows[0].status!=='ACTIVE' || !user.rows[0].password_hash || !(await verifyPassword(user.rows[0].password_hash,currentPassword))) throw new Error('Invalid password')
    await client.query('UPDATE seller_audit_local.app_users SET password_hash=$2,password_changed_at=now(),updated_at=now() WHERE id=$1',[actor.userId,hash])
    await client.query('UPDATE seller_audit_local.user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[actor.userId])
    await client.query('UPDATE seller_audit_local.setup_tokens SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[actor.userId])
    await logActivity(client,actor,'PASSWORD_CHANGED',actor.userId)
  })
}

export function validCsrf(identity: { csrfHash: string }, supplied: string): boolean {
  return /^[a-f0-9]{64}$/.test(supplied) && tokenMatches(supplied, identity.csrfHash)
}

async function lockAdmin(client: PoolClient, actor: Identity): Promise<void> {
  await client.query('SELECT id FROM seller_audit_local.workspaces WHERE id=$1 FOR UPDATE', [actor.workspaceId])
  const result = await client.query("SELECT 1 FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role='ADMIN' AND u.status='ACTIVE' FOR UPDATE OF m,u", [actor.workspaceId, actor.userId])
  if (result.rowCount !== 1) throw new Error('Not authorized')
}

async function logActivity(client: PoolClient, actor: Identity, action: string, target: string): Promise<void> {
  await client.query(`INSERT INTO seller_audit_local.activity_logs(workspace_id,actor_user_id,actor_ref,action_type,entity_type,entity_id)
    SELECT workspace_id,user_id,actor_ref,$3,'APP_USER',$4 FROM seller_audit_local.workspace_members WHERE workspace_id=$1 AND user_id=$2`, [actor.workspaceId,actor.userId,action,target])
}

export async function inviteEmployee(pool: Pool, actor: Identity, input: { email: string; displayName: string; role: Role }): Promise<string> {
  const email = normalizeEmail(input.email); const name = input.displayName.trim()
  if (!name || name.length > 100 || !['ADMIN','EDITOR','VIEWER'].includes(input.role)) throw new Error('Invalid employee')
  const token = randomToken()
  return transaction(pool, async client => {
    await lockAdmin(client, actor)
    const user = await client.query<{ id: string }>("INSERT INTO seller_audit_local.app_users(email,display_name,status) VALUES($1,$2,'PENDING') RETURNING id", [email,name])
    await client.query("INSERT INTO seller_audit_local.workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,$3,'INVITED')", [actor.workspaceId,user.rows[0].id,input.role])
    await client.query("INSERT INTO seller_audit_local.setup_tokens(user_id,workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')", [user.rows[0].id,actor.workspaceId,tokenHash(token)])
    await logActivity(client,actor,'USER_CREATED',user.rows[0].id)
    return token
  })
}

export async function createEmployeeWithInitialPassword(pool:Pool,actor:Identity,input:{email:string;displayName:string;role:Role},passwordHash:string):Promise<void>{
  const email=normalizeEmail(input.email),name=input.displayName.trim()
  if(!name||name.length>100||!['ADMIN','EDITOR','VIEWER'].includes(input.role)||!/^\$argon2id\$v=19\$m=19456,p=1,t=2\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/.test(passwordHash))throw new Error('Invalid employee')
  await transaction(pool,async client=>{
    await lockAdmin(client,actor)
    const user=await client.query<{id:string}>("INSERT INTO seller_audit_local.app_users(email,display_name,status,password_hash,password_changed_at) VALUES($1,$2,'ACTIVE',$3,now()) RETURNING id",[email,name,passwordHash])
    await client.query("INSERT INTO seller_audit_local.workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,$3,'ACTIVE')",[actor.workspaceId,user.rows[0].id,input.role])
    await logActivity(client,actor,'USER_CREATED_WITH_INITIAL_PASSWORD',user.rows[0].id)
  })
}

export async function activatePendingWithInitialPassword(pool:Pool,actor:Identity,emailInput:string,password:string):Promise<void>{
  const email=normalizeEmail(emailInput),passwordHash=await hashPassword(password)
  await transaction(pool,async client=>{
    await lockAdmin(client,actor)
    const user=await client.query<{id:string}>(`SELECT u.id FROM seller_audit_local.app_users u JOIN seller_audit_local.workspace_members m ON m.user_id=u.id WHERE u.email=$1 AND u.status='PENDING' AND m.workspace_id=$2 AND m.status='INVITED' FOR UPDATE OF u,m`,[email,actor.workspaceId])
    if(user.rowCount!==1)throw new Error('Pending employee unavailable')
    const id=user.rows[0].id
    const others=await client.query('SELECT 1 FROM seller_audit_local.workspace_members WHERE user_id=$1 AND workspace_id<>$2 LIMIT 1',[id,actor.workspaceId])
    if(others.rowCount)throw new Error('Multi-workspace account management is not supported')
    await client.query("UPDATE seller_audit_local.app_users SET status='ACTIVE',password_hash=$2,password_changed_at=now(),updated_at=now() WHERE id=$1",[id,passwordHash])
    await client.query("UPDATE seller_audit_local.workspace_members SET status='ACTIVE' WHERE workspace_id=$1 AND user_id=$2",[actor.workspaceId,id])
    await client.query('UPDATE seller_audit_local.setup_tokens SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[id])
    await client.query('UPDATE seller_audit_local.user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[id])
    await logActivity(client,actor,'PENDING_USER_INITIAL_PASSWORD_SET',id)
  })
}

export async function activateEmployee(pool: Pool, emailInput: string, token: string, password: string): Promise<void> {
  const email=normalizeEmail(emailInput)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid activation')
  const passwordHash=await hashPassword(password)
  await transaction(pool, async client => {
    const result=await client.query<{ id: string; token_id: string; workspace_id: string }>(`SELECT u.id,t.id AS token_id,t.workspace_id FROM seller_audit_local.app_users u
      JOIN seller_audit_local.setup_tokens t ON t.user_id=u.id WHERE u.email=$1 AND u.status IN ('PENDING','ACTIVE')
      AND t.token_hash=$2 AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() FOR UPDATE OF u,t`,[email,tokenHash(token)])
    if (result.rowCount!==1) throw new Error('Invalid activation')
    const row=result.rows[0]
    await client.query("UPDATE seller_audit_local.app_users SET password_hash=$2,status='ACTIVE',password_changed_at=now(),updated_at=now() WHERE id=$1",[row.id,passwordHash])
    await client.query("UPDATE seller_audit_local.workspace_members SET status='ACTIVE' WHERE user_id=$1 AND workspace_id=$2 AND status='INVITED'",[row.id,row.workspace_id])
    await client.query('UPDATE seller_audit_local.setup_tokens SET consumed_at=now() WHERE id=$1',[row.token_id])
    await client.query('UPDATE seller_audit_local.user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[row.id])
  })
}

export async function listEmployees(pool: Pool, actor: Identity): Promise<Row[]> {
  return transaction(pool, async client => {
    await lockAdmin(client,actor)
    const result=await client.query('SELECT u.id,u.email,u.display_name,u.status,m.role,m.status AS membership_status FROM seller_audit_local.app_users u JOIN seller_audit_local.workspace_members m ON m.user_id=u.id WHERE m.workspace_id=$1 ORDER BY u.email',[actor.workspaceId])
    return result.rows
  })
}

async function lockTarget(client: PoolClient, actor: Identity, targetId: string) {
  const result = await client.query<{ role: Role; status: string; user_status: string }>(`SELECT m.role,m.status,u.status AS user_status
    FROM seller_audit_local.workspace_members m JOIN seller_audit_local.app_users u ON u.id=m.user_id
    WHERE m.workspace_id=$1 AND m.user_id=$2 FOR UPDATE OF m,u`,[actor.workspaceId,targetId])
  if (result.rowCount !== 1) throw new Error('Employee unavailable')
  return result.rows[0]
}

async function protectLastAdmin(client: PoolClient, actor: Identity, target: { role: Role; status: string; user_status: string }): Promise<void> {
  if (target.role !== 'ADMIN' || target.status !== 'ACTIVE' || target.user_status !== 'ACTIVE') return
  const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM seller_audit_local.workspace_members m
    JOIN seller_audit_local.app_users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.role='ADMIN' AND m.status='ACTIVE' AND u.status='ACTIVE'`,[actor.workspaceId])
  if (Number(result.rows[0].count) <= 1) throw new Error('Cannot remove last active administrator')
}

export async function changeEmployeeRole(pool: Pool, actor: Identity, targetId: string, role: Role): Promise<void> {
  if (!['ADMIN','EDITOR','VIEWER'].includes(role)) throw new Error('Invalid role')
  await transaction(pool, async client => {
    await lockAdmin(client,actor)
    const target=await lockTarget(client,actor,targetId)
    if (role !== 'ADMIN') await protectLastAdmin(client,actor,target)
    await client.query('UPDATE seller_audit_local.workspace_members SET role=$3 WHERE workspace_id=$1 AND user_id=$2',[actor.workspaceId,targetId,role])
    await logActivity(client,actor,'USER_ROLE_CHANGED',targetId)
  })
}

export async function disableEmployee(pool: Pool, actor: Identity, targetId: string): Promise<void> {
  await transaction(pool, async client => {
    await lockAdmin(client,actor)
    const target=await lockTarget(client,actor,targetId)
    await protectLastAdmin(client,actor,target)
    const others=await client.query('SELECT 1 FROM seller_audit_local.workspace_members WHERE user_id=$1 AND workspace_id<>$2 LIMIT 1',[targetId,actor.workspaceId])
    if (others.rowCount) throw new Error('Multi-workspace account management is not supported')
    await client.query("UPDATE seller_audit_local.workspace_members SET status='DISABLED' WHERE workspace_id=$1 AND user_id=$2",[actor.workspaceId,targetId])
    await client.query("UPDATE seller_audit_local.app_users SET status='DISABLED',updated_at=now() WHERE id=$1",[targetId])
    await client.query('UPDATE seller_audit_local.user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[targetId])
    await client.query('UPDATE seller_audit_local.setup_tokens SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[targetId])
    await logActivity(client,actor,'USER_DISABLED',targetId)
  })
}

export async function resetEmployeePassword(pool: Pool, actor: Identity, targetId: string): Promise<string> {
  const token=randomToken()
  return transaction(pool, async client => {
    await lockAdmin(client,actor)
    const target=await lockTarget(client,actor,targetId)
    if (target.user_status==='DISABLED' || target.status==='DISABLED') throw new Error('Employee unavailable')
    await protectLastAdmin(client,actor,target)
    const others=await client.query('SELECT 1 FROM seller_audit_local.workspace_members WHERE user_id=$1 AND workspace_id<>$2 LIMIT 1',[targetId,actor.workspaceId])
    if (others.rowCount) throw new Error('Multi-workspace account management is not supported')
    await client.query('UPDATE seller_audit_local.setup_tokens SET revoked_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[targetId])
    await client.query('UPDATE seller_audit_local.user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[targetId])
    await client.query("UPDATE seller_audit_local.app_users SET status='PENDING',password_hash=NULL,updated_at=now() WHERE id=$1",[targetId])
    await client.query("INSERT INTO seller_audit_local.setup_tokens(user_id,workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')",[targetId,actor.workspaceId,tokenHash(token)])
    await logActivity(client,actor,'PASSWORD_RESET_ISSUED',targetId)
    return token
  })
}
