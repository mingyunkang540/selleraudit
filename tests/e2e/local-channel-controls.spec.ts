import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'

test('채널 표시 선택과 마스터 행사가 선택이 매트릭스에 반영된다',async({page})=>{
 const data=createSeedData(),product=data.products[0];data.channels=data.channels.slice(0,2)
 const channels=data.channels
 data.listings=data.listings.filter(l=>channels.some(c=>c.id===l.channelId))
 data.offers=data.offers.filter(o=>data.listings.some(l=>l.id===o.listingId))
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/employees')return route.fulfill({json:{employees:[]}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[{productId:product.id,values:{normal:30000,regular:20000,basic:18000,medium:17000,large:16000,live:15000,group:14000},options:[]}]}})
  return route.fulfill({status:404,json:{error:'not found'}})
 })
 await page.goto('/#/channels')
 const row=page.locator('tbody tr').filter({has:page.getByRole('link',{name:product.productName,exact:true})}).first()
 await expect(row.getByText('20,000원').first()).toBeVisible()
 await expect(row.getByText('18,000원').first()).toBeVisible()
 await page.getByLabel('행사가',{exact:true}).selectOption('live')
 await expect(row.getByText('15,000원').first()).toBeVisible()
 await expect(row.getByText('20,000원').first()).toBeVisible()
 await page.getByText('채널 선택 (2/2)').click()
 await page.getByRole('checkbox',{name:channels[1].channelName}).uncheck()
 await expect(page.locator('thead').getByText(channels[1].channelName)).toHaveCount(0)
 await expect(page.locator('thead').getByText(channels[0].channelName)).toBeVisible()
 await page.getByRole('button',{name:'전체 선택'}).click()
 await expect(page.locator('thead').getByText(channels[1].channelName)).toBeVisible()
 await page.getByText('가격 상태와 예상 마진 기준').click()
 await expect(page.getByText(/쿠폰 적용 후 최종가가 상시가보다 낮으면 행사중/)).toBeVisible()
 await page.getByPlaceholder('상품명, 사방넷 품번, SKU 검색').fill('일치하지 않는 상품명')
 await expect(page.getByText('조건에 맞는 상품이 없습니다')).toBeVisible()
 await page.getByRole('button',{name:'검색·상태 초기화'}).click()
 await expect(row).toBeVisible()
})
