import pg from 'pg'
import { localDatabaseUrl } from './config.ts'

export function createPool() {
  return new pg.Pool({ connectionString: localDatabaseUrl(), max: 4, connectionTimeoutMillis: 3000 })
}
