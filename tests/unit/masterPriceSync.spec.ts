import {test,expect} from '@playwright/test'
import {hasUnverifiablePriceRegression,matchPriceRows,mergeSafePrices} from '../../server/business/masterPriceSync'
import type {WorkbookPriceRow} from '../../server/business/workbookPrices'

const values={cost:100,normal:200,regular:150,basic:140,medium:130,large:120,live:110,group:null}
const row=(row:number,code:string,name:string,channel='공통'):WorkbookPriceRow=>({row,code,name,channel,values:{...values}})
test('source prices match only when code, name, channel and SKU composition agree',()=>{
 const old=[row(6,'1','세트'),row(7,'2','구성 변경')],next=[row(25,'1','세트'),row(26,'2','구성 변경')]
 const before=[{productSourceRow:6,skuCode:'A',quantity:2},{productSourceRow:7,skuCode:'B',quantity:1}]
 const after=[{productSourceRow:25,skuCode:'A',quantity:2},{productSourceRow:26,skuCode:'B',quantity:2}]
 const plan=matchPriceRows(old,before,next,after)
 expect(plan.updates.get('1')?.byOldRow.get(6)?.row).toBe(25);expect(plan.updates.has('2')).toBe(false)
})
test('conflicting, unverified or missing prices do not erase existing values',()=>{
 const a=row(1,'1','상품'),b=row(2,'1','상품');a.values.normal=300;b.values.normal=300;a.values.basic=null;b.values.basic=null;b.values.live=999
 expect(mergeSafePrices(values,[a,b])).toMatchObject({normal:300,basic:140,live:110})
})
test('rejects a new snapshot when a previously verified price cannot be read',()=>{
 const previous=row(1,'1','상품'),current=row(1,'1','상품');current.values.regular=null
 expect(hasUnverifiablePriceRegression([previous],[current])).toBe(true)
 current.values.regular=160;expect(hasUnverifiablePriceRegression([previous],[current])).toBe(false)
})
