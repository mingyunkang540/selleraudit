import {expect,test} from '@playwright/test'
import {readFile} from 'node:fs/promises'
import * as XLSX from 'xlsx'
import {createSeedData} from '../../src/mock'

test('선택한 쇼핑몰의 상품과 미매칭·미사용 옵션을 엑셀로 내려받는다',async({page})=>{
 const data=createSeedData(),channel=data.channels[0],other=data.channels[1],product=data.products[0]
 const listing={...data.listings[0],id:'listing-export',channelId:channel.id,channelProductId:'001234',productName:'다운로드 상품',status:'ACTIVE' as const}
 const noOptions={...listing,id:'listing-no-options',channelProductId:'000099',productName:'옵션 없는 상품'}
 const hidden={...listing,id:'listing-hidden',channelProductId:'000088',productName:'숨긴 옵션 상품'}
 const otherListing={...listing,id:'listing-other',channelId:other.id,channelProductId:'999999'}
 const offer={...data.offers[0],id:'offer-export',listingId:listing.id,channelOptionId:'000345',masterProductId:product.id,status:'ACTIVE' as const,salePrice:10000,normalPrice:12000}
 const unmatched={...offer,id:'offer-unmatched',channelOptionId:'000346',masterProductId:null,status:'INACTIVE' as const,optionName:'미사용 옵션'}
 const unbound={...offer,id:'offer-unbound',channelOptionId:'000347',optionName:'구성 미선택'}
 const otherOffer={...offer,id:'offer-other',listingId:otherListing.id}
 data.channels=[channel,other];data.products=[product];data.listings=[listing,noOptions,hidden,otherListing];data.offers=[offer,unmatched,unbound,otherOffer];data.listingIdsWithoutOffers=[noOptions.id];data.issues=[]
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[{id:'config-a',productId:product.id,name:'구성 A',components:[{skuId:data.skus[0].id,quantity:3}],prices:{basic:9100,medium:8200,large:7300,live:6400}}],bindings:[{offerId:offer.id,configurationId:'config-a'}]}})
  if(path==='/api/channel-coupons')return route.fulfill({json:{coupons:[{id:'f',channelId:channel.id,name:'정액',startDate:'2020-01-01',endDate:'2099-12-31',discountType:'FIXED',fixedAmount:1000,percent:0,minimum:null,maximum:null,rounding:'WON_NEAREST',productIds:null},{id:'p',channelId:channel.id,name:'정률',startDate:'2020-01-01',endDate:'2099-12-31',percent:10,minimum:null,maximum:null,rounding:'WON_NEAREST',productIds:null}],revision:'r'}})
  if(path==='/api/channel-fees')return route.fulfill({json:{fees:[],revision:'r'}})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[{productId:product.id,values:{basic:11111,medium:22222,large:33333,live:44444},options:[]}]}})
  return route.fulfill({json:{employees:[]}})
 })
 await page.goto('/#/channels')
 await expect(page.getByRole('button',{name:'상품 목록 엑셀 다운로드'})).toBeDisabled()
 await page.getByLabel('다운로드할 쇼핑몰').selectOption(channel.id)
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'상품 목록 엑셀 다운로드'}).click()
 const workbook=XLSX.read(await readFile(await (await pending).path()),{type:'buffer'})
 const rows=XLSX.utils.sheet_to_json<(string|number|null)[]>(workbook.Sheets['상품 옵션 목록'],{header:1,defval:null})
 expect(rows).toHaveLength(5)
 const mapped=rows.find(row=>row[4]==='000345'),unmapped=rows.find(row=>row[4]==='000346'),unselected=rows.find(row=>row[4]==='000347'),missing=rows.find(row=>row[1]==='000099')
 expect(mapped?.[1]).toBe('001234');expect(mapped?.[9]).toBe(10000);expect(mapped?.[10]).toBe(8000);expect(mapped?.[12]).toBe('매핑됨')
 expect(mapped?.[15]).toBe('구성 A');expect(mapped?.[16]).toBe(`${data.skus[0].skuCode} × 3`)
 expect(rows[0].slice(18,22)).toEqual(['기본 행사가','중형 행사가','대형 행사가','원데이/라이브 행사가'])
 expect(mapped?.slice(18,22)).toEqual([9100,8200,7300,6400])
 expect(unselected?.slice(18,22)).toEqual([null,null,null,null])
 expect(unmapped?.[6]).toBe('미사용');expect(unmapped?.[12]).toBe('미매칭')
 expect(missing?.[12]).toBe('옵션 정보 없음')
 expect(rows.some(row=>row[1]==='999999'||row[1]==='000088')).toBe(false)
})
