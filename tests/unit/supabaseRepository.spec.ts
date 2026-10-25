import { expect, test } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseRepository, SupabaseRepositoryError } from '../../src/services/supabaseRepository'

type QueryResult = { data: unknown; error: unknown }
type DataRow = Record<string, unknown>

const workspaceId = 'workspace-a'
const otherWorkspaceId = 'workspace-b'
const now = '2026-10-25T00:00:00.000Z'

function fixture(): Record<string, DataRow[]> {
  return {
    workspaces: [{ id: workspaceId, name: 'SellerAudit', created_at: now, updated_at: now }],
    products: [{
      id: 'product-a', workspace_id: workspaceId, sabangnet_code: '100051', product_name: '점보', category: null,
      product_type: 'SINGLE', normal_price: '13300.25', status: 'ACTIVE', created_at: now, updated_at: now,
    }],
    skus: [{
      id: 'sku-a', workspace_id: workspaceId, sku_code: 'AL00', model_name: '쿨라벤더', color: 'Lavender',
      status: 'ACTIVE', created_at: now, updated_at: now,
    }],
    product_components: [{
      id: 'component-a', workspace_id: workspaceId, product_id: 'product-a', sku_id: 'sku-a', quantity: '2', created_at: now,
    }],
    channels: [{
      id: 'channel-a', workspace_id: workspaceId, channel_code: 'NAVER', channel_name: '네이버', status: 'ACTIVE', created_at: now,
    }],
    channel_listings: [{
      id: 'listing-a', workspace_id: workspaceId, channel_id: 'channel-a', channel_product_id: 'N-1', product_name: '점보',
      status: 'ACTIVE', product_url: null, last_synced_at: null, created_at: now, updated_at: now,
    }],
    channel_offers: [{
      id: 'offer-a', workspace_id: workspaceId, listing_id: 'listing-a', channel_option_id: 'BASE', option_name: null,
      seller_code: 'SELLER-1', normal_price: '14900', sale_price: 13300, status: 'ACTIVE', master_product_id: null,
      created_at: now, updated_at: now,
    }],
    aliases: [{
      id: 'alias-a', workspace_id: workspaceId, raw_product_name: '기존 별칭', raw_option_name: null,
      source_channel: 'NAVER', master_product_id: 'product-a', created_at: now,
    }],
    audit_issues: [{
      id: 'issue-a', workspace_id: workspaceId, issue_type: 'UNMATCHED', severity: 'WARNING', product_id: null,
      channel_id: 'channel-a', listing_id: 'listing-a', offer_id: 'offer-a', title: '미매핑', description: '', status: 'OPEN',
      detected_at: now, resolved_at: null,
    }],
  }
}

class FakeQuery implements PromiseLike<QueryResult> {
  readonly filters = new Map<string, unknown>()
  selected = ''
  maximum: number | null = null
  orderField: string | null = null
  ascending = true
  rangeStart: number | null = null
  rangeEnd: number | null = null

  constructor(
    readonly table: string,
    private readonly client: FakeSupabase,
  ) {}

  select(columns: string): this {
    this.selected = columns
    return this
  }

  eq(field: string, value: unknown): this {
    this.filters.set(field, value)
    return this
  }

  limit(maximum: number): this {
    this.maximum = maximum
    return this
  }

  order(field: string, options: { ascending: boolean }): this {
    this.orderField = field
    this.ascending = options.ascending
    return this
  }

  range(start: number, end: number): this {
    this.rangeStart = start
    this.rangeEnd = end
    return this
  }

  private execute(): QueryResult {
    const error = this.client.errors.get(this.table)
    if (error) return { data: null, error }
    let data = (this.client.data[this.table] ?? []).filter((row) =>
      [...this.filters].every(([field, value]) => row[field] === value),
    )
    if (this.orderField !== null) {
      const field = this.orderField
      data = [...data].sort((left, right) => {
        const comparison = String(left[field]).localeCompare(String(right[field]))
        return this.ascending ? comparison : -comparison
      })
    }
    if (this.rangeStart !== null && this.rangeEnd !== null) data = data.slice(this.rangeStart, this.rangeEnd + 1)
    if (this.maximum !== null) data = data.slice(0, this.maximum)
    const selectedFields = this.selected.split(',').map((field) => field.trim()).filter(Boolean)
    if (selectedFields.length > 0) {
      data = data.map((row) => Object.fromEntries(selectedFields.map((field) => [field, row[field]])))
    }
    return { data: structuredClone(data), error: null }
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  readonly queries: FakeQuery[] = []
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  readonly errors = new Map<string, unknown>()

  constructor(readonly data: Record<string, DataRow[]>) {}

  from(table: string): FakeQuery {
    const query = new FakeQuery(table, this)
    this.queries.push(query)
    return query
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<QueryResult> {
    this.rpcCalls.push({ name, args })
    const error = this.errors.get(`rpc:${name}`)
    if (error) return { data: null, error }
    if (name === 'map_offer') {
      const offer = this.data.channel_offers.find((row) => row.id === args.p_offer_id)
      if (offer) offer.master_product_id = args.p_master_product_id
      const issue = this.data.audit_issues.find((row) => row.offer_id === args.p_offer_id)
      if (issue) {
        issue.status = 'RESOLVED'
        issue.resolved_at = now
      }
    }
    if (name === 'update_issue_status') {
      const issue = this.data.audit_issues.find((row) => row.id === args.p_issue_id)
      if (issue) {
        issue.status = args.p_status
        issue.resolved_at = args.p_status === 'RESOLVED' ? now : null
      }
    }
    return { data: {}, error: null }
  }
}

function repository(client: FakeSupabase) {
  return createSupabaseRepository({
    supabase: client as unknown as Pick<SupabaseClient, 'from' | 'rpc'>,
    workspaceId,
  })
}

test('loads all business tables in one batch and maps snake_case and numeric values', async () => {
  const client = new FakeSupabase(fixture())
  const data = await repository(client).load()

  expect(data.workspace).toEqual({ id: workspaceId, name: 'SellerAudit', createdAt: now, updatedAt: now })
  expect(data.products[0]).toEqual(expect.objectContaining({ workspaceId, sabangnetCode: '100051', normalPrice: 13300.25 }))
  expect(data.components[0].quantity).toBe(2)
  expect(data.offers[0]).toEqual(expect.objectContaining({ listingId: 'listing-a', salePrice: 13300 }))
  expect(data.issues[0].channelId).toBe('channel-a')
  expect(client.queries).toHaveLength(9)
  expect(client.queries.find((query) => query.table === 'workspaces')?.filters.get('id')).toBe(workspaceId)
  for (const query of client.queries.filter((item) => item.table !== 'workspaces')) {
    expect(query.filters.get('workspace_id')).toBe(workspaceId)
  }
})

test('preserves channel context for an issue without a listing', async () => {
  const data = fixture()
  data.audit_issues[0] = {
    ...data.audit_issues[0], issue_type: 'MISSING_CHANNEL', product_id: 'product-a', channel_id: 'channel-a',
    listing_id: null, offer_id: null, title: '채널 미등록',
  }

  const loaded = await repository(new FakeSupabase(data)).load()

  expect(loaded.issues[0]).toEqual(expect.objectContaining({ channelId: 'channel-a', listingId: null, offerId: null }))
})

test('paginates large table reads with a stable id order instead of accepting a truncated response', async () => {
  const data = fixture()
  const baseProduct = data.products[0]
  data.products = Array.from({ length: 501 }, (_, index) => ({
    ...baseProduct, id: `product-${String(index).padStart(4, '0')}`, sabangnet_code: `P-${index}`,
  }))
  data.product_components = []
  data.channel_offers[0].master_product_id = null
  data.aliases = []

  const client = new FakeSupabase(data)
  const loaded = await repository(client).load()

  expect(loaded.products).toHaveLength(501)
  const productQueries = client.queries.filter((query) => query.table === 'products')
  expect(productQueries).toHaveLength(2)
  expect(productQueries.map((query) => [query.orderField, query.rangeStart, query.rangeEnd])).toEqual([
    ['id', 0, 499],
    ['id', 500, 999],
  ])
})

test('treats an empty selected workspace as a valid business state', async () => {
  const data = fixture()
  for (const table of Object.keys(data).filter((table) => table !== 'workspaces')) data[table] = []

  const loaded = await repository(new FakeSupabase(data)).load()

  expect(loaded.workspace.id).toBe(workspaceId)
  expect(loaded.products).toEqual([])
  expect(loaded.skus).toEqual([])
  expect(loaded.components).toEqual([])
  expect(loaded.channels).toEqual([])
  expect(loaded.listings).toEqual([])
  expect(loaded.offers).toEqual([])
  expect(loaded.aliases).toEqual([])
  expect(loaded.issues).toEqual([])
})

test('rejects unsafe numeric values and normalizes backend errors', async () => {
  const invalidClient = new FakeSupabase(fixture())
  invalidClient.data.products[0].normal_price = '9007199254740992'
  await expect(repository(invalidClient).load()).rejects.toThrow('SellerAudit 데이터를 불러오지 못했습니다.')

  const failingClient = new FakeSupabase(fixture())
  failingClient.errors.set('products', { code: '42501', message: 'sensitive database detail' })
  const failure = await repository(failingClient).load().catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(SupabaseRepositoryError)
  expect((failure as Error).message).toBe('SellerAudit 데이터를 불러오지 못했습니다.')
  expect((failure as Error).message).not.toContain('sensitive')
})

test('mapOffer verifies both targets in the selected workspace, calls RPC, and refetches server state', async () => {
  const client = new FakeSupabase(fixture())
  const data = await repository(client).mapOffer('offer-a', 'product-a')

  expect(client.rpcCalls).toEqual([{ name: 'map_offer', args: { p_offer_id: 'offer-a', p_master_product_id: 'product-a' } }])
  expect(data.offers[0].masterProductId).toBe('product-a')
  expect(data.issues[0]).toEqual(expect.objectContaining({ status: 'RESOLVED', resolvedAt: now }))
  const guardQueries = client.queries.slice(0, 2)
  expect(guardQueries.map((query) => [query.table, Object.fromEntries(query.filters)])).toEqual([
    ['channel_offers', { workspace_id: workspaceId, id: 'offer-a' }],
    ['products', { workspace_id: workspaceId, id: 'product-a' }],
  ])
  expect(client.queries).toHaveLength(11)
})

test('workspace isolation blocks cross-workspace targets before RPC', async () => {
  const data = fixture()
  data.channel_offers[0].workspace_id = otherWorkspaceId
  const client = new FakeSupabase(data)

  await expect(repository(client).mapOffer('offer-a', 'product-a')).rejects.toThrow('선택한 workspace')
  expect(client.rpcCalls).toEqual([])
})

test('updateIssueStatus verifies ownership, calls RPC, and returns refetched state', async () => {
  const client = new FakeSupabase(fixture())
  const data = await repository(client).updateIssueStatus('issue-a', 'IN_PROGRESS')

  expect(client.rpcCalls).toEqual([{ name: 'update_issue_status', args: { p_issue_id: 'issue-a', p_status: 'IN_PROGRESS' } }])
  expect(data.issues[0]).toEqual(expect.objectContaining({ status: 'IN_PROGRESS', resolvedAt: null }))
  expect(client.queries[0].table).toBe('audit_issues')
  expect(Object.fromEntries(client.queries[0].filters)).toEqual({ workspace_id: workspaceId, id: 'issue-a' })
  expect(client.queries).toHaveLength(10)
})
