import { authorizedSource, BUCKET, CORS, handleError, RequestError, response } from '../_shared/masterSource.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const { admin, source } = await authorizedSource(req)
    if (source.verification_status !== 'VERIFIED') {
      throw new RequestError(409, 'Verified source file required')
    }
    const { data, error } = await admin.storage.from(BUCKET)
      .createSignedUrl(source.storage_object_path, 60, { download: true })
    if (error || !data?.signedUrl) throw new RequestError(500, 'Download URL unavailable')
    return response({ url: data.signedUrl, expiresIn: 60 })
  } catch (error) { return handleError(error) }
})
