import {expect,test} from '@playwright/test'
import * as XLSX from 'xlsx'
import {planOwnedStore} from '../../server/import/ownedStorePlan'
import type {MasterImportPreview} from '../../src/types/import'

test('maps only verified optionless listings and preserves option listings for review',()=>{
 const data=[['상품코드','상품명','옵션사용','판매상태','진열상태','판매가','옵션입력'],['P0001','단품','N','Y','Y','12000.00',''],['P0002','옵션','Y','Y','Y','13000.00','색상{핑크|블루}'],['P0003','미연결','N','Y','Y','4000.00','']]
 const csv=Buffer.from(XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(data)))
 const sheet=XLSX.utils.aoa_to_sheet([]);sheet.AJ5={t:'s',v:'자사몰'};sheet.AJ6={t:'s',v:'P0001'};sheet.B6={t:'n',v:100};sheet.AJ7={t:'s',v:'P0002'};sheet.B7={t:'n',v:100};sheet['!ref']='A1:AJ7'
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'단가표');const master=XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer
 const preview={products:[{sabangnetCode:'100',productName:'마스터',productType:'SET',category:'용기',sourceRow:6}],bomComponents:[{productSourceRow:6,skuCode:'AL01',quantity:3}]} as unknown as MasterImportPreview
 const products=[{id:'id1',code:'100',name:'마스터',type:'SET',category:'용기',status:'ACTIVE',components:[{sku:'AL01',quantity:3}]}]
 const plan=planOwnedStore(csv,master,preview,products)
 expect(plan[0].masterProductId).toBe('id1');expect(plan[0].price).toBe(12000)
 expect(plan[1].hasOptions).toBe(true);expect(plan[1].masterProductId).toBeNull()
 expect(plan[2].masterProductId).toBeNull()
 expect(planOwnedStore(csv,master,preview,[{...products[0],components:[{sku:'AL01',quantity:4}]}])[0].masterProductId).toBeNull()
})
