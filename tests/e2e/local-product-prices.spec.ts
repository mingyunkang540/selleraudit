import { expect,test } from '@playwright/test'
import { createSeedData } from '../../src/mock'

test('행사가 선택에 따라 표시 가격이 바뀌고 모음전 가격은 옵션별로 표시된다',async({page})=>{
  const data=createSeedData();const product=data.products[0];const collection=data.products[1]
  const values={cost:5940,normal:13300,regular:12900,basic:11300,medium:10600,large:9900,live:9300,group:null}
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
    if(path==='/api/employees')return route.fulfill({json:{employees:[]}})
    if(path==='/api/data')return route.fulfill({json:data})
    if(path==='/api/catalog-extensions')return route.fulfill({json:{bundles:[],options:[],variants:[],assemblies:[]}})
    if(path==='/api/product-prices')return route.fulfill({json:{source:'원본',syncWarning:false,syncUpdated:6,syncSkipped:2,products:[{productId:product.id,values,options:[]},{productId:collection.id,values:null,options:[{name:'옵션 A',values},{name:'옵션 B',values:{...values,basic:12000}}]}]}})
    return route.fulfill({status:404,json:{error:'not found'}})
  })
  await page.goto('/#/products')
  await expect(page.getByText(/마스터파일 가격 반영: 6개 상품/)).toContainText('원본 품번 2개')
  const row=page.locator('tbody tr').filter({hasText:product.sabangnetCode})
  await expect(row).toContainText('5,940원');await expect(row).toContainText('13,300원');await expect(row).toContainText('12,900원');await expect(row).toContainText('11,300원')
  await page.getByRole('combobox',{name:'행사가'}).selectOption('medium')
  await expect(row).toContainText('10,600원');await expect(row).not.toContainText('11,300원')
  await page.getByRole('combobox',{name:'행사가'}).selectOption('live');await expect(row).toContainText('9,300원')
  const options=page.locator('tbody tr').filter({hasText:collection.sabangnetCode}).locator('td').nth(7).locator('details')
  await options.locator('summary').click();await expect(options).toContainText('옵션 A');await expect(options).toContainText('9,300원')
  await page.getByRole('link',{name:new RegExp(collection.productName)}).first().click()
  await expect(page.locator('.product-hero')).toContainText('옵션별')
})

test('상품 상세에서 가격 조회 오류를 미입력과 구분한다',async({page})=>{
  const data=createSeedData();const product=data.products[0]
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname
    if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake'}})
    if(path==='/api/data')return route.fulfill({json:data})
    if(path==='/api/product-prices')return route.fulfill({status:503,json:{error:'unavailable'}})
    if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
    return route.fulfill({status:404,json:{error:'not found'}})
  })
  await page.goto('/#/products/'+product.id)
  await expect(page.locator('.product-hero')).toContainText('확인 불가')
})
