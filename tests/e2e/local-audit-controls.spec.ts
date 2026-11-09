import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'

test('채널 상품명 검색과 표시된 이슈 선택 삭제',async({page})=>{
  const data=createSeedData(), listing=data.listings[0], issue=data.issues[0]
  listing.productName='베러베딩 테스트 상품'
  data.issues=[{...issue,id:'issue-1',productId:null,listingId:listing.id,offerId:null},{...issue,id:'issue-2',productId:null,listingId:listing.id,offerId:null},{...issue,id:'issue-3',productId:data.products[0].id,listingId:null,offerId:null}]
  let deleted:string[]=[]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
    if(path==='/api/data')return route.fulfill({json:data})
    if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
    if(path==='/api/issues/archive'){deleted=route.request().postDataJSON().issueIds;data.issues=data.issues.filter(item=>!deleted.includes(item.id));return route.fulfill({json:{archived:deleted.length}})}
    return route.fulfill({status:404,json:{error:'not found'}})
  })
  await page.goto('/#/audit')
  await page.getByPlaceholder('상품명, 품번, 이슈 내용 검색').fill('베러')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await page.getByRole('checkbox',{name:'표시된 이슈 전체 선택'}).check()
  page.once('dialog',dialog=>dialog.accept())
  await page.getByRole('button',{name:'선택 삭제 (2)'}).click()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  expect(deleted.sort()).toEqual(['issue-1','issue-2'])
  await page.getByPlaceholder('상품명, 품번, 이슈 내용 검색').clear()
  await expect(page.locator('tbody tr')).toHaveCount(1)
})
