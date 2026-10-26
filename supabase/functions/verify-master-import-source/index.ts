import { authorizedSource, BUCKET, CORS, handleError, RequestError, response } from '../_shared/masterSource.ts'

const SHA256 = /^[0-9a-f]{64}$/

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const { admin, actorId, source } = await authorizedSource(req)
    if (source.verification_status === 'VERIFIED') {
      return response({ status: 'VERIFIED', sourceFileId: source.id,
        serverSha256: source.server_verified_sha256, serverByteSize: source.server_verified_byte_size })
    }
    if (source.verification_status === 'HASH_MISMATCH') {
      throw new RequestError(409, 'Hash mismatch requires a new source file')
    }
    let size: number | null = null
    let hash: string | null = null
    let objectId: string | null = null
    let errorCode: string | null = null
    const storage = admin.storage.from(BUCKET)
    const { data: info, error: infoError } = await storage.info(source.storage_object_path)
    if (infoError || !info) {
      errorCode = 'OBJECT_MISSING'
    } else {
      objectId = info.id
      const { data: blob, error: downloadError } = await storage.download(source.storage_object_path)
      if (downloadError || !blob) {
        errorCode = 'DOWNLOAD_FAILED'
      } else {
        const bytes = await blob.arrayBuffer()
        size = bytes.byteLength
        if (size === 0 || size > 52428800) errorCode = 'INVALID_OBJECT'
        else {
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
          if (!SHA256.test(hash)) errorCode = 'INVALID_OBJECT'
        }
      }
    }
    const { data: status, error: finalizeError } = await admin.rpc('finalize_master_import_source_verification', {
      p_source_file_id: source.id,
      p_actor_user_id: actorId,
      p_server_verified_byte_size: size,
      p_server_verified_sha256: hash,
      p_storage_object_id: objectId,
      p_error_code: errorCode,
    })
    if (finalizeError) throw new RequestError(500, 'Verification finalization failed')
    return response({ status, sourceFileId: source.id, serverSha256: hash, serverByteSize: size })
  } catch (error) { return handleError(error) }
})
