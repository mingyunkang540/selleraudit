import { expect,test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { extractWorkbookPrices } from '../../server/business/workbookPrices'

test('master price extraction preserves source amounts and rejects stale formula caches',()=>{
  const book=XLSX.utils.book_new()
  const sheet=XLSX.utils.aoa_to_sheet([[],[],[],[],[null,'사방넷품번',null,null,'모델명',null,null,null,null,null,null,null,null,null,null,null,null,'총원가','정상가','상시가',null,'기본행사가']])
  XLSX.utils.sheet_add_aoa(sheet,[[null,'1001',null,null,'상품',null,null,null,null,null,null,null,null,null,null,null,null,500,1000,900,null,800]],{origin:'A6'})
  sheet.T6={t:'n',v:900,f:'ROUNDDOWN(S6*(1-XLOOKUP(S6,가격DB!$A$2:$A$35,가격DB!$B$2:$B$35,,-1)),-2)'}
  sheet.V6={t:'n',v:800,f:'ROUNDDOWN(S6*(1-XLOOKUP(S6,가격DB!$A$2:$A$35,가격DB!$C$2:$C$35,,-1)),-2)'}
  const discounts=XLSX.utils.aoa_to_sheet([[],['정상가','상시','기본'],[1000,0.1,0.2]])
  XLSX.utils.book_append_sheet(book,sheet,'단가표');XLSX.utils.book_append_sheet(book,discounts,'가격DB')
  const read=()=>extractWorkbookPrices(XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer)
  expect(read()[0]).toMatchObject({code:'1001',name:'상품',values:{cost:500,normal:1000,regular:900,basic:800,medium:null}})
  sheet.V6.v=700
  expect(read()[0].values.basic).toBeNull()
  sheet.V6.f='SUM(700)'
  expect(read()[0].values.basic).toBeNull()
  sheet.R5.v='다른 원가'
  expect(read).toThrow('Price workbook layout changed')
})
