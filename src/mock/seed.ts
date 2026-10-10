import type {
  Alias,
  AuditIssue,
  Channel,
  ChannelCode,
  ChannelListing,
  ChannelOffer,
  MappingCandidate,
  Product,
  ProductComponent,
  SellerData,
  Sku,
} from '../types/domain'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
const BASE_DATE = '2026-10-06T09:00:00.000Z'
const recommendationTargetSeeds = new Map<string, string>()

const ranges = {
  product: 1000,
  sku: 2000,
  component: 3000,
  channel: 4000,
  listing: 5000,
  offer: 7000,
  alias: 9000,
  issue: 10000,
} as const

function entityId(type: keyof typeof ranges, index: number): string {
  return `00000000-0000-4000-8000-${(ranges[type] + index).toString(16).padStart(12, '0')}`
}

function at(dayOffset: number, minuteOffset = 0): string {
  const value = new Date(BASE_DATE)
  value.setUTCDate(value.getUTCDate() + dayOffset)
  value.setUTCMinutes(value.getUTCMinutes() + minuteOffset)
  return value.toISOString()
}

const productDefinitions = [
  ['100051', '점보 쿨라벤더 1개', 'SINGLE', 13300],
  ['100052', '1호 아쿠아 3개', 'SET', 11900],
  ['100053', '점보 투명그레이 2개', 'SET', 23800],
  ['100054', '1호 쿨라벤더 2개', 'SET', 9900],
  ['100055', '미니 핑크 2개', 'SET', 7900],
  ['100056', '2호 크림 1개', 'SINGLE', 6900],
  ['100057', '3호 그린 1개', 'SINGLE', 7900],
  ['100058', '점보 쿨라벤더 2개', 'SET', 24900],
  ['100059', '1호 투명그레이 3개', 'SET', 11900],
  ['100060', '2호 아쿠아 2개', 'SET', 10900],
  ['100061', '3호 쿨라벤더 2개', 'SET', 12900],
  ['100062', '미니 크림 4개', 'SET', 13900],
  ['100063', '점보 아쿠아 1개', 'SINGLE', 13300],
  ['100064', '1호 그린 3개', 'SET', 11900],
  ['100065', '2호 핑크 2개', 'SET', 10900],
  ['100066', '3호 투명그레이 2개', 'SET', 12900],
  ['100067', '점보 크림 1개', 'SINGLE', 13300],
  ['100068', '1호 핑크 1개', 'SINGLE', 4900],
  ['100069', '2호 그린 1개', 'SINGLE', 5900],
  ['100070', '3호 아쿠아 1개', 'SINGLE', 6900],
  ['100071', '미니 쿨라벤더 3개', 'SET', 10900],
  ['100072', '점보 핑크 1개', 'SINGLE', 13300],
  ['100073', '1호 크림 3개', 'SET', 11900],
  ['100074', '2호 투명그레이 2개', 'SET', 10900],
  ['100075', '3호 핑크 2개', 'SET', 12900],
  ['100076', '미니 아쿠아 4개', 'SET', 13900],
  ['100077', '점보 그린 2개', 'SET', 24900],
  ['100078', '1호 혼합 4개', 'SET', 15900],
  ['100320', '베스트 냉동실 세트', 'SET', 39900],
  ['100321', '패밀리 냉동실 세트', 'SET', 59900],
] as const

const skuDefinitions = [
  ['AL00', '점보', '쿨라벤더'], ['AQ01', '1호', '아쿠아'], ['AG00', '점보', '투명그레이'],
  ['AL01', '1호', '쿨라벤더'], ['PK00', '미니', '핑크'], ['CR02', '2호', '크림'],
  ['GR03', '3호', '그린'], ['AQ00', '점보', '아쿠아'], ['AG01', '1호', '투명그레이'],
  ['AQ02', '2호', '아쿠아'], ['AL03', '3호', '쿨라벤더'], ['CR00', '미니', '크림'],
  ['GR01', '1호', '그린'], ['PK02', '2호', '핑크'], ['AG03', '3호', '투명그레이'],
  ['CRJ0', '점보', '크림'], ['PK01', '1호', '핑크'], ['GR02', '2호', '그린'],
  ['AQ03', '3호', '아쿠아'], ['ALM0', '미니', '쿨라벤더'], ['PKJ0', '점보', '핑크'],
  ['CR01', '1호', '크림'], ['AG02', '2호', '투명그레이'], ['PK03', '3호', '핑크'],
  ['AQM0', '미니', '아쿠아'],
] as const

const bomDefinitions: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = {
  '100051': [['AL00', 1]], '100052': [['AQ01', 3]], '100053': [['AG00', 2]],
  '100054': [['AL01', 2]], '100055': [['PK00', 2]], '100056': [['CR02', 1]],
  '100057': [['GR03', 1]], '100058': [['AL00', 2]], '100059': [['AG01', 3]],
  '100060': [['AQ02', 2]], '100061': [['AL03', 2]], '100062': [['CR00', 4]],
  '100063': [['AQ00', 1]], '100064': [['GR01', 3]], '100065': [['PK02', 2]],
  '100066': [['AG03', 2]], '100067': [['CRJ0', 1]], '100068': [['PK01', 1]],
  '100069': [['GR02', 1]], '100070': [['AQ03', 1]], '100071': [['ALM0', 3]],
  '100072': [['PKJ0', 1]], '100073': [['CR01', 3]], '100074': [['AG02', 2]],
  '100075': [['PK03', 2]], '100076': [['AQM0', 4]],
  '100078': [['AL01', 2], ['AQ01', 2]],
  '100320': [['AL00', 1], ['AQ01', 2], ['AG00', 1]],
}

const channelDefinitions: ReadonlyArray<readonly [ChannelCode, string]> = [
  ['NAVER', '네이버 스마트스토어'], ['COUPANG', '쿠팡'], ['GMARKET', 'G마켓'],
  ['OHOUSE', '오늘의집'], ['11ST', '11번가'], ['SSG', 'SSG.COM'],
]

/** Produces a fresh, deterministic document on every call. */
export function createSeedData(): SellerData {
  const products: Product[] = productDefinitions.map(([code, name, type, price], index) => ({
    id: entityId('product', index), workspaceId: WORKSPACE_ID, sabangnetCode: code,
    productName: name, category: type === 'SET' ? '냉동용기 세트' : '냉동용기', productType: type,
    normalPrice: price, status: index === 27 ? 'INACTIVE' : 'ACTIVE', createdAt: at(-90, index), updatedAt: at(-2, index),
  }))
  const skus: Sku[] = skuDefinitions.map(([skuCode, modelName, color], index) => ({
    id: entityId('sku', index), workspaceId: WORKSPACE_ID, skuCode, modelName, color,
    status: index === 23 ? 'INACTIVE' : 'ACTIVE', createdAt: at(-120, index), updatedAt: at(-3, index),
  }))
  const components: ProductComponent[] = []
  const skuByCode = new Map(skus.map((sku) => [sku.skuCode, sku]))
  products.forEach((product) => {
    const definitions = bomDefinitions[product.sabangnetCode]
    if (!definitions) return // intentional MISSING_BOM fixtures
    definitions.forEach(([skuCode, quantity]) => {
      const sku = skuByCode.get(skuCode)
      if (!sku) throw new Error(`Unknown fixture SKU: ${skuCode}`)
      components.push({
      id: entityId('component', components.length), workspaceId: WORKSPACE_ID,
        productId: product.id, skuId: sku.id, quantity, createdAt: at(-80, components.length),
      })
    })
  })
  const channels: Channel[] = channelDefinitions.map(([channelCode, channelName], index) => ({
    id: entityId('channel', index), workspaceId: WORKSPACE_ID, channelCode, channelName,
    status: 'ACTIVE', createdAt: at(-180, index),
  }))
  const listings: ChannelListing[] = []
  const offers: ChannelOffer[] = []
  channels.forEach((channel, channelIndex) => {
    for (let slot = 0; slot < 20; slot += 1) {
      const productIndex = channelIndex === 5 && slot === 19 ? 3 : (slot + channelIndex * 3) % products.length
      const product = products[productIndex]
      const listingIndex = listings.length
      const listing: ChannelListing = {
        id: entityId('listing', listingIndex), workspaceId: WORKSPACE_ID, channelId: channel.id,
        channelProductId: `${channelIndex + 1}${String(942855000 + listingIndex)}`,
        productName: `${channel.channelName} ${product.productName.replace('개', 'P')}`,
        status: listingIndex % 37 === 0 ? 'INACTIVE' : 'ACTIVE',
        productUrl: null,
        lastSyncedAt: at(-listingIndex % 7, listingIndex), createdAt: at(-60, listingIndex), updatedAt: at(-listingIndex % 7, listingIndex),
      }
      listings.push(listing)
      const offerCount = listingIndex % 4 === 0 ? 2 : 1
      for (let optionIndex = 0; optionIndex < offerCount; optionIndex += 1) {
        const offerProduct = products[(productIndex + optionIndex) % products.length]
        const offerIndex = offers.length
        const unmatched = offerIndex % 19 === 0
        const seededPriceDifference = offerIndex % 17 === 5
        const offer: ChannelOffer = {
          id: entityId('offer', offerIndex), workspaceId: WORKSPACE_ID, listingId: listing.id,
          channelOptionId: offerCount === 1 ? 'BASE' : `OPT-${optionIndex + 1}`,
          optionName: offerCount === 1 ? null : offerProduct.productName,
          sellerCode: unmatched ? null : offerProduct.sabangnetCode,
          normalPrice: offerProduct.normalPrice,
          salePrice: offerProduct.normalPrice === null ? null : offerProduct.normalPrice - (seededPriceDifference ? 1400 : 0),
          status: offerIndex % 43 === 0 ? 'INACTIVE' : 'ACTIVE',
          masterProductId: unmatched ? null : offerProduct.id,
          createdAt: at(-45, offerIndex), updatedAt: at(-offerIndex % 6, offerIndex),
        }
        offers.push(offer)
        if (unmatched) recommendationTargetSeeds.set(offer.id, offerProduct.id)
      }
    }
  })
  const aliases: Alias[] = Array.from({ length: 60 }, (_, index) => {
    const product = products[index % products.length]
    const channel = channels[index % channels.length]
    return {
      id: entityId('alias', index), workspaceId: WORKSPACE_ID,
      rawProductName: `${channel.channelName} ${product.productName} ${Math.floor(index / products.length) + 1}`,
      rawOptionName: index % 3 === 0 ? product.productName : null, sourceChannel: channel.channelCode,
      masterProductId: product.id, createdAt: at(-30, index),
    }
  })
  const issues: AuditIssue[] = []
  const addIssue = (partial: Omit<AuditIssue, 'id' | 'workspaceId' | 'detectedAt' | 'resolvedAt' | 'status' | 'channelId'> & { channelId?: string | null }) => issues.push({
    id: entityId('issue', issues.length), workspaceId: WORKSPACE_ID, detectedAt: at(-issues.length % 14, issues.length),
    resolvedAt: null, status: 'OPEN', ...partial,
    channelId: partial.channelId ?? listings.find(listing => listing.id === partial.listingId)?.channelId ?? null,
  })
  offers.filter((offer) => offer.masterProductId === null).forEach((offer) => {
    const listing = listings.find((item) => item.id === offer.listingId)!
    addIssue({ issueType: 'UNMATCHED', severity: 'ERROR', productId: null, listingId: listing.id, offerId: offer.id, title: '미매칭 판매 옵션', description: `${listing.productName} 옵션을 기준 상품에 연결해 주세요.` })
  })
  offers.filter((_, index) => index % 17 === 5).slice(0, 9).forEach((offer) => {
    const baseline = offer.normalPrice === null ? '-' : `${offer.normalPrice.toLocaleString('ko-KR')}원`
    const current = offer.salePrice === null ? '-' : `${offer.salePrice.toLocaleString('ko-KR')}원`
    addIssue({
      issueType: 'PRICE_MISMATCH', severity: 'WARNING', productId: offer.masterProductId, listingId: offer.listingId, offerId: offer.id,
      title: '판매가 불일치', description: `기준가 ${baseline}, 현재가 ${current}입니다.`,
    })
  })
  ;[products[20], products[23], products[26], products[29], products[10], products[14]].forEach((product, index) => addIssue({
    issueType: 'MISSING_CHANNEL', severity: 'WARNING', productId: product.id, channelId: channels[index].id, listingId: null, offerId: null,
    title: `${channels[index].channelName} 미등록`, description: '필수 판매채널에 등록된 상품이 없습니다.',
  }))
  ;[products[26], products[29]].forEach((product) => addIssue({ issueType: 'MISSING_BOM', severity: 'ERROR', productId: product.id, listingId: null, offerId: null, title: '상품 구성 누락', description: 'SKU 구성정보가 없습니다.' }))
  addIssue({ issueType: 'DUPLICATE', severity: 'WARNING', productId: products[3].id, listingId: listings[119].id, offerId: null, title: '중복 Listing', description: '동일 채널에 유사한 Listing이 있습니다.' })
  addIssue({ issueType: 'INACTIVE_MISMATCH', severity: 'ERROR', productId: products[27].id, listingId: listings[78].id, offerId: null, title: '판매상태 불일치', description: '판매중지 상품이 채널에서 판매중입니다.' })
  addIssue({ issueType: 'NEW_LISTING', severity: 'INFO', productId: products[4].id, listingId: listings[4].id, offerId: null, title: '신규 Listing', description: '새 채널 상품이 발견되었습니다.' })
  addIssue({ issueType: 'CHANGED_LISTING', severity: 'INFO', productId: products[8].id, listingId: listings[8].id, offerId: null, title: '상품정보 변경', description: '채널 상품명이 변경되었습니다.' })
  return {
    workspace: { id: WORKSPACE_ID, name: 'SellerAudit Demo', createdAt: at(-365), updatedAt: at(0) },
    products, skus, components, channels, listings, offers, aliases, issues,
  }
}

const recommendationSeeds = new Map<string, MappingCandidate[]>()
const recommendationData = createSeedData()
recommendationData.offers.filter((offer) => offer.masterProductId === null).forEach((offer, index) => {
  const intendedProductId = recommendationTargetSeeds.get(offer.id)
  if (!intendedProductId) return
  recommendationSeeds.set(offer.id, [
    { productId: intendedProductId, confidence: 0.97 - (index % 3) * 0.02 },
    { productId: recommendationData.products[(recommendationData.products.findIndex((product) => product.id === intendedProductId) + 7) % recommendationData.products.length].id, confidence: 0.81 - (index % 2) * 0.03 },
  ])
})

/** Returns static demo recommendations; it performs no matching or scoring. */
export function getMockCandidates(data: SellerData, offerId: string): MappingCandidate[] {
  const offer = data.offers.find((item) => item.id === offerId)
  if (!offer || offer.workspaceId !== data.workspace.id || offer.masterProductId !== null) return []
  return (recommendationSeeds.get(offerId) ?? []).filter((candidate) => data.products.some((product) => product.id === candidate.productId))
}
