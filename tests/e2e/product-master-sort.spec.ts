import { expect,test } from '@playwright/test'
import { createSeedData } from '../../src/mock'
import { STORAGE_KEY } from '../../src/services/mockRepository'

test('상품 목록의 표시 개수와 전체 검색 결과 정렬을 바꿀 수 있다',async({page})=>{
  const data=createSeedData()
  const template=data.products[0]
  for(let i=1;i<=205;i++)data.products.push({...template,id:crypto.randomUUID(),sabangnetCode:String(800000+i),productName:`테스트 상품 ${String(i).padStart(3,'0')}`,normalPrice:i})
  await page.addInitScript(({key,value})=>localStorage.setItem(key,value),{key:STORAGE_KEY,value:JSON.stringify(data)})
  await page.goto('/#/products')
  await page.getByRole('searchbox',{name:'판매상품 검색'}).fill('테스트 상품')
  const rows=page.locator('.data-table tbody tr')
  const size=page.getByRole('combobox',{name:'한 페이지에 표시할 상품 수'})
  await expect(rows).toHaveCount(10)
  await size.selectOption('50');await expect(rows).toHaveCount(50)
  await size.selectOption('100');await expect(rows).toHaveCount(100)
  await size.selectOption('200');await expect(rows).toHaveCount(200)
  await page.getByRole('button',{name:'다음 페이지'}).click()
  await expect(rows).toHaveCount(5)
  await page.getByRole('button',{name:'판매상품 정렬'}).click()
  await expect(page.getByRole('columnheader',{name:'판매상품 정렬'})).toHaveAttribute('aria-sort','ascending')
  await expect(rows.first()).toContainText('테스트 상품 001')
  await expect(rows).toHaveCount(200)
  await page.getByRole('button',{name:'판매상품 정렬'}).click()
  await expect(rows.first()).toContainText('테스트 상품 205')
  await expect(page.getByRole('columnheader',{name:'판매상품 정렬'})).toHaveAttribute('aria-sort','descending')
  await size.selectOption('10')
  await page.getByRole('button',{name:'사방넷 품번 정렬'}).click()
  await expect(rows.first()).toContainText('800001')
  await page.getByRole('button',{name:'사방넷 품번 정렬'}).click()
  await expect(rows.first()).toContainText('800205')
})

test('좁은 화면에서 상품 표를 키보드로 가로 이동할 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/products')
  const region = page.getByRole('region', { name: '표 가로 이동' })
  await expect(page.getByText('표를 좌우로 이동해 더 보기', { exact: false })).toBeVisible()
  await expect(region).toHaveAttribute('tabindex', '0')
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
})
