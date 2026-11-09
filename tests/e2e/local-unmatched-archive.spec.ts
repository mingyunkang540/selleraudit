import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'
test('미매칭 품목을 선택해 확인 후 삭제한다',async({page})=>{
 const data=createSeedData(),offer=data.offers.find(o=>o.masterProductId===null&&o.status==='ACTIVE')
 if(!offer)throw new Error('Test needs an unmatched offer')
 data.offers=[offer];let archived=''
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
  if(path==='/api/mapping/archive-unmatched'){archived=route.request().postDataJSON().offerId;data.offers=[];return route.fulfill({json:{ok:true}})}
  return route.fulfill({status:404,json:{error:'not found'}})
 })
 await page.goto('/#/mapping')
 await page.getByRole('button',{name:'미매칭 품목 삭제'}).click()
 await expect(page.getByText('채널의 실제 상품은 변경되지 않으며 처리 기록은 보관됩니다.',{exact:false})).toBeVisible()
 await page.getByRole('button',{name:'삭제',exact:true}).click()
 await expect(page.getByText('매핑할 상품이 없습니다')).toBeVisible()
 expect(archived).toBe(offer.id)
})
