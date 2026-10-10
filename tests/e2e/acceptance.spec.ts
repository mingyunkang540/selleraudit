import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { createSeedData, getMockCandidates } from '../../src/mock'
import { getCellStatus, getOfferDetails } from '../../src/lib/selectors'
import { STORAGE_KEY } from '../../src/services/mockRepository'
import { asChannelCode } from '../../src/types/domain'
import type { SellerData } from '../../src/types/domain'

const seed = createSeedData()

async function seedPage(page: Page, data: SellerData = seed) {
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
  }, { key: STORAGE_KEY, value: JSON.stringify(data) })
}

async function openSeeded(page: Page, hash: string) {
  await seedPage(page)
  await page.goto(`/${hash}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

test('상품 100051 검색에서 Product 360, BOM, 6개 채널과 미등록 상태를 확인한다', async ({ page }) => {
  const product = seed.products.find((item) => item.sabangnetCode === '100051')!
  await openSeeded(page, '#/products')
  await page.getByRole('searchbox', { name: '판매상품 검색' }).fill(product.sabangnetCode)
  const row = page.getByRole('row').filter({ hasText: product.sabangnetCode })
  await expect(row).toContainText(product.productName)
  await row.getByRole('link', { name: product.sabangnetCode }).click()
  await expect(page).toHaveURL(new RegExp(`#/products/${product.id}$`))
  await expect(page.getByRole('heading', { level: 1, name: product.productName })).toBeVisible()

  await page.getByRole('button', { name: 'SKU 구성' }).click()
  const bomRow = page.getByRole('row').filter({ hasText: 'AL00' })
  await expect(bomRow).toContainText('1개')

  await page.getByRole('button', { name: '채널 등록 정보' }).click()
  for (const channel of seed.channels) await expect(page.getByText(channel.channelName, { exact: true }).first()).toBeVisible()
  const missing = seed.channels.filter((channel) => getOfferDetails(seed, product.id).every((detail) => detail.channel.id !== channel.id))
  if (missing.length) await expect(page.getByText('아직 연결된 판매상품이 없습니다.').first()).toBeVisible()
})

test('SKU 검색 Drawer에서 연결 상품 링크로 이동하고 Escape 시 초점이 복원된다', async ({ page }) => {
  const sku = seed.skus.find((item) => item.skuCode === 'AL00')!
  const component = seed.components.find((item) => item.skuId === sku.id)!
  const product = seed.products.find((item) => item.id === component.productId)!
  await openSeeded(page, '#/skus')
  await page.getByRole('searchbox', { name: 'SKU 검색' }).fill(sku.skuCode)
  const trigger = page.getByRole('button', { name: `${sku.skuCode} 연결 판매상품 보기` })
  await trigger.click()
  const drawer = page.getByRole('dialog')
  await expect(drawer).toContainText(product.productName)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('dialog').getByRole('link', { name: product.sabangnetCode }).click()
  await expect(page).toHaveURL(new RegExp(`#/products/${product.id}$`))
})

test('채널 매트릭스는 상태와 동일 셀의 모든 판매 옵션을 Drawer에 보존한다', async ({ page }) => {
  const pair = seed.products.flatMap((product) => seed.channels.map((channel) => ({
    product, channel, details: getOfferDetails(seed, product.id).filter((detail) => detail.channel.id === channel.id),
  }))).find((item) => item.details.length > 1)!
  await openSeeded(page, '#/channels')
  await page.getByRole('searchbox', { name: '검색' }).fill(pair.product.sabangnetCode)
  for (const channel of seed.channels) await expect(page.getByRole('columnheader').filter({ hasText: channel.channelName })).toBeVisible()
  const status = getCellStatus(seed, pair.product.id, pair.channel.id)
  const cell = page.getByRole('button', { name: `${pair.product.productName}, ${pair.channel.channelName} 상세` })
  await expect(cell).toContainText(status === 'PRICE_MISMATCH' ? '가격이상' : status === 'REVIEW' ? '확인필요' : '정상')
  await cell.click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.locator('.offer-card')).toHaveCount(pair.details.length)
  for (const detail of pair.details) await expect(drawer).toContainText(detail.listing.channelProductId)
})

test('새 채널 코드는 매트릭스에 표시되고 상품별 상세를 열 수 있다', async ({ page }) => {
  const data = createSeedData()
  data.channels.push({ ...data.channels[0], id: crypto.randomUUID(), channelCode: asChannelCode('WCONCEPT'), channelName: 'W컨셉' })
  const product = data.products.find((item) => item.sabangnetCode === '100051')!
  await seedPage(page, data)
  await page.goto('/#/channels')
  await expect(page.getByText('7개 판매채널에서 비교합니다.', { exact: false })).toBeVisible()
  await expect(page.getByRole('columnheader').filter({ hasText: 'W컨셉' })).toBeVisible()
  await page.getByRole('searchbox', { name: '검색' }).fill(product.sabangnetCode)
  await page.getByRole('button', { name: `${product.productName}, W컨셉 상세` }).click()
  await expect(page.getByRole('dialog')).toContainText('W컨셉')
})

test('데모 추천으로 수동 매핑하면 offer와 alias가 저장되고 새로고침 후 유지된다', async ({ page }) => {
  const offer = seed.offers.find((item) => item.masterProductId === null)!
  const listing = seed.listings.find((item) => item.id === offer.listingId)!
  const channel = seed.channels.find((item) => item.id === listing.channelId)!
  const candidate = getMockCandidates(seed, offer.id)[0]
  const product = seed.products.find((item) => item.id === candidate.productId)!
  await openSeeded(page, '#/mapping')
  await expect(page.getByText('데모 추천', { exact: true }).first()).toBeVisible()
  await page.locator('.candidate-card').filter({ hasText: product.productName }).first().click()
  const save = page.getByRole('button', { name: '매핑 저장' })
  await save.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(listing.productName)
  await expect(dialog).toContainText(`${product.sabangnetCode} ${product.productName}`)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(save).toBeFocused()
  await save.click()
  await page.getByRole('dialog').getByRole('button', { name: '연결 확인' }).click()
  await expect(page.getByText(listing.productName, { exact: true })).toHaveCount(0)

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY) as SellerData
  expect(stored.offers.find((item) => item.id === offer.id)?.masterProductId).toBe(product.id)
  expect(stored.aliases).toContainEqual(expect.objectContaining({ rawProductName: listing.productName, rawOptionName: offer.optionName, sourceChannel: channel.channelCode, masterProductId: product.id }))
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: '매핑 센터' })).toBeVisible()
  const reloaded = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY) as SellerData
  expect(reloaded.offers.find((item) => item.id === offer.id)?.masterProductId).toBe(product.id)
})

test('감사 이슈를 OPEN에서 RESOLVED로 바꾸면 resolvedAt과 필터가 새로고침 후 유지된다', async ({ page }) => {
  const issue = seed.issues.find((item) => item.status === 'OPEN' && item.issueType === 'DUPLICATE')!
  await openSeeded(page, '#/audit')
  await page.getByRole('searchbox', { name: '검색' }).fill(issue.title)
  const row = page.getByRole('row').filter({ hasText: issue.title })
  await row.getByRole('combobox', { name: `${issue.title} 처리 상태` }).selectOption('RESOLVED')
  await expect(row.getByRole('combobox')).toHaveValue('RESOLVED')
  let stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY) as SellerData
  expect(stored.issues.find((item) => item.id === issue.id)).toEqual(expect.objectContaining({ status: 'RESOLVED' }))
  expect(stored.issues.find((item) => item.id === issue.id)?.resolvedAt).not.toBeNull()
  await page.reload()
  await page.getByRole('searchbox', { name: '검색' }).fill(issue.title)
  await expect(page.getByRole('row').filter({ hasText: issue.title }).getByRole('combobox')).toHaveValue('RESOLVED')
  stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY) as SellerData
  expect(stored.issues.find((item) => item.id === issue.id)?.resolvedAt).not.toBeNull()
})

test('대시보드 유형 링크, 빈 검색, 없는 상품, 손상 저장소 오류를 명확히 처리한다', async ({ page }) => {
  await openSeeded(page, '#/dashboard')
  await page.locator('a[href="#/audit?type=PRICE_MISMATCH"]').click()
  await expect(page.getByRole('tab', { name: /가격/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('row').filter({ has: page.locator('.issue-badge') })).toHaveCount(seed.issues.filter((item) => item.issueType === 'PRICE_MISMATCH').length)

  await page.goto('/#/products')
  await page.getByRole('searchbox', { name: '판매상품 검색' }).fill('존재하지-않는-상품')
  await expect(page.getByRole('heading', { name: '조건에 맞는 판매상품이 없습니다.' })).toBeVisible()
  await page.goto('/#/products/not-a-product')
  await expect(page.getByRole('heading', { level: 1, name: '상품을 찾을 수 없습니다' })).toBeVisible()

  await page.evaluate((key) => localStorage.setItem(key, '{invalid'), STORAGE_KEY)
  await page.reload()
  await expect(page.getByText('저장된 SellerAudit 데이터가 손상되었습니다.')).toBeVisible()
  const retry = page.getByRole('button', { name: /다시|재시도/ })
  if (await retry.count()) { await retry.click(); await expect(page.getByText('저장된 SellerAudit 데이터가 손상되었습니다.')).toBeVisible() }
})

test('390px에서 가로 넘침 없이 모바일 메뉴로 주요 화면을 이동한다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openSeeded(page, '#/dashboard')
  await expect(page.getByRole('button', { name: '메뉴 열기' })).toBeVisible()
  await page.getByRole('button', { name: '메뉴 열기' }).click()
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: /채널별 상품 현황/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: '채널 상품 매트릭스' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ body: document.body.scrollWidth, root: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(Math.max(dimensions.body, dimensions.root)).toBeLessThanOrEqual(dimensions.viewport)
})

test('주요 화면의 1440px 검토용 스크린샷을 생성한다', async ({ page }) => {
  await mkdir('test-results/screenshots', { recursive: true })
  await openSeeded(page, '#/dashboard')
  await page.screenshot({ path: 'test-results/screenshots/dashboard-1440x1000.png' })
  await page.goto('/#/products')
  await page.screenshot({ path: 'test-results/screenshots/products-1440x1000.png' })
  await page.goto('/#/channels')
  await page.screenshot({ path: 'test-results/screenshots/matrix-1440x1000.png' })
  await page.goto('/#/mapping')
  await page.screenshot({ path: 'test-results/screenshots/mapping-1440x1000.png' })
  await page.goto('/#/audit')
  await page.screenshot({ path: 'test-results/screenshots/audit-1440x1000.png' })
})

test('같은 Listing의 다른 Product 옵션 이슈는 Product 360 이력에 섞이지 않는다', async ({ page }) => {
  const listing = seed.listings.find(item => new Set(seed.offers.filter(offer => offer.listingId === item.id && offer.masterProductId).map(offer => offer.masterProductId)).size >= 2)!
  const offers = seed.offers.filter(offer => offer.listingId === listing.id && offer.masterProductId)
  const affected = offers[0]
  const unaffected = offers.find(offer => offer.masterProductId !== affected.masterProductId)!
  const data = { ...seed, issues: [{ ...seed.issues[0], issueType: 'PRICE_MISMATCH' as const, productId: affected.masterProductId, channelId: listing.channelId, listingId: listing.id, offerId: affected.id, title: '특정 옵션에만 해당하는 가격 이슈' }] }
  await seedPage(page, data)
  await page.goto(`/#/products/${unaffected.masterProductId}`)
  await page.getByRole('button', { name: /이슈 이력/ }).click()
  await expect(page.getByText('발견된 이슈가 없습니다.')).toBeVisible()
  await page.goto(`/#/products/${affected.masterProductId}`)
  await page.getByRole('button', { name: /이슈 이력/ }).click()
  await expect(page.getByText('특정 옵션에만 해당하는 가격 이슈')).toBeVisible()
})

test('추천 상품도 전체 상품 검색으로 다시 찾을 수 있고 가격 미입력 셀은 무한대로 표시되지 않는다', async ({ page }) => {
  const data = createSeedData()
  const offer = data.offers.find(item => !item.masterProductId)!
  const candidate = data.products.find(item => item.id === getMockCandidates(data, offer.id)[0].productId)!
  const detail = getOfferDetails(data, data.products[0].id)[0]
  data.offers.filter(item => item.masterProductId === data.products[0].id && data.listings.find(listing => listing.id === item.listingId)?.channelId === detail.channel.id).forEach(item => { item.normalPrice = null; item.salePrice = null })
  await seedPage(page, data)
  await page.goto('/#/mapping')
  await page.getByPlaceholder('상품명 또는 사방넷 품번 검색').fill(candidate.sabangnetCode)
  await expect(page.locator('.compact-candidates .candidate-card').filter({ hasText: candidate.productName })).toBeVisible()
  await page.goto('/#/channels')
  await page.getByRole('searchbox').fill(data.products[0].sabangnetCode)
  await expect(page.getByRole('button', { name: `${data.products[0].productName}, ${detail.channel.channelName} 상세` })).toContainText('가격 미입력')
  await expect(page.getByText('∞원')).toHaveCount(0)
})

test('매핑 대기 목록 검색은 선택을 보이는 옵션으로 바꾸고 이전 후보를 재사용하지 않는다', async ({ page }) => {
  const original = seed.offers.find(offer => offer.masterProductId === null)!
  const targetOffer = seed.offers.filter(offer => offer.masterProductId === null)[1]
  const listing = seed.listings.find(item => item.id === targetOffer.listingId)!
  await openSeeded(page, '#/mapping')
  await page.locator('.candidate-card').first().click()
  await expect(page.getByRole('button', { name: '매핑 저장' })).toBeEnabled()
  await page.getByPlaceholder('채널 상품명, 상품번호 검색').fill(listing.channelProductId)
  await expect(page.locator('.source-card')).toContainText(listing.productName)
  await expect(page.getByRole('button', { name: '매핑 저장' })).toBeDisabled()
  await page.locator('.candidate-card').first().click()
  await page.getByRole('button', { name: '매핑 저장' }).click()
  await expect(page.getByRole('dialog')).toContainText(listing.productName)
  await page.getByRole('dialog').getByRole('button', { name: '연결 확인' }).click()
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY) as SellerData
  expect(saved.offers.find(item => item.id === original.id)?.masterProductId).toBeNull()
  expect(saved.offers.find(item => item.id === targetOffer.id)?.masterProductId).not.toBeNull()
})

test('Listing이 없는 채널 누락 이슈도 대상 채널로 검색하고 상세를 확인한다', async ({ page }) => {
  const issue = seed.issues.find(item => item.issueType === 'MISSING_CHANNEL')!
  const channel = seed.channels.find(item => item.id === issue.channelId)!
  await openSeeded(page, '#/audit?type=MISSING_CHANNEL')
  await page.getByRole('combobox', { name: '채널', exact: true }).selectOption(channel.id)
  const row = page.getByRole('row').filter({ hasText: issue.title })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '상세', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(channel.channelName)
})
