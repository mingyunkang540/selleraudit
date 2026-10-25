import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Alias,
  AuditIssue,
  Channel,
  ChannelListing,
  ChannelOffer,
  EntityStatus,
  IssueStatus,
  IssueType,
  Product,
  ProductComponent,
  SellerData,
  Severity,
  Sku,
  Workspace,
} from '../types/domain'
import { asChannelCode } from '../types/domain'
import type { SellerRepository } from './repository'

type SupabaseRepositoryClient = Pick<SupabaseClient, 'from' | 'rpc'>
type Row = Record<string, unknown>
type QueryResult = { data: unknown; error: unknown }
const PAGE_SIZE = 500

const entityStatuses = new Set<EntityStatus>(['ACTIVE', 'INACTIVE', 'DRAFT'])
const issueStatuses = new Set<IssueStatus>(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED'])
const productTypes = new Set<Product['productType']>(['SINGLE', 'SET'])
const issueTypes = new Set<IssueType>([
  'UNMATCHED', 'PRICE_MISMATCH', 'MISSING_CHANNEL', 'INACTIVE_MISMATCH',
  'DUPLICATE', 'NEW_LISTING', 'CHANGED_LISTING', 'MISSING_BOM',
])
const severities = new Set<Severity>(['INFO', 'WARNING', 'ERROR'])

export class SupabaseRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SupabaseRepositoryError'
  }
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(row: Row, field: string): string {
  const value = row[field]
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-blank string`)
  return value
}

function stringValue(row: Row, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function nullableString(row: Row, field: string): string | null {
  const value = row[field]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null`)
  return value
}

function timestamp(row: Row, field: string): string {
  const value = requiredString(row, field)
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${field} must be a timestamp`)
  return value
}

function nullableTimestamp(row: Row, field: string): string | null {
  if (row[field] === null) return null
  return timestamp(row, field)
}

function enumValue<T extends string>(row: Row, field: string, values: ReadonlySet<T>): T {
  const value = requiredString(row, field)
  if (!values.has(value as T)) throw new Error(`${field} has an unsupported value`)
  return value as T
}

function nullableNumber(row: Row, field: string): number | null {
  const value = row[field]
  if (value === null) return null
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`${field} must be numeric or null`)
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${field} is outside the supported numeric range`)
  }
  return parsed
}

function positiveInteger(row: Row, field: string): number {
  const parsed = nullableNumber(row, field)
  if (parsed === null || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return parsed
}

function workspaceId(row: Row, selectedWorkspaceId: string): string {
  const value = requiredString(row, 'workspace_id')
  if (value !== selectedWorkspaceId) throw new Error('row does not belong to the selected workspace')
  return value
}

function rows(result: QueryResult, table: string): Row[] {
  if (result.error) throw result.error
  if (!Array.isArray(result.data) || !result.data.every(isRow)) throw new Error(`${table} returned an invalid response`)
  return result.data
}

function normalizeError(error: unknown, message: string): SupabaseRepositoryError {
  if (error instanceof SupabaseRepositoryError) return error
  return new SupabaseRepositoryError(message, { cause: error })
}

function mapWorkspace(row: Row, selectedWorkspaceId: string): Workspace {
  const id = requiredString(row, 'id')
  if (id !== selectedWorkspaceId) throw new Error('workspace response does not match the selected workspace')
  return { id, name: requiredString(row, 'name'), createdAt: timestamp(row, 'created_at'), updatedAt: timestamp(row, 'updated_at') }
}

function mapProduct(row: Row, selectedWorkspaceId: string): Product {
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId),
    sabangnetCode: requiredString(row, 'sabangnet_code'), productName: requiredString(row, 'product_name'),
    category: nullableString(row, 'category'), productType: enumValue(row, 'product_type', productTypes),
    normalPrice: nullableNumber(row, 'normal_price'), status: enumValue(row, 'status', entityStatuses),
    createdAt: timestamp(row, 'created_at'), updatedAt: timestamp(row, 'updated_at'),
  }
}

function mapSku(row: Row, selectedWorkspaceId: string): Sku {
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId), skuCode: requiredString(row, 'sku_code'),
    modelName: requiredString(row, 'model_name'), color: nullableString(row, 'color'), status: enumValue(row, 'status', entityStatuses),
    createdAt: timestamp(row, 'created_at'), updatedAt: timestamp(row, 'updated_at'),
  }
}

function mapComponent(row: Row, selectedWorkspaceId: string): ProductComponent {
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId), productId: requiredString(row, 'product_id'),
    skuId: requiredString(row, 'sku_id'), quantity: positiveInteger(row, 'quantity'), createdAt: timestamp(row, 'created_at'),
  }
}

function mapChannel(row: Row, selectedWorkspaceId: string): Channel {
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId),
    channelCode: asChannelCode(requiredString(row, 'channel_code')), channelName: requiredString(row, 'channel_name'),
    status: enumValue(row, 'status', entityStatuses), createdAt: timestamp(row, 'created_at'),
  }
}

function mapListing(row: Row, selectedWorkspaceId: string): ChannelListing {
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId), channelId: requiredString(row, 'channel_id'),
    channelProductId: requiredString(row, 'channel_product_id'), productName: requiredString(row, 'product_name'),
    status: enumValue(row, 'status', entityStatuses), productUrl: nullableString(row, 'product_url'),
    lastSyncedAt: nullableTimestamp(row, 'last_synced_at'), createdAt: timestamp(row, 'created_at'), updatedAt: timestamp(row, 'updated_at'),
  }
}

function mapOffer(row: Row, selectedWorkspaceId: string): ChannelOffer {
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId), listingId: requiredString(row, 'listing_id'),
    channelOptionId: requiredString(row, 'channel_option_id'), optionName: nullableString(row, 'option_name'),
    sellerCode: nullableString(row, 'seller_code'), normalPrice: nullableNumber(row, 'normal_price'),
    salePrice: nullableNumber(row, 'sale_price'), status: enumValue(row, 'status', entityStatuses),
    masterProductId: nullableString(row, 'master_product_id'), createdAt: timestamp(row, 'created_at'), updatedAt: timestamp(row, 'updated_at'),
  }
}

function mapAlias(row: Row, selectedWorkspaceId: string): Alias {
  const sourceChannel = nullableString(row, 'source_channel')
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId),
    rawProductName: stringValue(row, 'raw_product_name'), rawOptionName: nullableString(row, 'raw_option_name'),
    sourceChannel: sourceChannel === null ? null : asChannelCode(sourceChannel),
    masterProductId: requiredString(row, 'master_product_id'), createdAt: timestamp(row, 'created_at'),
  }
}

function mapIssue(row: Row, selectedWorkspaceId: string, listingChannels: ReadonlyMap<string, string>): AuditIssue {
  const listingId = nullableString(row, 'listing_id')
  const storedChannelId = nullableString(row, 'channel_id')
  return {
    id: requiredString(row, 'id'), workspaceId: workspaceId(row, selectedWorkspaceId),
    issueType: enumValue(row, 'issue_type', issueTypes), severity: enumValue(row, 'severity', severities),
    productId: nullableString(row, 'product_id'),
    channelId: storedChannelId ?? (listingId === null ? null : listingChannels.get(listingId) ?? null),
    listingId, offerId: nullableString(row, 'offer_id'), title: requiredString(row, 'title'),
    description: stringValue(row, 'description'),
    status: enumValue(row, 'status', issueStatuses), detectedAt: timestamp(row, 'detected_at'), resolvedAt: nullableTimestamp(row, 'resolved_at'),
  }
}

function validateReferences(data: SellerData): SellerData {
  const productIds = new Set(data.products.map((item) => item.id))
  const skuIds = new Set(data.skus.map((item) => item.id))
  const channelIds = new Set(data.channels.map((item) => item.id))
  const listingIds = new Set(data.listings.map((item) => item.id))
  const offerIds = new Set(data.offers.map((item) => item.id))
  const listingById = new Map(data.listings.map((item) => [item.id, item]))
  const offerById = new Map(data.offers.map((item) => [item.id, item]))
  const channelCodes = new Set(data.channels.map((item) => item.channelCode))
  const collections = [data.products, data.skus, data.components, data.channels, data.listings, data.offers, data.aliases, data.issues]
  if (collections.some((items) => new Set(items.map((item) => item.id)).size !== items.length) ||
    data.components.some((item) => !productIds.has(item.productId) || !skuIds.has(item.skuId)) ||
    data.listings.some((item) => !channelIds.has(item.channelId)) ||
    data.offers.some((item) => !listingIds.has(item.listingId) || (item.masterProductId !== null && !productIds.has(item.masterProductId))) ||
    data.aliases.some((item) => !productIds.has(item.masterProductId) ||
      (item.sourceChannel !== null && !channelCodes.has(item.sourceChannel))) ||
    data.issues.some((item) => (item.productId !== null && !productIds.has(item.productId)) ||
      (item.channelId !== null && !channelIds.has(item.channelId)) ||
      (item.listingId !== null && !listingIds.has(item.listingId)) || (item.offerId !== null && !offerIds.has(item.offerId)) ||
      (item.productId === null && item.listingId === null && item.offerId === null) ||
      (item.offerId !== null && (item.listingId === null || offerById.get(item.offerId)?.listingId !== item.listingId)) ||
      (item.listingId !== null && item.channelId !== listingById.get(item.listingId)?.channelId) ||
      (item.status === 'RESOLVED' ? item.resolvedAt === null : item.resolvedAt !== null))) {
    throw new Error('repository response contains invalid cross-table references')
  }
  return data
}

async function loadWorkspaceRows(
  supabase: SupabaseRepositoryClient,
  selectedWorkspaceId: string,
): Promise<Row[]> {
  const result = await supabase.from('workspaces')
    .select('id,name,created_at,updated_at')
    .eq('id', selectedWorkspaceId)
    .limit(2)
  return rows(result, 'workspaces')
}

async function loadWorkspaceTable(
  supabase: SupabaseRepositoryClient,
  table: string,
  columns: string,
  selectedWorkspaceId: string,
): Promise<Row[]> {
  const collected: Row[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await supabase.from(table)
      .select(columns)
      .eq('workspace_id', selectedWorkspaceId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    const page = rows(result, table)
    collected.push(...page)
    if (page.length < PAGE_SIZE) return collected
  }
}

async function hasSelectedRow(query: PromiseLike<QueryResult>, entity: string): Promise<void> {
  const result = await query
  const matched = rows(result, entity)
  if (matched.length !== 1) throw new SupabaseRepositoryError(`선택한 workspace에서 ${entity}을(를) 찾을 수 없습니다.`)
}

export function createSupabaseRepository({
  supabase,
  workspaceId: selectedWorkspaceId,
}: {
  supabase: SupabaseRepositoryClient
  workspaceId: string
}): SellerRepository {
  if (selectedWorkspaceId.trim() === '') throw new SupabaseRepositoryError('Workspace ID가 필요합니다.')

  const load = async (): Promise<SellerData> => {
    try {
      const [workspaceRows, productRows, skuRows, componentRows, channelRows,
        listingRows, offerRows, aliasRows, issueRows] = await Promise.all([
        loadWorkspaceRows(supabase, selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'products', 'id,workspace_id,sabangnet_code,product_name,category,product_type,normal_price,status,created_at,updated_at', selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'skus', 'id,workspace_id,sku_code,model_name,color,status,created_at,updated_at', selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'product_components', 'id,workspace_id,product_id,sku_id,quantity,created_at', selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'channels', 'id,workspace_id,channel_code,channel_name,status,created_at', selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'channel_listings', 'id,workspace_id,channel_id,channel_product_id,product_name,status,product_url,last_synced_at,created_at,updated_at', selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'channel_offers', 'id,workspace_id,listing_id,channel_option_id,option_name,seller_code,normal_price,sale_price,status,master_product_id,created_at,updated_at', selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'aliases', 'id,workspace_id,raw_product_name,raw_option_name,source_channel,master_product_id,created_at', selectedWorkspaceId),
        loadWorkspaceTable(supabase, 'audit_issues', 'id,workspace_id,issue_type,severity,product_id,channel_id,listing_id,offer_id,title,description,status,detected_at,resolved_at', selectedWorkspaceId),
      ])

      if (workspaceRows.length !== 1) throw new Error('selected workspace was not returned exactly once')
      const products = productRows.map((row) => mapProduct(row, selectedWorkspaceId))
      const skus = skuRows.map((row) => mapSku(row, selectedWorkspaceId))
      const components = componentRows.map((row) => mapComponent(row, selectedWorkspaceId))
      const channels = channelRows.map((row) => mapChannel(row, selectedWorkspaceId))
      const listings = listingRows.map((row) => mapListing(row, selectedWorkspaceId))
      const offers = offerRows.map((row) => mapOffer(row, selectedWorkspaceId))
      const aliases = aliasRows.map((row) => mapAlias(row, selectedWorkspaceId))
      const listingChannels = new Map(listings.map((listing) => [listing.id, listing.channelId]))
      const issues = issueRows.map((row) => mapIssue(row, selectedWorkspaceId, listingChannels))
      return validateReferences({
        workspace: mapWorkspace(workspaceRows[0], selectedWorkspaceId), products, skus, components,
        channels, listings, offers, aliases, issues,
      })
    } catch (error) {
      throw normalizeError(error, 'SellerAudit 데이터를 불러오지 못했습니다.')
    }
  }

  return {
    load,
    async mapOffer(offerId, productId) {
      try {
        await Promise.all([
          hasSelectedRow(
            supabase.from('channel_offers').select('id').eq('workspace_id', selectedWorkspaceId).eq('id', offerId).limit(1),
            '판매 옵션',
          ),
          hasSelectedRow(
            supabase.from('products').select('id').eq('workspace_id', selectedWorkspaceId).eq('id', productId).limit(1),
            '기준 상품',
          ),
        ])
        const result = await supabase.rpc('map_offer', { p_offer_id: offerId, p_master_product_id: productId })
        if (result.error) throw result.error
        return await load()
      } catch (error) {
        throw normalizeError(error, '판매 옵션 매핑을 저장하지 못했습니다.')
      }
    },
    async updateIssueStatus(issueId, status) {
      try {
        if (!issueStatuses.has(status)) throw new SupabaseRepositoryError('허용되지 않은 이슈 상태입니다.')
        await hasSelectedRow(
          supabase.from('audit_issues').select('id').eq('workspace_id', selectedWorkspaceId).eq('id', issueId).limit(1),
          '감사 이슈',
        )
        const result = await supabase.rpc('update_issue_status', { p_issue_id: issueId, p_status: status })
        if (result.error) throw result.error
        return await load()
      } catch (error) {
        throw normalizeError(error, '이슈 상태를 저장하지 못했습니다.')
      }
    },
  }
}
