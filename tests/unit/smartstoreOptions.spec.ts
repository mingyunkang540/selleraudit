import {expect,test} from '@playwright/test'
import * as XLSX from 'xlsx'
import {planSmartOptions} from '../../server/import/smartstoreOptions'
import type {MasterImportPreview} from '../../src/types/import'

test('preserves option IDs and leaves surcharge prices unknown',()=>{
 const sheet=XLSX.utils.aoa_to_sheet([])
 XLSX.utils.sheet_add_aoa(sheet,[['상품번호']],{origin:'A2'});XLSX.utils.sheet_add_aoa(sheet,[['옵션번호','옵션값','옵션가','옵션 재고수량','옵션 사용여부']],{origin:'P2'})
 XLSX.utils.sheet_add_aoa(sheet,[['123','','','상품','','10000','','','','','','','','조합형','색상','10\n11','핑크\n아쿠아','0\n2000','3\n0','Y\nN']],{origin:'A6'})
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'일괄수정');const source=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}) as Buffer
 const csv=Buffer.from('상품번호(스마트스토어),판매가,할인가\n123,10000,9000\n')
 const preview={products:[{sabangnetCode:'100',productName:'상품',productType:'SINGLE',category:null,sourceRow:6}],bomComponents:[{productSourceRow:6,skuCode:'A01',quantity:1}]} as unknown as MasterImportPreview
 const products=[{id:'product',code:'100',name:'상품',type:'SINGLE' as const,category:null,status:'ACTIVE',components:[{sku:'A01',quantity:1}]}]
 const result=planSmartOptions(source,[{id:'123',hasOptions:true,candidateCode:'100'}],csv,preview,products)
 expect(result.options.map(o=>[o.optionCode,o.status,o.salePrice,o.masterProductId])).toEqual([['10','ACTIVE',9000,'product'],['11','INACTIVE',null,null]])
})
