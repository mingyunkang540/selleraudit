import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'

test('판매가와 총원가로 옵션별 예상 마진을 표시하고 가격 미입력을 구분한다',async({page})=>{
 const data=createSeedData(),product=data.products[0],channel=data.channels[0],listing={...data.listings[0],channelId:channel.id,status:'ACTIVE' as const}
 const one={...data.offers[0],id:'one',listingId:listing.id,masterProductId:product.id,status:'ACTIVE' as const,salePrice:10000}
 const two={...one,id:'two',salePrice:5000}
 data.products=[product];data.channels=[channel];data.listings=[listing];data.offers=[one,two];data.issues=[]
 const values={cost:6000 as number|null,normal:20000,regular:15000,basic:14000,medium:13000,large:12000,live:1000,group:null}
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[{productId:product.id,values,options:[]}]}})
  if(path==='/api/channel-coupons')return route.fulfill({json:{coupons:[],revision:'r'}})
  if(path==='/api/channel-fees')return route.fulfill({json:{fees:[],revision:'r'}})
  return route.fulfill({json:{employees:[]}})
 })
 await page.goto('/#/channels')
 await page.getByText('채널 수수료 관리').click()
 await expect(page.getByText('기본 0%')).toBeVisible()
 const cell=page.getByRole('button',{name:`${product.productName}, ${channel.channelName} 상세`})
 await expect(cell).toContainText('예상 마진 -1,000원 ~ 4,000원')
 await cell.click()
 await expect(page.getByRole('dialog').getByText('4,000원',{exact:true})).toBeVisible()
 await expect(page.getByRole('dialog').getByText('-1,000원',{exact:true})).toBeVisible()
 data.offers=[one,{...two,salePrice:null}]
 await page.reload()
 await expect(page.getByRole('button',{name:`${product.productName}, ${channel.channelName} 상세`})).toContainText('예상 마진 판매가 확인 필요')
 values.cost=null
 await page.reload()
 await expect(page.getByRole('button',{name:`${product.productName}, ${channel.channelName} 상세`})).toContainText('예상 마진 총원가 확인 필요')
})
