import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'
test('최종 판매가를 상시가와 비교해 행사 상태를 표시하고 필터링한다',async({page})=>{
 const data=createSeedData(),product=data.products[0],listing=data.listings[0],channel=data.channels.find(c=>c.id===listing.channelId)!,original=data.offers.find(o=>o.listingId===listing.id)!
 data.channels=[channel];data.listings=[{...listing,status:'ACTIVE'}];data.offers=[{...original,status:'ACTIVE',masterProductId:product.id,salePrice:9000}]
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[{productId:product.id,values:{normal:15000,regular:10000,basic:9000,medium:null,large:null,live:8000,group:null,cost:5000},options:[]}]}})
  if(path==='/api/channel-coupons')return route.fulfill({json:{coupons:[],revision:'x'}})
  if(path==='/api/channel-fees')return route.fulfill({json:{fees:[],revision:'x'}})
  return route.fulfill({status:404,json:{error:'not found'}})
 })
 await page.goto('/#/channels')
 const cell=page.getByRole('button',{name:`${product.productName}, ${channel.channelName} 상세`})
 await expect(cell).toContainText('판매 상태: 행사중')
 await page.getByLabel('셀 상태').selectOption('PROMOTION')
 await expect(cell).toBeVisible()
 await cell.click()
 await expect(page.getByText('판매 상태: 행사중',{exact:true}).last()).toBeVisible()
})
