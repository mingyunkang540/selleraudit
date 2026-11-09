import { expect,test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { correctWorkbook } from '../../server/import/correctWorkbook'

function fixture():Buffer {
  const book=XLSX.utils.book_new()
  const sheet=XLSX.utils.aoa_to_sheet([[],[],[],[],[],['',null,'단품','냉동용기','점보','AL00 1개',null,1]])
  sheet.B6={t:'s',v:''}; sheet.I6={t:'n',v:3,f:'1+2'}; sheet['!ref']='A1:I6'
  XLSX.utils.book_append_sheet(book,sheet,'단가표')
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([[],[],[],['','', '점보','색상','AL00']]),'코드DB')
  return XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer
}

test('correction creates new bytes, preserves original and rejects stale or unsupported edits',()=>{
  const original=fixture();const saved=Buffer.from(original)
  const edit={sheet:'단가표' as const,address:'B6',before:'',after:'001005'}
  const corrected=correctWorkbook(original,[edit])
  expect(original.equals(saved)).toBe(true)
  const workbook=XLSX.read(corrected,{type:'buffer',cellFormula:true})
  expect(workbook.Sheets['단가표'].B6.v).toBe('001005')
  expect(workbook.Sheets['단가표'].I6.f).toBe('1+2')
  expect(()=>correctWorkbook(original,[{...edit,before:'wrong'}])).toThrow('Source changed')
  expect(()=>correctWorkbook(original,[{...edit,address:'I6'}])).toThrow('Invalid cell')
  expect(()=>correctWorkbook(original,[{...edit,address:'H6',before:'1',after:'-1'}])).toThrow('Invalid quantity')
  expect(()=>correctWorkbook(original,[edit,edit])).toThrow('Duplicate cell')
})

test('adds an explicitly specified new SKU without changing the original and rejects duplicate codes',()=>{
  const original=fixture()
  const sku={category:'기타',skuCode:'TEST99',modelName:'테스트',color:'파랑'}
  const corrected=correctWorkbook(original,[],[sku])
  const sheet=XLSX.read(corrected,{type:'buffer'}).Sheets['코드DB']
  expect(sheet.B6.v).toBe('기타')
  expect(sheet.C7.v).toBe('테스트')
  expect(sheet.E7.v).toBe('TEST99')
  expect(()=>correctWorkbook(original,[],[{...sku,skuCode:'AL00'}])).toThrow('Invalid new SKU')
  expect(()=>correctWorkbook(original,[],[sku,sku])).toThrow('Invalid new SKU')
})

test('excluding a product row preserves the original and prevents simultaneous edits',()=>{
  const original=fixture();const saved=Buffer.from(original)
  const result=correctWorkbook(original,[],[],[{sheet:'단가표',row:6}])
  const sheet=XLSX.read(result,{type:'buffer'}).Sheets['단가표']
  for(const col of ['B','C','D','E','F','H'])expect(sheet[`${col}6`]?.v).toBeUndefined()
  expect(sheet.I6.f).toBe('1+2')
  expect(original.equals(saved)).toBe(true)
  expect(()=>correctWorkbook(original,[{sheet:'단가표',address:'B6',before:'',after:'A1'}],[],[{sheet:'단가표',row:6}])).toThrow('Cannot edit an excluded row')
})
