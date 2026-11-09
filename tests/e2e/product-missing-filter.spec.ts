import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'

test('미입력 항목을 선택해 상품을 찾고 필터를 초기화한다',async({page})=>{
 const data=createSeedData()
 data.products=data.products.slice(0,3)
 const [complete,noCode,collection]=data.products
 complete.productName='완전한 상품';complete.category='세트'
 noCode.productName='품번 없는 상품';noCode.sabangnetCode='';noCode.category='세트'
 collection.productName='모음전 상품';collection.category='세트'
 const values={cost:0,normal:100,regular:90,basic:80,medium:70,large:60,live:50,group:null}
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-prices')return route.fulfill({json:{products:[{productId:complete.id,values,options:[]},{productId:noCode.id,values,options:[]},{productId:collection.id,values:null,options:[{name:'하나',values},{name:'둘',values:{...values,normal:null}}]}]}})
  if(path==='/api/catalog-extensions')return route.fulfill({json:{bundles:[],options:[],variants:[],assemblies:[]}})
  return route.fulfill({json:{employees:[]}})
 })
 await page.goto('/#/products')
 const filter=page.getByRole('combobox',{name:'미입력 항목'})
 await filter.selectOption('CODE')
 await expect(page.locator('tbody tr')).toHaveCount(1)
 await expect(page.locator('tbody tr')).toContainText('품번 없는 상품')
 await filter.selectOption('normal')
 await expect(page.locator('tbody tr')).toHaveCount(1)
 await expect(page.locator('tbody tr')).toContainText('모음전 상품')
 await filter.selectOption('ANY')
 await expect(page.locator('tbody tr')).toHaveCount(2)
 await page.getByRole('button',{name:'필터 초기화'}).click()
 await expect(page.locator('tbody tr')).toHaveCount(3)
})
