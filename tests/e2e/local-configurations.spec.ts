import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'

test('구성 옵션별로 가격 확인 상태와 SKU를 표시한다',async({page})=>{
 const data=createSeedData(),product=data.products[0],channel=data.channels[0],sku=data.skus[0]
 const listing={...data.listings[0],channelId:channel.id},offer={...data.offers[0],listingId:listing.id,masterProductId:product.id,status:'ACTIVE' as const,optionName:'용기만',salePrice:9000}
 data.products=[product];data.channels=[channel];data.listings=[listing];data.offers=[offer];data.issues=[]
 const configurations=[{id:'c1',productId:product.id,name:'용기만',prices:{normal:null,regular:null,basic:null,medium:null,large:null,live:null,group:null},components:[{skuId:sku.id,quantity:2}]}]
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/employees')return route.fulfill({json:{employees:[]}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[{productId:product.id,values:{normal:30000,regular:20000,basic:18000,medium:17000,large:16000,live:1000,group:null},options:[]}]}})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations,bindings:[{offerId:offer.id,configurationId:'c1'}]}})
  return route.fulfill({status:404,json:{error:'not found'}})
 })
 await page.goto('/#/channels')
 const cell=page.getByRole('button',{name:`${product.productName}, ${channel.channelName} 상세`})
 await expect(cell.getByText('확인필요')).toBeVisible()
 await cell.click()
 await expect(page.getByText('연결된 구성: 용기만')).toBeVisible()
 await expect(page.getByText(`${sku.skuCode} × 2`)).toBeVisible()
 await expect(page.getByText(/원데이\/라이브 -/)).toBeVisible()
 await page.getByRole('button',{name:'닫기'}).click()
 await page.goto(`/#/products/${product.id}`)
 await page.getByRole('button',{name:'SKU 구성'}).click()
 await expect(page.getByRole('heading',{name:'상품 구성 옵션'})).toBeVisible()
 await expect(page.getByText('용기만',{exact:true})).toBeVisible()
})
