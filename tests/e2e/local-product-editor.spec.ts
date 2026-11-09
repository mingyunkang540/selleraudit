import {expect,test} from '@playwright/test'
import {createSeedData} from '../../src/mock'

test('상품을 추가하고 기존 상품의 가격과 SKU를 수정한다',async({page})=>{
 const data=createSeedData(),product=data.products[0],sku=data.skus[0]
 const rows=[{productId:product.id,values:{cost:1000,normal:3000,regular:2500,basic:2200,medium:null,large:null,live:2000,group:null},options:[]}]
 const writes:Record<string,unknown>[]=[]
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname
  if(path==='/api/auth/session')return route.fulfill({json:{openMode:true,user:{userId:'u',workspaceId:data.workspace.id,role:'ADMIN',email:'admin@example.com',displayName:'Admin'},csrf:'fake',importEnabled:true}})
  if(path==='/api/employees')return route.fulfill({json:{employees:[]}})
  if(path==='/api/data')return route.fulfill({json:data})
  if(path==='/api/product-prices')return route.fulfill({json:{products:rows}})
  if(path==='/api/product-configurations')return route.fulfill({json:{configurations:[],bindings:[]}})
  if(path==='/api/product-master'){writes.push(route.request().postDataJSON());return route.fulfill({json:{id:'saved'}})}
  return route.fulfill({status:404,json:{error:'not found'}})
 })
 await page.goto('/#/products')
 await page.getByRole('button',{name:'상품 추가'}).click()
 const drawer=page.getByRole('dialog')
 await drawer.getByRole('button',{name:'상품 저장'}).click()
 await expect(drawer.getByRole('alert')).toHaveText('판매상품명을 입력해 주세요.')
 await drawer.getByLabel('사방넷 품번').fill('NEW-1')
 await drawer.getByLabel('판매상품명').fill('새 상품')
 await drawer.getByRole('button',{name:'상품 저장'}).click()
 await expect(drawer.getByRole('alert')).toHaveText('SKU 추가를 눌러 구성 상품을 선택해 주세요.')
 await drawer.getByRole('button',{name:'SKU 추가'}).click()
 await drawer.getByRole('combobox',{name:'SKU 1'}).selectOption(sku.id)
 await drawer.getByLabel('정상가').fill('5000')
 await drawer.getByRole('button',{name:'상품 저장'}).click()
 await expect(drawer).toHaveCount(0)
 expect(writes[0]).toMatchObject({sabangnetCode:'NEW-1',productName:'새 상품',prices:{normal:5000},components:[{skuId:sku.id,quantity:1}]})
 await page.getByRole('button',{name:'상품 추가'}).click()
 await drawer.getByLabel('판매상품명').fill('품번과 가격 미정 상품')
 await drawer.getByRole('button',{name:'SKU 추가'}).click()
 await drawer.getByRole('combobox',{name:'SKU 1'}).selectOption(sku.id)
 await drawer.getByRole('button',{name:'상품 저장'}).click()
 await expect(drawer).toHaveCount(0)
 expect(writes[1]).toMatchObject({sabangnetCode:'',category:null,prices:{cost:null,normal:null,regular:null,basic:null,medium:null,large:null,live:null,group:null}})
 const row=page.locator('tbody tr').filter({hasText:product.sabangnetCode}).first()
 await row.getByRole('button',{name:'수정'}).click()
 await expect(drawer.getByLabel('정상가')).toHaveValue('3000')
 await drawer.getByLabel('판매상품명').fill('수정 상품')
 await drawer.getByRole('button',{name:'상품 저장'}).click()
 await expect(drawer).toHaveCount(0)
 expect(writes[2]).toMatchObject({id:product.id,expectedUpdatedAt:product.updatedAt,productName:'수정 상품',prices:{normal:3000}})
})
