export type DataSourceMode = 'mock' | 'supabase'

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

function isPrivilegedKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const payload = key.split('.')[1]
  if (!payload) return false
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims: unknown = JSON.parse(atob(normalized))
    return typeof claims === 'object' && claims !== null && 'role' in claims && claims.role === 'service_role'
  } catch { return false }
}

export function resolveDataSourceConfig(env: Record<string, string | undefined>):
  | { mode: 'mock' }
  | { mode: 'supabase'; url: string; publishableKey: string } {
  if (Object.entries(env).some(([name, value]) => value && name.startsWith('VITE_') && /(SERVICE_ROLE|SECRET|DB_PASSWORD|JWT_SECRET|AUTH_ADMIN)/i.test(name))) {
    throw new ConfigurationError('비공개 키를 VITE_ 환경변수로 제공할 수 없습니다.')
  }
  const mode = env.VITE_DATA_SOURCE || 'mock'
  if (mode === 'mock') return { mode }
  if (mode !== 'supabase') throw new ConfigurationError('알 수 없는 데이터 소스 설정입니다. VITE_DATA_SOURCE를 확인해 주세요.')

  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !publishableKey) {
    throw new ConfigurationError('Supabase 개발 환경 설정이 필요합니다. .env.example의 URL과 publishable key를 확인해 주세요.')
  }
  let parsed: URL
  try { parsed = new URL(url) }
  catch { throw new ConfigurationError('Supabase URL 형식이 올바르지 않습니다.') }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) {
    throw new ConfigurationError('Supabase URL은 HTTPS 또는 로컬 개발 주소여야 합니다.')
  }
  if (isPrivilegedKey(publishableKey)) {
    throw new ConfigurationError('브라우저에는 Supabase secret key를 사용할 수 없습니다.')
  }
  return { mode, url: parsed.toString().replace(/\/$/, ''), publishableKey }
}
