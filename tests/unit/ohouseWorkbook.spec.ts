import {expect,test} from '@playwright/test'
import * as XLSX from 'xlsx'
import {parseOhouseWorkbook} from '../../server/import/ohouseWorkbook'

test('오늘의집 파일은 상품별 필수·추가 옵션과 사용 상태를 보존한다',()=>{
  const book=XLSX.utils.book_new()
  const sheet=XLSX.utils.aoa_to_sheet([
    ['상품번호','상품명','옵션번호','옵션타입','옵션값1','옵션값2','옵션정상가','옵션판매가','사용상태'],
    ['100','상품',123,'필수옵션','아쿠아','',10000,9000,'사용'],
    ['100','상품',124,'추가옵션','채반','',3000,2500,'미사용'],
  ])
  XLSX.utils.book_append_sheet(book,sheet,'목록')
  const read=()=>parseOhouseWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}) as Buffer)
  expect(read()).toMatchObject([{productCode:'100',optionCode:'123',optionType:'필수옵션',optionName:'아쿠아',status:'ACTIVE',normalPrice:10000,salePrice:9000},{productCode:'100',optionCode:'124',optionType:'추가옵션',optionName:'채반',status:'INACTIVE'}])
  sheet.C3.v=123
  expect(read).toThrow('Duplicate channel option')
})
