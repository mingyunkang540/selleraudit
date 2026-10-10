import { createSeedData } from '../mock'
import type { Alias, SellerData } from '../types/domain'
import type { SellerRepository } from './repository'

export const STORAGE_KEY = 'seller-audit:v0.1:data'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class MockRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MockRepositoryError'
  }
}

function clone(data: SellerData): SellerData {
  return structuredClone(data)
}

type UnknownRecord = Record<string, unknown>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const entityStatuses = new Set(['ACTIVE', 'INACTIVE', 'DRAFT'])
const issueStatuses = new Set(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'IGNORED'])
const issueTypes = new Set(['UNMATCHED', 'PRICE_MISMATCH', 'MISSING_CHANNEL', 'INACTIVE_MISMATCH', 'DUPLICATE', 'NEW_LISTING', 'CHANGED_LISTING', 'MISSING_BOM'])
const severities = new Set(['INFO', 'WARNING', 'ERROR'])
const channelCodes = new Set(['NAVER', 'COUPANG', 'GMARKET', 'OHOUSE', '11ST', 'SSG'])

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isUuid(value: unknown): value is string { return typeof value === 'string' && uuidPattern.test(value) }
function isString(value: unknown): value is string { return typeof value === 'string' }
function isNullableString(value: unknown): value is string | null { return value === null || typeof value === 'string' }
function isNullableNumber(value: unknown): value is number | null { return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0) }
function isTimestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }
function isNullableTimestamp(value: unknown): value is string | null { return value === null || isTimestamp(value) }
function uniqueKey(values: UnknownRecord[], fields: string[]): boolean {
  return new Set(values.map(value => JSON.stringify(fields.map(field => value[field])))).size === values.length
}
function isWorkspaceEntity(value: UnknownRecord, workspaceId: string): boolean {
  return isUuid(value.id) && value.workspaceId === workspaceId
}

function uniqueIds(values: UnknownRecord[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length
}

function validateDocument(value: unknown): SellerData {
  if (!isRecord(value) || !isRecord(value.workspace) || !isUuid(value.workspace.id) ||
    !isString(value.workspace.name) || !isTimestamp(value.workspace.createdAt) || !isTimestamp(value.workspace.updatedAt)) {
    throw new Error('workspace is invalid')
  }
  const workspaceId = value.workspace.id
  const collectionNames = ['products', 'skus', 'components', 'channels', 'listings', 'offers', 'aliases', 'issues'] as const
  if (collectionNames.some((name) => !Array.isArray(value[name]) || !(value[name] as unknown[]).every(isRecord))) {
    throw new Error('document collections are invalid')
  }
  const products = value.products as UnknownRecord[]
  const skus = value.skus as UnknownRecord[]
  const components = value.components as UnknownRecord[]
  const channels = value.channels as UnknownRecord[]
  const listings = value.listings as UnknownRecord[]
  const offers = value.offers as UnknownRecord[]
  const aliases = value.aliases as UnknownRecord[]
  const issues = value.issues as UnknownRecord[]
  // Earlier Foundation demo documents did not carry explicit channel context.
  for (const issue of issues) {
    if (issue.channelId === undefined) issue.channelId = listings.find(listing => listing.id === issue.listingId)?.channelId ?? null
  }
  if ([products, skus, components, channels, listings, offers, aliases, issues].some((items) => !uniqueIds(items))) {
    throw new Error('duplicate entity ids')
  }
  if (!products.every((item) => isWorkspaceEntity(item, workspaceId) && isString(item.sabangnetCode) &&
    isString(item.productName) && isNullableString(item.category) && (item.productType === 'SINGLE' || item.productType === 'SET') &&
    isNullableNumber(item.normalPrice) && entityStatuses.has(String(item.status)) && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))) {
    throw new Error('products are invalid')
  }
  if (!skus.every((item) => isWorkspaceEntity(item, workspaceId) && isString(item.skuCode) && isString(item.modelName) &&
    isNullableString(item.color) && entityStatuses.has(String(item.status)) && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))) {
    throw new Error('skus are invalid')
  }
  if (!channels.every((item) => isWorkspaceEntity(item, workspaceId) && channelCodes.has(String(item.channelCode)) &&
    isString(item.channelName) && entityStatuses.has(String(item.status)) && isTimestamp(item.createdAt))) {
    throw new Error('channels are invalid')
  }
  const productIds = new Set(products.map((item) => item.id))
  const skuIds = new Set(skus.map((item) => item.id))
  const channelIds = new Set(channels.map((item) => item.id))
  if (!components.every((item) => isWorkspaceEntity(item, workspaceId) && productIds.has(item.productId) &&
    skuIds.has(item.skuId) && Number.isInteger(item.quantity) && Number(item.quantity) > 0 && isTimestamp(item.createdAt))) {
    throw new Error('components are invalid')
  }
  if (!listings.every((item) => isWorkspaceEntity(item, workspaceId) && channelIds.has(item.channelId) &&
    isString(item.channelProductId) && isString(item.productName) && entityStatuses.has(String(item.status)) &&
    isNullableString(item.productUrl) && isNullableTimestamp(item.lastSyncedAt) && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))) {
    throw new Error('listings are invalid')
  }
  const listingIds = new Set(listings.map((item) => item.id))
  if (!offers.every((item) => isWorkspaceEntity(item, workspaceId) && listingIds.has(item.listingId) &&
    isString(item.channelOptionId) && isNullableString(item.optionName) && isNullableString(item.sellerCode) &&
    isNullableNumber(item.normalPrice) && isNullableNumber(item.salePrice) && entityStatuses.has(String(item.status)) &&
    (item.masterProductId === null || productIds.has(item.masterProductId)) && isTimestamp(item.createdAt) && isTimestamp(item.updatedAt))) {
    throw new Error('offers are invalid')
  }
  const offerIds = new Set(offers.map((item) => item.id))
  if (!aliases.every((item) => isWorkspaceEntity(item, workspaceId) && isString(item.rawProductName) &&
    isNullableString(item.rawOptionName) && (item.sourceChannel === null || channelCodes.has(String(item.sourceChannel))) &&
    productIds.has(item.masterProductId) && isTimestamp(item.createdAt))) {
    throw new Error('aliases are invalid')
  }
  if (!issues.every((item) => isWorkspaceEntity(item, workspaceId) && issueTypes.has(String(item.issueType)) &&
    severities.has(String(item.severity)) && (item.productId === null || productIds.has(item.productId)) &&
    (item.channelId === null || channelIds.has(item.channelId)) &&
    (item.listingId === null || listingIds.has(item.listingId)) && (item.offerId === null || offerIds.has(item.offerId)) &&
    isString(item.title) && isString(item.description) && issueStatuses.has(String(item.status)) &&
    isTimestamp(item.detectedAt) && isNullableTimestamp(item.resolvedAt) &&
    (item.status === 'RESOLVED' ? item.resolvedAt !== null : item.resolvedAt === null) &&
    (item.productId !== null || item.listingId !== null || item.offerId !== null) &&
    (item.offerId === null || item.listingId !== null))) {
    throw new Error('issues are invalid')
  }
  const listingById = new Map(listings.map((item) => [item.id, item]))
  const offerById = new Map(offers.map((item) => [item.id, item]))
  if (issues.some((issue) => issue.offerId !== null && issue.listingId !== null &&
    offerById.get(issue.offerId)?.listingId !== issue.listingId)) {
    throw new Error('issue references are inconsistent')
  }
  if (offers.some((offer) => !listingById.has(offer.listingId))) throw new Error('offer references are invalid')
  if (issues.some(issue => issue.channelId !== null && issue.listingId !== null &&
    listingById.get(issue.listingId)?.channelId !== issue.channelId)) throw new Error('issue channel is inconsistent')
  if (!uniqueKey(products, ['sabangnetCode']) || !uniqueKey(skus, ['skuCode']) ||
    !uniqueKey(channels, ['channelCode']) || !uniqueKey(components, ['productId', 'skuId']) ||
    !uniqueKey(listings, ['channelId', 'channelProductId']) || !uniqueKey(offers, ['listingId', 'channelOptionId']) ||
    !uniqueKey(aliases, ['rawProductName', 'rawOptionName', 'sourceChannel'])) {
    throw new Error('duplicate business keys')
  }
  return value as unknown as SellerData
}

function parseDocument(serialized: string): SellerData {
  try {
    return validateDocument(JSON.parse(serialized) as unknown)
  } catch (error) {
    throw new MockRepositoryError('저장된 SellerAudit 데이터가 손상되었습니다.', { cause: error })
  }
}

function readStorage(storage: StorageLike): SellerData | null {
  try {
    const serialized = storage.getItem(STORAGE_KEY)
    return serialized === null ? null : parseDocument(serialized)
  } catch (error) {
    if (error instanceof MockRepositoryError) throw error
    throw new MockRepositoryError('SellerAudit 저장소를 읽을 수 없습니다.', { cause: error })
  }
}

function persist(storage: StorageLike, data: SellerData): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    throw new MockRepositoryError('SellerAudit 변경사항을 저장하지 못했습니다.', { cause: error })
  }
}

function loadOrCreate(storage: StorageLike): SellerData {
  const existing = readStorage(storage)
  if (existing) return existing
  const seed = createSeedData()
  persist(storage, seed)
  return seed
}

function resolveStorage(storage?: StorageLike): StorageLike {
  if (storage) return storage
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch (error) {
    throw new MockRepositoryError('브라우저 localStorage를 사용할 수 없습니다.', { cause: error })
  }
  throw new MockRepositoryError('브라우저 localStorage를 사용할 수 없습니다.')
}

export function createMockRepository(storage?: StorageLike): SellerRepository {
  const documentStorage = resolveStorage(storage)
  return {
    async load() {
      return clone(loadOrCreate(documentStorage))
    },
    async mapOffer(offerId, productId) {
      const current = loadOrCreate(documentStorage)
      const offer = current.offers.find((item) => item.id === offerId)
      if (!offer) throw new MockRepositoryError('매핑할 판매 옵션을 찾을 수 없습니다.')
      const listing = current.listings.find((item) => item.id === offer.listingId)
      if (!listing) throw new MockRepositoryError('판매 옵션의 Listing을 찾을 수 없습니다.')
      const channel = current.channels.find((item) => item.id === listing.channelId)
      if (!channel) throw new MockRepositoryError('Listing의 판매채널을 찾을 수 없습니다.')
      const product = current.products.find((item) => item.id === productId)
      if (!product) throw new MockRepositoryError('연결할 기준 상품을 찾을 수 없습니다.')
      const workspaceId = current.workspace.id
      if ([offer.workspaceId, listing.workspaceId, channel.workspaceId, product.workspaceId].some((id) => id !== workspaceId)) {
        throw new MockRepositoryError('다른 workspace의 데이터는 연결할 수 없습니다.')
      }
      const aliases = [...current.aliases]
      const existingAliasIndex = aliases.findIndex((alias) =>
        alias.workspaceId === workspaceId && alias.rawProductName === listing.productName &&
        alias.rawOptionName === offer.optionName && alias.sourceChannel === channel.channelCode,
      )
      const relatedIssues = current.issues.filter((issue) => issue.offerId === offer.id && issue.issueType === 'UNMATCHED')
      if (relatedIssues.some((issue) => issue.workspaceId !== workspaceId)) {
        throw new MockRepositoryError('다른 workspace의 이슈는 변경할 수 없습니다.')
      }
      if (offer.masterProductId === product.id && existingAliasIndex >= 0 &&
        aliases[existingAliasIndex].masterProductId === product.id &&
        relatedIssues.every((issue) => issue.status === 'RESOLVED' || issue.status === 'IGNORED')) {
        return clone(current)
      }
      const now = new Date().toISOString()
      const savedAlias: Alias = {
        id: existingAliasIndex >= 0 ? aliases[existingAliasIndex].id : crypto.randomUUID(),
        workspaceId, rawProductName: listing.productName, rawOptionName: offer.optionName,
        sourceChannel: channel.channelCode, masterProductId: product.id,
        createdAt: existingAliasIndex >= 0 ? aliases[existingAliasIndex].createdAt : now,
      }
      if (existingAliasIndex >= 0) aliases[existingAliasIndex] = savedAlias
      else aliases.push(savedAlias)
      const next: SellerData = {
        ...current,
        offers: current.offers.map((item) => item.id === offer.id ? { ...item, masterProductId: product.id, updatedAt: now } : item),
        aliases,
        issues: current.issues.map((issue) => issue.offerId === offer.id && issue.issueType === 'UNMATCHED' &&
          (issue.status === 'OPEN' || issue.status === 'IN_PROGRESS')
          ? { ...issue, status: 'RESOLVED', resolvedAt: now }
          : issue),
      }
      persist(documentStorage, next)
      return clone(next)
    },
    async updateIssueStatus(issueId, status) {
      if (!issueStatuses.has(status)) throw new MockRepositoryError('허용되지 않은 이슈 상태입니다.')
      const current = loadOrCreate(documentStorage)
      const issue = current.issues.find((item) => item.id === issueId)
      if (!issue) throw new MockRepositoryError('변경할 이슈를 찾을 수 없습니다.')
      if (issue.workspaceId !== current.workspace.id) throw new MockRepositoryError('다른 workspace의 이슈는 변경할 수 없습니다.')
      const now = new Date().toISOString()
      const next: SellerData = {
        ...current,
        issues: current.issues.map((item) => item.id === issueId ? {
          ...item, status, resolvedAt: status === 'RESOLVED' ? item.resolvedAt ?? now : null,
        } : item),
      }
      persist(documentStorage, next)
      return clone(next)
    },
  }
}
