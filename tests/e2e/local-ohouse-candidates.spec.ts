import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'
import {asChannelCode} from '../../src/types/domain'

test('오늘의집 번호 일치 후보에 옵션 색상 검토 안내를 표시한다',async({page})=>{
  const data=createSeedData();const product=data.products[0];const channel={...data.channels[0],channelCode:asChannelCode('OHOUSE'),channelName:'오늘의집'}
  const listing={...data.listings[0],channelId:channel.id,channelProductId:'2001'}
  const offer={...data.offers[0],listingId:listing.id,channelOptionId:'123',optionName:'아쿠아',masterProductId:null,status:'ACTIVE' as const}
  data.channels=[channel];data.listings=[listing];data.offers=[offer]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
    if(path==='/api/employees')return route.fulfill({json:{employees:[]}})
    if(path==='/api/data')return route.fulfill({json:data})
    if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
    if(path==='/api/ohouse-candidates')return route.fulfill({json:{candidates:[{productCode:'2001',optionCode:'123',candidateCode:product.sabangnetCode}]}})
    return route.fulfill({status:404,json:{error:'not found'}})
  })
  await page.goto('/#/mapping')
  await expect(page.getByText('마스터 상품번호 기준 후보')).toBeVisible()
  await expect(page.getByText('채널 상품번호가 일치하는 후보입니다. 옵션 색상과 구성이 같은지 확인해 주세요.')).toBeVisible()
  await expect(page.getByText('기준 상품을 연결해도 옵션의 SKU 구성은 자동으로 확정되지 않습니다. 구성과 추가옵션 여부를 확인해 주세요.')).toBeVisible()
})
