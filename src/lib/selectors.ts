import type { CellStatus, OfferDetail, Product, ProductComponent, SellerData, Sku } from '../types/domain'

export function getOfferDetails(data: SellerData, productId?: string): OfferDetail[] {
  const listingById = new Map(data.listings.map((listing) => [listing.id, listing]))
  const channelById = new Map(data.channels.map((channel) => [channel.id, channel]))
  return data.offers.flatMap((offer) => {
    if (productId !== undefined && offer.masterProductId !== productId) return []
    const listing = listingById.get(offer.listingId)
    const channel = listing ? channelById.get(listing.channelId) : undefined
    return listing && channel ? [{ offer, listing, channel }] : []
  })
}

export function getProductComponents(data: SellerData, productId: string): Array<{ component: ProductComponent; sku: Sku }> {
  const skuById = new Map(data.skus.map((sku) => [sku.id, sku]))
  return data.components.flatMap((component) => {
    if (component.productId !== productId) return []
    const sku = skuById.get(component.skuId)
    return sku ? [{ component, sku }] : []
  })
}

export function searchProducts(data: SellerData, query: string): Product[] {
  const needle = query.trim().toLocaleLowerCase('ko-KR')
  if (!needle) return data.products
  const productIds = new Set<string>()
  const matchingSkuIds = new Set(data.skus.filter((sku) =>
    `${sku.skuCode} ${sku.modelName} ${sku.color ?? ''}`.toLocaleLowerCase('ko-KR').includes(needle),
  ).map((sku) => sku.id))
  data.components.forEach((component) => {
    if (matchingSkuIds.has(component.skuId)) productIds.add(component.productId)
  })
  const matchingListingIds = new Set(data.listings.filter((listing) =>
    `${listing.channelProductId} ${listing.productName}`.toLocaleLowerCase('ko-KR').includes(needle),
  ).map((listing) => listing.id))
  data.offers.forEach((offer) => {
    if (matchingListingIds.has(offer.listingId) && offer.masterProductId) productIds.add(offer.masterProductId)
  })
  return data.products.filter((product) =>
    `${product.sabangnetCode} ${product.productName}`.toLocaleLowerCase('ko-KR').includes(needle) || productIds.has(product.id),
  )
}

export function getCellStatus(data: SellerData, productId: string, channelId: string): CellStatus {
  const details = getOfferDetails(data, productId).filter((detail) => detail.channel.id === channelId)
  if (details.length === 0) return 'MISSING'
  const listingIds = new Set(details.map((detail) => detail.listing.id))
  const offerIds = new Set(details.map((detail) => detail.offer.id))
  const activeIssues = data.issues.filter((issue) =>
    issue.status !== 'RESOLVED' && issue.status !== 'IGNORED' &&
    (issue.channelId === null || issue.channelId === channelId) &&
    (issue.productId === null || issue.productId === productId) &&
    (issue.offerId !== null
      ? offerIds.has(issue.offerId)
      : issue.listingId !== null
        ? listingIds.has(issue.listingId)
        : issue.productId === productId && issue.issueType !== 'MISSING_CHANNEL'),
  )
  if (activeIssues.some((issue) => issue.issueType === 'PRICE_MISMATCH')) return 'PRICE_MISMATCH'
  if (activeIssues.length > 0) return 'REVIEW'
  return 'NORMAL'
}

export function formatMoney(value: number | null): string {
  return value === null ? '-' : `${new Intl.NumberFormat('ko-KR').format(value)}원`
}

export function formatDate(value: string | null): string {
  if (value === null) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul',
  }).format(date)
}
