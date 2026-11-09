import { expect, test } from '@playwright/test'
import { createApp } from '../../server/app'
import { localDatabaseUrl } from '../../server/config'
import { resolveDataSourceConfig } from '../../src/lib/dataSourceConfig'

test('local mode never silently selects mock or Supabase', () => {
  expect(resolveDataSourceConfig({ VITE_DATA_SOURCE: 'local-server' })).toEqual({ mode: 'local-server' })
})

test('database settings only permit the dedicated loopback database', () => {
  const good = 'postgresql://localuser:pass@127.0.0.1:5432/selleraudit_local'
  expect(localDatabaseUrl({ SELLERAUDIT_LOCAL_DATABASE_URL: good })).toBe(good)
  for (const bad of [
    'postgresql://u:p@remote.example:5432/selleraudit_local',
    'postgresql://u:p@localhost:5432/selleraudit_local',
    'postgresql://u:p@127.0.0.1:5432/postgres',
    'postgresql://u:p@127.0.0.1:5432/selleraudit_local?host=remote.example',
  ]) expect(() => localDatabaseUrl({ SELLERAUDIT_LOCAL_DATABASE_URL: bad })).toThrow()
})

test('health reports unavailable without exposing database errors', async () => {
  const app = createApp(async () => { throw new Error('private database error') })
  try {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'unavailable' })
    expect(response.body).not.toContain('private database error')
    expect((await app.inject({ method: 'POST', url: '/api/import/apply' })).statusCode).toBe(404)
  } finally { await app.close() }
})

test('health succeeds when the database responds', async () => {
  const app = createApp(async () => {})
  try {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  } finally { await app.close() }
})
