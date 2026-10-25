import { expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveDataSourceConfig } from '../../src/lib/dataSourceConfig'
import { canWrite, loadActiveWorkspaces } from '../../src/services/auth'

type Row = Record<string, unknown>
type QueryResult = { data: Row[] | null; error: unknown }

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly equals = new Map<string, unknown>()
  private included: { field: string; values: unknown[] } | null = null

  constructor(private readonly rows: Row[], private readonly error: unknown = null) {}

  select(): this { return this }
  eq(field: string, value: unknown): this { this.equals.set(field, value); return this }
  in(field: string, values: unknown[]): this { this.included = { field, values }; return this }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const data = this.error ? null : this.rows.filter(row =>
      [...this.equals].every(([field, value]) => row[field] === value) &&
      (!this.included || this.included.values.includes(row[this.included.field])),
    )
    return Promise.resolve({ data, error: this.error }).then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly errors: Record<string, unknown> = {},
  ) {}

  from(table: string): FakeQuery {
    return new FakeQuery(this.tables[table] ?? [], this.errors[table] ?? null)
  }
}

function client(tables: Record<string, Row[]>, errors?: Record<string, unknown>) {
  return new FakeSupabase(tables, errors) as unknown as SupabaseClient
}

function legacyJwt(role: string): string {
  return ['header', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'signature'].join('.')
}

test('uses mock mode when data source configuration is absent', () => {
  expect(resolveDataSourceConfig({})).toEqual({ mode: 'mock' })
})

test('rejects Supabase mode when development credentials are missing', () => {
  expect(() => resolveDataSourceConfig({ VITE_DATA_SOURCE: 'supabase' }))
    .toThrow('Supabase 개발 환경 설정이 필요합니다.')
})

test('rejects an sb_secret key from browser configuration', () => {
  expect(() => resolveDataSourceConfig({
    VITE_DATA_SOURCE: 'supabase',
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_server-only',
  })).toThrow('secret key')
})

test('rejects a legacy service_role JWT from browser configuration', () => {
  expect(() => resolveDataSourceConfig({
    VITE_DATA_SOURCE: 'supabase',
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: legacyJwt('service_role'),
  })).toThrow('secret key')
})

test('returns only active memberships with their assigned roles', async () => {
  const workspaces = await loadActiveWorkspaces(client({
    workspace_members: [
      { workspace_id: 'workspace-editor', role: 'EDITOR', status: 'ACTIVE', user_id: 'user-a' },
      { workspace_id: 'workspace-disabled', role: 'ADMIN', status: 'DISABLED', user_id: 'user-a' },
      { workspace_id: 'workspace-viewer', role: 'VIEWER', status: 'ACTIVE', user_id: 'user-a' },
      { workspace_id: 'workspace-other-user', role: 'ADMIN', status: 'ACTIVE', user_id: 'user-b' },
    ],
    workspaces: [
      { id: 'workspace-editor', name: '편집 워크스페이스' },
      { id: 'workspace-viewer', name: '조회 워크스페이스' },
    ],
  }), 'user-a')

  expect(workspaces).toEqual([
    { id: 'workspace-viewer', name: '조회 워크스페이스', role: 'VIEWER' },
    { id: 'workspace-editor', name: '편집 워크스페이스', role: 'EDITOR' },
  ])
})

test('returns no workspaces when the user has no active membership', async () => {
  const workspaces = await loadActiveWorkspaces(client({ workspace_members: [], workspaces: [] }), 'user-a')
  expect(workspaces).toEqual([])
})

test('allows writes only for ADMIN and EDITOR roles', () => {
  expect([canWrite('ADMIN'), canWrite('EDITOR'), canWrite('VIEWER'), canWrite(null)])
    .toEqual([true, true, false, false])
})
