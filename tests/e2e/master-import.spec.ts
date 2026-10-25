import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { createSeedData } from '../../src/mock'
import { STORAGE_KEY } from '../../src/services/mockRepository'

function sanitizedMasterWorkbook(): Buffer {
  const price: unknown[][] = Array.from({ length: 13 }, () => [])
  price[4][1] = '사방넷품번'; price[4][2] = '구분'; price[4][3] = '카테고리'
  price[4][4] = '모델명'; price[4][5] = '구성 상세'; price[4][7] = '구성수'
  const rows: Array<[string | null, string, string, number, string]> = [
    ['100051', '점보', 'AL00 1개', 1, '공통'],
    ['100526', '상품 A', 'AL00 2개', 2, '쿠팡'],
    ['100526', '상품 B', 'AQ01 2개', 2, '쿠팡'],
    ['100900', '미확인 SKU', 'AL24 1개', 1, '공통'],
    ['100901', '수량 불일치', 'AL00 1개, AQ01 1개', 3, '공통'],
    [null, '품번 없음', 'AL00 1개', 1, '공통'],
    ['100902', '구성 미해석', 'AL00', 1, '공통'],
    ['100051', '점보', 'AL00 1개', 1, '오늘의집_아쿠아'],
  ]
  rows.forEach(([code, name, bom, quantity, channel], index) => {
    const row = price[index + 5]
    row[1] = code; row[2] = '단품'; row[3] = '냉동용기'; row[4] = name
    row[5] = bom; row[7] = quantity; row[33] = channel
  })
  const codes: unknown[][] = Array.from({ length: 8 }, () => [])
  codes[2][2] = '상품명'; codes[2][3] = '옵션명'; codes[2][4] = '상품코드'
  codes[3][1] = '냉동용기'
  codes[4][2] = '점보'; codes[4][3] = '라벤더'; codes[4][4] = 'AL00'
  codes[5][2] = '1호'; codes[5][3] = '아쿠아'; codes[5][4] = 'AQ01'
  const products: unknown[][] = Array.from({ length: 4 }, () => [])
  products[2][0] = '마스터 상품명'; products[2][2] = '사방넷 품번코드'
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(price), '단가표')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(codes), '코드DB')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(products), '상품DB')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer
}

test('Master Excel Dry-run은 문제를 표시하고 기존 Master를 변경하지 않는다', async ({ page }) => {
  const seed = createSeedData()
  await page.addInitScript(({ key, value }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value) }, { key: STORAGE_KEY, value: JSON.stringify(seed) })
  await page.goto('/#/dashboard')
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)
  await page.getByRole('navigation', { name: '주 메뉴' }).getByRole('link', { name: '데이터 가져오기' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Master Excel 분석' })).toBeVisible()
  await page.getByLabel('Master Excel 파일').setInputFiles({ name: 'sanitized-master.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: sanitizedMasterWorkbook() })
  await expect(page.getByText('sanitized-master.xlsx')).toBeVisible()
  await page.getByRole('button', { name: '분석 시작' }).click()
  await expect(page.getByText('Master 분석 결과')).toBeVisible()
  await expect(page.getByText(/차단 오류 \d+건/)).toBeVisible()
  await expect(page.getByText('DUPLICATE_BUSINESS_KEY').first()).toBeVisible()
  await expect(page.getByText('UNKNOWN_SKU').first()).toBeVisible()
  await expect(page.getByText('BOM_QUANTITY_MISMATCH').first()).toBeVisible()
  await page.getByRole('region', { name: '검증 이슈' }).getByRole('row').filter({ hasText: 'BOM_QUANTITY_MISMATCH' }).getByRole('button', { name: '상세' }).click()
  await expect(page.getByRole('dialog')).toContainText('Product 100901')
  await expect(page.getByRole('dialog')).toContainText('BOM AL00')
  await page.getByRole('button', { name: '닫기' }).click()

  const search = page.getByRole('searchbox', { name: 'Import 후보 검색' })
  await search.fill('100051')
  await expect(page.getByRole('region', { name: '후보 미리보기' })).toContainText('점보')
  await page.getByRole('tab', { name: /BOM/ }).click()
  await expect(page.getByRole('region', { name: '후보 미리보기' })).toContainText('AL00')
  await search.fill('100526')
  await page.getByRole('tab', { name: /Products/ }).click()
  await expect(page.getByRole('region', { name: '후보 미리보기' }).getByRole('row').filter({ hasText: '100526' })).toHaveCount(2)
  await search.fill('AL24')
  await expect(page.getByRole('region', { name: '검증 이슈' })).toContainText('UNKNOWN_SKU')
  const after = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)
  expect(after).toBe(before)
  await expect(page.getByRole('button', { name: /적용|Apply/ })).toHaveCount(0)
  await expect(page.getByText('Supabase 모드에서만 공유 저장할 수 있습니다.')).toBeVisible()
  await expect(page.getByRole('button', { name: '검증 결과 저장' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Master Excel 파일을 선택하세요')).toBeVisible()
  await expect(page.getByText('Master 분석 결과')).toHaveCount(0)
})

test('지원하지 않는 확장자와 필수 시트 누락을 구분한다', async ({ page }) => {
  await page.goto('/#/import/master')
  const picker = page.getByLabel('Master Excel 파일')
  await picker.setInputFiles({ name: 'wrong.csv', mimeType: 'text/csv', buffer: Buffer.from('not an xlsx') })
  await expect(page.getByRole('alert')).toContainText('.xlsx')
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['dummy']]), '다른시트')
  await picker.setInputFiles({ name: 'wrong-master.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer })
  await page.getByRole('button', { name: '분석 시작' }).click()
  await expect(page.getByText('SOURCE_SCHEMA_MISMATCH').first()).toBeVisible()
})

test('분석 중 다른 파일을 고르면 이전 파일의 결과를 표시하지 않는다', async ({ page }) => {
  await page.goto('/#/import/master')
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = function () {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        window.addEventListener('release-file-read', () => {
          read.call(this).then(resolve, reject)
        }, { once: true })
      })
    }
  })
  const picker = page.getByLabel('Master Excel 파일')
  const buffer = sanitizedMasterWorkbook()
  await picker.setInputFiles({ name: 'first.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
  await page.getByRole('button', { name: '분석 시작' }).click()
  await expect(page.getByRole('status')).toContainText('파일을 읽는 중')
  await picker.setInputFiles({ name: 'second.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })
  await page.evaluate(() => window.dispatchEvent(new Event('release-file-read')))
  await page.waitForTimeout(100)
  await expect(page.getByText('second.xlsx')).toBeVisible()
  await expect(page.getByText('Master 분석 결과')).toHaveCount(0)
  await expect(page.getByText('SHA-256')).toHaveCount(0)

  await page.getByRole('button', { name: '분석 시작' }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('release-file-read')))
  await expect(page.getByText('Master 분석 결과')).toBeVisible()
})
