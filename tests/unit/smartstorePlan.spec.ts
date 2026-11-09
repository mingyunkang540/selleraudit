import {expect,test} from '@playwright/test'
import * as XLSX from 'xlsx'
import {planSmartstore} from '../../server/import/smartstorePlan'
import type {MasterImportPreview} from '../../src/types/import'

test('smartstore imports base products only when option details are absent and master BOM matches',()=>{
  const sheet=XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(sheet,[['네이버']],{origin:'AL5'});XLSX.utils.sheet_add_aoa(sheet,[['123']],{origin:'AL6'});XLSX.utils.sheet_add_aoa(sheet,[['100']],{origin:'B6'})
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'단가표')
  const master=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}) as Buffer
  const csv=Buffer.from('상품번호(스마트스토어),상품명,판매상태,옵션,추가상품,판매가,할인가\n123,상품,판매중,N,N,10000,9000\n124,옵션상품,판매중,Y,N,10000,9000\n')
  const preview={products:[{sabangnetCode:'100',productName:'상품',productType:'SINGLE',category:null,sourceRow:6}],bomComponents:[{productSourceRow:6,skuCode:'A01',quantity:1}]} as unknown as MasterImportPreview
  const current=[{id:'product',code:'100',name:'상품',type:'SINGLE' as const,category:null,status:'ACTIVE',components:[{sku:'A01',quantity:1}]}]
  const result=planSmartstore(csv,master,preview,current)
  expect(result).toHaveLength(2);expect(result[0].masterProductId).toBe('product');expect(result[0].salePrice).toBe(9000);expect(result[1].hasOptions).toBe(true);expect(result[1].masterProductId).toBeNull()
  expect(()=>planSmartstore(Buffer.concat([csv,Buffer.from('123,중복,판매중,N,N,100,100\n')]),master,preview,current)).toThrow()
})
