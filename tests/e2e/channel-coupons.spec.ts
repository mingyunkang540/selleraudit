import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'
import type {Coupon,CouponInput} from '../../src/features/channels/coupons'

test('채널 쿠폰 등록 후 판매가와 쿠폰가를 함께 보여준다',async({page})=>{
 await page.clock.install({time:new Date('2026-11-03T03:00:00Z')})
 const data=createSeedData(),product=data.products[0],channel=data.channels[0],listing={...data.listings[0],channelId:channel.id,status:'ACTIVE' as const},offer={...data.offers[0],listingId:listing.id,masterProductId:product.id,status:'ACTIVE' as const,salePrice:12345}
 data.products=[product];data.channels=[channel];data.listings=[listing];data.offers=[offer];data.issues=[]
 const values={cost:6000,normal:20000,regular:15000,basic:14000,medium:13000,large:12000,live:10000,group:null};let coupons:Coupon[]=[],fees=[{channelId:channel.id,rate:0}]
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[{productId:product.id,values,options:[]}]}})
  if(path==='/api/channel-coupons/shares'){const body=route.request().postDataJSON() as {channelShare:number;companyShare:number};coupons=coupons.map(c=>({...c,channelShare:body.channelShare,companyShare:body.companyShare}));return route.fulfill({json:{ok:true}})}
  if(path==='/api/channel-coupons/remove'){const body=route.request().postDataJSON() as {id:string};coupons=coupons.filter(c=>c.id!==body.id);return route.fulfill({json:{ok:true}})}
  if(path==='/api/channel-coupons'&&route.request().method()==='POST'){const body=route.request().postDataJSON() as {coupon:CouponInput};coupons=[...coupons,{...body.coupon,id:`coupon-${coupons.length}`}];return route.fulfill({json:{ok:true}})}
  if(path==='/api/channel-coupons')return route.fulfill({json:{coupons,revision:'r'}})
  if(path==='/api/channel-fees'&&route.request().method()==='POST'){const body=route.request().postDataJSON() as {channelId:string;rate:number};fees=[{channelId:body.channelId,rate:body.rate}];return route.fulfill({json:{ok:true}})}
  if(path==='/api/channel-fees')return route.fulfill({json:{fees,revision:'r'}})
  return route.fulfill({json:{employees:[]}})
 })
 await page.goto('/#/channels')
 await page.getByText('채널 행사 쿠폰 관리').click()
 await page.getByLabel('쿠폰 이름').fill('행사 테스트')
 await page.getByLabel('시작일').fill('2026-10-26')
 await page.getByLabel('종료일').fill('2026-11-08')
 await page.getByLabel('채널 부담 비율 (%)',{exact:true}).fill('50')
 await page.getByLabel('자사 부담 비율 (%)',{exact:true}).fill('50')
 await page.getByRole('button',{name:'쿠폰 저장'}).click()
 await expect(page.getByText('행사 테스트 적용 후 11,110원')).toBeVisible()
 await expect(page.locator('.matrix-channel-price strong')).toHaveText('12,345원')
 await expect(page.locator('.matrix-cell')).toContainText('예상 마진 5,727원')
 await page.locator('.matrix-cell').click()
 await expect(page.getByRole('dialog').getByText('11,110원')).toBeVisible()
 await expect(page.getByRole('dialog').getByText('618원',{exact:true})).toBeVisible()
 await page.getByRole('dialog').getByRole('button',{name:'닫기'}).click()
 await page.getByText('부담 비율 수정').click()
 await page.getByLabel('행사 테스트 채널 부담 비율').fill('25')
 await page.getByLabel('행사 테스트 자사 부담 비율').fill('75')
 await page.getByRole('button',{name:'부담 비율 저장'}).click()
 await expect(page.locator('.matrix-cell')).toContainText('예상 마진 5,419원')
 await page.getByText('채널 수수료 관리').click()
 await page.getByLabel(`${channel.channelName} 수수료율`).fill('10')
 await page.getByRole('button',{name:'저장',exact:true}).click()
 await expect(page.locator('.matrix-cell')).toContainText('예상 마진 4,308원')
 await page.getByLabel('쿠폰 이름').fill('추가 정액 쿠폰')
 await page.getByLabel('할인 방식').selectOption('FIXED')
 await page.getByRole('spinbutton',{name:'할인액 (원)'}).fill('1000')
 await page.getByLabel('채널 부담 비율 (%)',{exact:true}).fill('0')
 await page.getByLabel('자사 부담 비율 (%)',{exact:true}).fill('100')
 await page.getByRole('button',{name:'쿠폰 저장'}).click()
 await expect(page.getByText('쿠폰 적용 후 10,110원')).toBeVisible()
 await expect(page.locator('.matrix-cell')).toContainText('예상 마진 3,408원')
 await page.clock.setFixedTime(new Date('2026-11-09T00:00:00+09:00'))
 await page.clock.runFor(61000)
 await expect(page.getByText('행사 테스트 적용 후 11,110원')).toHaveCount(0)
 page.on('dialog',dialog=>void dialog.accept())
 await page.locator('.coupon-list li').filter({hasText:'행사 테스트'}).getByRole('button',{name:'삭제',exact:true}).click()
 await page.locator('.coupon-list li').filter({hasText:'추가 정액 쿠폰'}).getByRole('button',{name:'삭제',exact:true}).click()
 await page.getByLabel('쿠폰 이름').fill('정액 쿠폰')
 await page.getByLabel('시작일').fill('2026-11-09')
 await page.getByLabel('종료일').fill('2026-11-10')
 await page.getByLabel('할인 방식').selectOption('FIXED')
 await page.getByRole('spinbutton',{name:'할인액 (원)'}).fill('1500')
 await page.getByLabel('채널 부담 비율 (%)',{exact:true}).fill('25')
 await page.getByLabel('자사 부담 비율 (%)',{exact:true}).fill('75')
 await page.getByRole('button',{name:'쿠폰 저장'}).click()
 await expect(page.getByText('정액 쿠폰 적용 후 10,845원')).toBeVisible()
 await expect(page.locator('.coupon-list')).toContainText('1,500원 할인')
 await expect(page.locator('.matrix-cell')).toContainText('예상 마진 4,135원')
})
