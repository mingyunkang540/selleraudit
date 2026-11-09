import { expect,test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { analyzeMasterWorkbook } from '../../src/services/import'
import { expandedCatalogPlan } from '../../server/import/expandedCatalogPlan'

test('expanded plan keeps valid products and excludes conflicting SKU dependencies',async()=>{
  const book=XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],[],[],[],[null,'사방넷품번','구분','카테고리','모델명','구성 상세',null,'구성수'],[null,'1001','단품','냉동용기','상품 A','AL00 1개',null,1],[null,'1002','단품','냉동용기','상품 B','AL01 1개',null,1]]),'단가표')
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],[],[null,null,'상품명','옵션명','상품코드'],[null,'냉동용기'],[null,null,'모델 A','라벤더','AL00'],[null,null,'모델 B','라벤더','AL01']]),'코드DB')
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],[],['마스터 상품명',null,'사방넷 품번코드']]),'상품DB')
  const preview=await analyzeMasterWorkbook(XLSX.write(book,{type:'array',bookType:'xlsx'}) as ArrayBuffer,'fixture.xlsx')
  const plan=expandedCatalogPlan(preview,{unlistedRows:[],collections:[]},[],[{code:'AL01',name:'다른 모델',color:'라벤더',status:'ACTIVE'}])
  expect(plan.products.map(p=>p.product.sabangnetCode)).toEqual(['1001'])
  expect(plan.skus.map(s=>s.skuCode)).toEqual(['AL00'])
  expect(plan.excluded.map(p=>p.row)).toEqual([7])
  expect(plan.excluded[0].reasons.join(' ')).toContain('AL01')
  const existing=expandedCatalogPlan(preview,{unlistedRows:[],collections:[]},[{code:'1001',name:'기존 상품',category:'냉동용기',type:'SINGLE',status:'ACTIVE',components:[{sku:'AL00',quantity:1}]}],[])
  expect(existing.excluded.map(p=>p.row)).toContain(6)
})
