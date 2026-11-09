import { expect, test } from '@playwright/test'

test('local login shows staff management and a read-only empty workspace', async ({page})=>{
  let signedIn=false
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/login'){signedIn=true;return route.fulfill({json:{csrf:'fake'}})}
    if(path==='/api/auth/session')return signedIn ? route.fulfill({json:{user:{userId:'u',workspaceId:'w',role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake'}}) : route.fulfill({status:401,json:{error:'login'}})
    if(path==='/api/employees')return route.fulfill({json:{employees:[]}})
    if(path==='/api/data')return route.fulfill({json:{workspace:{id:'w',name:'Local Workspace',createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'},products:[],skus:[],components:[],channels:[],listings:[],offers:[],aliases:[],issues:[]}})
    return route.fulfill({status:404,json:{error:'not found'}})
  })
  await page.goto('/')
  await page.getByLabel('이메일').fill('admin@example.com')
  await page.getByLabel('비밀번호',{exact:true}).fill('example password')
  await page.getByRole('button',{name:'로그인',exact:true}).click()
  await expect(page.getByRole('heading',{name:'직원 관리'})).toBeVisible()
  await page.getByRole('button',{name:'상품 조회 화면 열기'}).click()
  await expect(page.getByRole('heading',{name:'대시보드'})).toBeVisible()
  await page.getByRole('link',{name:'상품 마스터',exact:true}).click()
  await expect(page.getByText('등록된 판매상품이 없습니다.')).toBeVisible()
})
