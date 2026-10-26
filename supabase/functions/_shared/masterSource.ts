import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

export const BUCKET = 'seller-audit-import-sources'
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export class RequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function authorizedSource(req: Request) {
  if (req.method !== 'POST') throw new RequestError(405, 'Method not allowed')
  const authorization = req.headers.get('Authorization') ?? ''
  const match = authorization.match(/^Bearer (\S+)$/i)
  if (!match) throw new RequestError(401, 'Authentication required')
  let sourceFileId: unknown
  try { ({ sourceFileId } = await req.json()) } catch { throw new RequestError(400, 'Invalid request') }
  if (typeof sourceFileId !== 'string' || !uuid.test(sourceFileId)) {
    throw new RequestError(400, 'Invalid source file ID')
  }
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new RequestError(500, 'Server configuration unavailable')
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: authError } = await admin.auth.getUser(match[1])
  const actorId = userData.user?.id
  if (authError || !actorId) throw new RequestError(401, 'Authentication required')
  const { data: source, error: sourceError } = await admin.from('import_source_files')
    .select('id,workspace_id,source_type,storage_bucket,storage_object_path,verification_status,client_observed_byte_size,client_observed_sha256,server_verified_sha256,server_verified_byte_size')
    .eq('id', sourceFileId).maybeSingle()
  if (sourceError) throw new RequestError(500, 'Source lookup failed')
  if (!source || source.source_type !== 'MASTER_WORKBOOK' || source.storage_bucket !== BUCKET) {
    throw new RequestError(404, 'Source file unavailable')
  }
  const { data: membership, error: memberError } = await admin.from('workspace_members')
    .select('role,status').eq('workspace_id', source.workspace_id).eq('user_id', actorId).maybeSingle()
  if (memberError) throw new RequestError(500, 'Membership lookup failed')
  if (!membership || membership.status !== 'ACTIVE' || !['ADMIN', 'EDITOR'].includes(membership.role)) {
    throw new RequestError(404, 'Source file unavailable')
  }
  return { admin, actorId, source }
}

export function handleError(error: unknown): Response {
  if (error instanceof RequestError) return response({ error: error.message }, error.status)
  return response({ error: 'Source operation failed' }, 500)
}
