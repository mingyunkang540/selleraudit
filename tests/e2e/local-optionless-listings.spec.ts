import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'
test('삭제된 옵션만 있는 상품은 옵션 자료 필요 안내에서 제외한다',async({page})=>{
 const data=createSeedData(),listing=data.listings[0]
 data.listings=[{...listing,id:'no-source',productName:'실제 옵션 자료 없음',status:'ACTIVE'},{...listing,id:'removed',productName:'삭제한 옵션 상품',status:'ACTIVE'}]
 data.offers=[];data.listingIdsWithoutOffers=['no-source']
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[]}})
  return route.fulfill({status:404,json:{error:'not found'}})
 })
 await page.goto('/#/channels')
 await page.getByText('옵션 상세 자료가 필요한 채널 상품 1개').click()
 await expect(page.getByText('실제 옵션 자료 없음')).toBeVisible()
 await expect(page.getByText('삭제한 옵션 상품')).toHaveCount(0)
})
