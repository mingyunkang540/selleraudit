export function localDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.SELLERAUDIT_LOCAL_DATABASE_URL
  if (!raw) throw new Error('SELLERAUDIT_LOCAL_DATABASE_URL is required')
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Invalid local database URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/selleraudit_local' || !url.username || url.search || url.hash) {
    throw new Error('Database must be selleraudit_local on 127.0.0.1 without URL options')
  }
  return raw
}
