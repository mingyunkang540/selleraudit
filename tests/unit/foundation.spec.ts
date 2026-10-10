import { expect, test } from '@playwright/test'
import { createSeedData, getMockCandidates } from '../../src/mock'
import { formatDate, formatMoney, getCellStatus, getOfferDetails, getProductComponents, searchProducts } from '../../src/lib/selectors'
import { createMockRepository, MockRepositoryError, STORAGE_KEY, type StorageLike } from '../../src/services/mockRepository'
import type { IssueStatus, SellerData } from '../../src/types/domain'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failWrites = false

  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded')
    this.values.set(key, value)
  }
}

test('seed is deterministic, referentially coherent, and contains required fixtures', () => {
  const first = createSeedData()
  const second = createSeedData()
  expect(first).toEqual(second)
  expect(first.products).toHaveLength(30)
  expect(first.skus.length).toBeGreaterThanOrEqual(20)
  expect(first.channels.map((channel) => channel.channelCode)).toEqual(['NAVER', 'COUPANG', 'GMARKET', 'OHOUSE', '11ST', 'SSG'])
  expect(first.listings.length).toBeGreaterThanOrEqual(100)
  expect(first.offers.length).toBeGreaterThanOrEqual(150)
  expect(first.aliases.length).toBeGreaterThanOrEqual(50)
  expect(first.issues.length).toBeGreaterThanOrEqual(20)

  const product = first.products.find((item) => item.sabangnetCode === '100051')!
  expect(product.productName).toBe('점보 쿨라벤더 1개')
  expect(getProductComponents(first, product.id).map(({ sku, component }) => [sku.skuCode, component.quantity])).toEqual([['AL00', 1]])
  expect(first.products.find((item) => item.sabangnetCode === '100052')?.productName).toBe('1호 아쿠아 3개')
  expect(first.products.find((item) => item.sabangnetCode === '100053')?.productName).toBe('점보 투명그레이 2개')
  expect(first.products.find((item) => item.sabangnetCode === '100320')?.productName).toBe('베스트 냉동실 세트')
  const expectedBoms: Record<string, Array<[string, number]>> = {
    '100058': [['AL00', 2]], '100059': [['AG01', 3]], '100062': [['CR00', 4]],
    '100076': [['AQM0', 4]], '100078': [['AL01', 2], ['AQ01', 2]],
    '100320': [['AL00', 1], ['AQ01', 2], ['AG00', 1]],
  }
  Object.entries(expectedBoms).forEach(([code, expected]) => {
    const fixture = first.products.find((item) => item.sabangnetCode === code)!
    expect(getProductComponents(first, fixture.id).map(({ sku, component }) => [sku.skuCode, component.quantity])).toEqual(expected)
  })
  for (const missingCode of ['100077', '100321']) {
    const fixture = first.products.find((item) => item.sabangnetCode === missingCode)!
    expect(getProductComponents(first, fixture.id)).toEqual([])
  }

  const ids = [first.workspace.id, ...first.products.map((item) => item.id), ...first.offers.map((item) => item.id)]
  expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))).toBe(true)
  const productIds = new Set(first.products.map((item) => item.id))
  const skuIds = new Set(first.skus.map((item) => item.id))
  const listingIds = new Set(first.listings.map((item) => item.id))
  expect(first.components.every((item) => productIds.has(item.productId) && skuIds.has(item.skuId))).toBe(true)
  expect(first.offers.every((item) => listingIds.has(item.listingId) && (item.masterProductId === null || productIds.has(item.masterProductId)))).toBe(true)
  expect(first.listings.some((listing) => first.offers.filter((offer) => offer.listingId === listing.id).length > 1)).toBe(true)
  expect(first.listings.every((listing) => listing.productUrl === null)).toBe(true)
  expect(first.offers.some((offer) => offer.masterProductId === null)).toBe(true)
  expect(first.issues.some((issue) => issue.issueType === 'DUPLICATE')).toBe(true)
  expect(first.issues.some((issue) => issue.issueType === 'MISSING_BOM')).toBe(true)
})

test('search supports master, SKU, channel id, and channel name paths', () => {
  const data = createSeedData()
  const target = data.products.find((item) => item.sabangnetCode === '100051')!
  expect(searchProducts(data, '100051')).toContainEqual(target)
  expect(searchProducts(data, 'AL00')).toContainEqual(target)
  const detail = getOfferDetails(data, target.id)[0]
  expect(searchProducts(data, detail.listing.channelProductId)).toContainEqual(target)
  expect(searchProducts(data, detail.listing.productName)).toContainEqual(target)
  expect(searchProducts(data, '존재하지 않는 검색어')).toEqual([])
})

test('selectors expose seeded recommendations and seeded cell state', () => {
  const data = createSeedData()
  const unmatched = data.offers.find((offer) => offer.masterProductId === null)!
  const candidates = getMockCandidates(data, unmatched.id)
  expect(candidates.length).toBeGreaterThan(0)
  const intended = data.products.find((product) => product.id === candidates[0].productId)!
  const unmatchedListing = data.listings.find((listing) => listing.id === unmatched.listingId)!
  expect(unmatched.optionName === null
    ? unmatchedListing.productName.includes(intended.productName.replace('개', 'P'))
    : unmatched.optionName === intended.productName).toBe(true)
  const priceIssue = data.issues.find((issue) => issue.issueType === 'PRICE_MISMATCH' && issue.productId && issue.listingId)!
  const listing = data.listings.find((item) => item.id === priceIssue.listingId)!
  expect(getCellStatus(data, priceIssue.productId!, listing.channelId)).toBe('PRICE_MISMATCH')
  expect(formatMoney(13300)).toBe('13,300원')
  expect(formatMoney(null)).toBe('-')
  expect(formatDate(null)).toBe('-')
  expect(formatDate('2026-10-06T16:30:00.000Z')).toContain('2026. 10. 07')
})

test('every seeded price issue describes a real baseline/current difference', () => {
  const data = createSeedData()
  const priceIssues = data.issues.filter((issue) => issue.issueType === 'PRICE_MISMATCH')
  expect(priceIssues.length).toBeGreaterThan(0)
  priceIssues.forEach((issue) => {
    const offer = data.offers.find((candidate) => candidate.id === issue.offerId)!
    expect(offer.normalPrice).not.toBe(offer.salePrice)
    expect(issue.description).toContain(`${offer.normalPrice!.toLocaleString('ko-KR')}원`)
    expect(issue.description).toContain(`${offer.salePrice!.toLocaleString('ko-KR')}원`)
  })
})

test('cell status scopes price issues to the exact channel and keeps absent channels missing', () => {
  const seed = createSeedData()
  const product = seed.products.find((candidate) => {
    const channelIds = new Set(getOfferDetails(seed, candidate.id).map((detail) => detail.channel.id))
    return channelIds.size >= 2 && channelIds.size < seed.channels.length
  })!
  const details = getOfferDetails(seed, product.id)
  const first = details[0]
  const second = details.find((detail) => detail.channel.id !== first.channel.id)!
  const missingChannel = seed.channels.find((channel) => !details.some((detail) => detail.channel.id === channel.id))!
  const data = {
    ...seed,
    issues: [{
      ...seed.issues[0], issueType: 'PRICE_MISMATCH' as const, productId: product.id,
      listingId: first.listing.id, channelId: first.channel.id, offerId: first.offer.id, status: 'OPEN' as const,
    }],
  }
  expect(getCellStatus(data, product.id, first.channel.id)).toBe('PRICE_MISMATCH')
  expect(getCellStatus(data, product.id, second.channel.id)).toBe('NORMAL')
  expect(getCellStatus(data, product.id, missingChannel.id)).toBe('MISSING')
})

test('offer-scoped issue does not bleed to another product in a multi-product listing', () => {
  const seed = createSeedData()
  const listing = seed.listings.find((candidate) => {
    const productIds = new Set(seed.offers.filter((offer) => offer.listingId === candidate.id && offer.masterProductId).map((offer) => offer.masterProductId))
    return productIds.size >= 2
  })!
  const listingOffers = seed.offers.filter((offer) => offer.listingId === listing.id && offer.masterProductId !== null)
  const affected = listingOffers[0]
  const unaffected = listingOffers.find((offer) => offer.masterProductId !== affected.masterProductId)!
  const data = {
    ...seed,
    issues: [{
      ...seed.issues[0], issueType: 'PRICE_MISMATCH' as const, productId: null,
      listingId: listing.id, channelId: listing.channelId, offerId: affected.id, status: 'OPEN' as const,
    }],
  }
  expect(getCellStatus(data, affected.masterProductId!, listing.channelId)).toBe('PRICE_MISMATCH')
  expect(getCellStatus(data, unaffected.masterProductId!, listing.channelId)).toBe('NORMAL')
})

test('manual mapping persists atomically, adds one exact alias, resolves issues, and reloads', async () => {
  const storage = new MemoryStorage()
  const repository = createMockRepository(storage)
  const initial = await repository.load()
  const offer = initial.offers.find((item) => item.masterProductId === null)!
  const product = initial.products[0]
  const listing = initial.listings.find((item) => item.id === offer.listingId)!
  const channel = initial.channels.find((item) => item.id === listing.channelId)!
  const beforeAliasCount = initial.aliases.length

  const mapped = await repository.mapOffer(offer.id, product.id)
  expect(mapped.offers.find((item) => item.id === offer.id)?.masterProductId).toBe(product.id)
  expect(mapped.offers.find((item) => item.id === offer.id)?.sellerCode).toBe(offer.sellerCode)
  expect(mapped.aliases).toHaveLength(beforeAliasCount + 1)
  expect(mapped.aliases).toContainEqual(expect.objectContaining({
    rawProductName: listing.productName, rawOptionName: offer.optionName,
    sourceChannel: channel.channelCode, masterProductId: product.id,
  }))
  const resolved = mapped.issues.find((issue) => issue.offerId === offer.id && issue.issueType === 'UNMATCHED')!
  expect(resolved.status).toBe('RESOLVED')
  expect(resolved.resolvedAt).not.toBeNull()

  const onceSerialized = storage.values.get(STORAGE_KEY)
  const repeated = await repository.mapOffer(offer.id, product.id)
  expect(repeated.aliases).toHaveLength(beforeAliasCount + 1)
  expect(storage.values.get(STORAGE_KEY)).toBe(onceSerialized)
  expect((await createMockRepository(storage).load()).offers.find((item) => item.id === offer.id)?.masterProductId).toBe(product.id)
})

test('failed persistence does not leak a mutation into subsequent reads', async () => {
  const storage = new MemoryStorage()
  const repository = createMockRepository(storage)
  const initial = await repository.load()
  const offer = initial.offers.find((item) => item.masterProductId === null)!
  storage.failWrites = true
  await expect(repository.mapOffer(offer.id, initial.products[0].id)).rejects.toThrow(MockRepositoryError)
  storage.failWrites = false
  const reloaded = await repository.load()
  expect(reloaded.offers.find((item) => item.id === offer.id)?.masterProductId).toBeNull()
  expect(reloaded.aliases).toHaveLength(initial.aliases.length)
})

test('issue status is persisted with consistent resolvedAt semantics', async () => {
  const storage = new MemoryStorage()
  const repository = createMockRepository(storage)
  const issue = (await repository.load()).issues[0]
  const resolved = await repository.updateIssueStatus(issue.id, 'RESOLVED')
  const resolvedAt = resolved.issues.find((item) => item.id === issue.id)?.resolvedAt
  expect(resolvedAt).not.toBeNull()
  const reopened = await repository.updateIssueStatus(issue.id, 'IN_PROGRESS')
  expect(reopened.issues.find((item) => item.id === issue.id)).toEqual(expect.objectContaining({ status: 'IN_PROGRESS', resolvedAt: null }))
})

test('corrupt storage and invalid entity structures fail explicitly without reset', async () => {
  const corrupt = new MemoryStorage()
  corrupt.values.set(STORAGE_KEY, '{invalid')
  await expect(createMockRepository(corrupt).load()).rejects.toThrow('손상')
  expect(corrupt.values.get(STORAGE_KEY)).toBe('{invalid')

  const nullEntity = new MemoryStorage()
  const withNull = createSeedData() as unknown as { products: unknown[] }
  withNull.products[0] = null
  nullEntity.values.set(STORAGE_KEY, JSON.stringify(withNull))
  await expect(createMockRepository(nullEntity).load()).rejects.toThrow('손상')

  const danglingReference = new MemoryStorage()
  const dangling = createSeedData()
  dangling.offers[0].listingId = '00000000-0000-4000-8000-ffffffffffff'
  danglingReference.values.set(STORAGE_KEY, JSON.stringify(dangling))
  await expect(createMockRepository(danglingReference).load()).rejects.toThrow('손상')

  const wrongWorkspace = new MemoryStorage()
  const isolated = createSeedData()
  isolated.products[0].workspaceId = '00000000-0000-4000-8000-ffffffffffff'
  wrongWorkspace.values.set(STORAGE_KEY, JSON.stringify(isolated))
  await expect(createMockRepository(wrongWorkspace).load()).rejects.toThrow('손상')
})

test('mapping preserves ignored and listing-level issues while resolving only pending exact-offer issues', async () => {
  const data = createSeedData()
  const issue = data.issues.find(item => item.issueType === 'UNMATCHED')!
  issue.status = 'IGNORED'
  const listingIssue = { ...issue, id: crypto.randomUUID(), offerId: null, status: 'OPEN' as const }
  data.issues.push(listingIssue)
  const storage = new MemoryStorage()
  storage.setItem(STORAGE_KEY, JSON.stringify(data))
  const repository = createMockRepository(storage)
  const mapped = await repository.mapOffer(issue.offerId!, data.products[0].id)
  expect(mapped.issues.find(item => item.id === issue.id)?.status).toBe('IGNORED')
  expect(mapped.issues.find(item => item.id === listingIssue.id)?.status).toBe('OPEN')
  const serialized = storage.getItem(STORAGE_KEY)
  await repository.mapOffer(issue.offerId!, data.products[0].id)
  expect(storage.getItem(STORAGE_KEY)).toBe(serialized)
  await expect(repository.updateIssueStatus(issue.id, 'INVALID' as IssueStatus)).rejects.toThrow('허용되지 않은')
  expect(storage.getItem(STORAGE_KEY)).toBe(serialized)
})

test('separate null and empty option aliases keep distinct UUIDs and remain readable after saving', async () => {
  const data = createSeedData()
  const offer = data.offers.find(item => item.masterProductId === null)!
  offer.optionName = null
  const second = { ...offer, id: crypto.randomUUID(), channelOptionId: 'OTHER', optionName: '' }
  data.offers.push(second)
  const storage = new MemoryStorage()
  storage.setItem(STORAGE_KEY, JSON.stringify(data))
  const repository = createMockRepository(storage)
  await repository.mapOffer(offer.id, data.products[0].id)
  await repository.mapOffer(second.id, data.products[1].id)
  const saved = await repository.load()
  const newAliases = saved.aliases.slice(data.aliases.length)
  expect(newAliases).toHaveLength(2)
  expect(newAliases[0].id).not.toBe(newAliases[1].id)
  expect(newAliases.map(item => item.rawOptionName)).toEqual([null, ''])
})

test('invalid timestamps, prices, state timestamps and duplicate business keys fail before rendering', async () => {
  const corruptions: Array<(data: SellerData) => void> = [
    data => { data.issues[0].detectedAt = 'invalid date' },
    data => { data.offers[0].salePrice = -1 },
    data => { data.issues[0].status = 'RESOLVED' },
    data => { data.issues[0].listingId = null },
    data => { data.products[1].sabangnetCode = data.products[0].sabangnetCode },
    data => { data.issues[0].channelId = data.channels[1].id },
  ]
  for (const corrupt of corruptions) {
    const data = createSeedData()
    corrupt(data)
    const storage = new MemoryStorage()
    const serialized = JSON.stringify(data)
    storage.setItem(STORAGE_KEY, serialized)
    await expect(createMockRepository(storage).load()).rejects.toThrow('손상')
    expect(storage.getItem(STORAGE_KEY)).toBe(serialized)
  }
})

test('legacy documents derive listing channels without inventing a target for product-only issues', async () => {
  const data = createSeedData()
  const legacy = JSON.parse(JSON.stringify(data)) as { issues: Array<Record<string, unknown>> }
  legacy.issues.forEach(issue => { delete issue.channelId })
  const serialized = JSON.stringify(legacy)
  const storage = new MemoryStorage()
  storage.setItem(STORAGE_KEY, serialized)

  const loaded = await createMockRepository(storage).load()
  expect(loaded.issues.some(issue => issue.listingId !== null)).toBe(true)
  expect(loaded.issues.some(issue => issue.listingId === null)).toBe(true)
  loaded.issues.forEach(issue => {
    expect(issue.channelId).toBe(data.listings.find(listing => listing.id === issue.listingId)?.channelId ?? null)
  })
  expect(storage.getItem(STORAGE_KEY)).toBe(serialized)
})
