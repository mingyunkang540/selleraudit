import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { ConfigurationError, resolveDataSourceConfig } from './dataSourceConfig'

export { ConfigurationError, resolveDataSourceConfig } from './dataSourceConfig'
export type { DataSourceMode } from './dataSourceConfig'

export function getDataSourceConfig() {
  return resolveDataSourceConfig(import.meta.env ?? {})
}

let client: SupabaseClient | null = null
export function getSupabaseClient(): SupabaseClient {
  const dataSourceConfig = getDataSourceConfig()
  if (dataSourceConfig.mode !== 'supabase') throw new ConfigurationError('Supabase 모드가 아닙니다.')
  if (!client) client = createClient(dataSourceConfig.url, dataSourceConfig.publishableKey)
  return client
}
