import {expect,test} from '@playwright/test'
import * as XLSX from 'xlsx'
import {analyzeMasterWorkbook} from '../../src/services/import'
import {planOhouse} from '../../server/import/ohousePlan'

test('채널 단일 단품만 정확한 상품 구성일 때 연결하고 추가·색상 옵션은 보류한다',async()=>{
  const master=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(sheet,[['사방넷품번','구분','카테고리','모델명','구성 상세',null,'구성수']],{origin:'B5'})
  XLSX.utils.sheet_add_aoa(sheet,[['1001','단품','냉동용기','상품','AL00 1개',null,1]],{origin:'B6'})
  XLSX.utils.sheet_add_aoa(sheet,[['오늘의집','오늘의집\n아쿠아'],['2001','2002']],{origin:'AM5'})
  const codes=XLSX.utils.aoa_to_sheet([[],[],[null,null,'상품명','옵션명','상품코드'],[null,'냉동용기'],[null,null,'상품','라벤더','AL00']])
  const legacy=XLSX.utils.aoa_to_sheet([[],[],['마스터 상품명',null,'사방넷 품번코드']])
  XLSX.utils.book_append_sheet(master,sheet,'단가표');XLSX.utils.book_append_sheet(master,codes,'코드DB');XLSX.utils.book_append_sheet(master,legacy,'상품DB')
  const masterBytes=XLSX.write(master,{type:'buffer',bookType:'xlsx'}) as Buffer
  const preview=await analyzeMasterWorkbook(masterBytes.buffer.slice(masterBytes.byteOffset,masterBytes.byteOffset+masterBytes.byteLength) as ArrayBuffer,'fixture.xlsx')
  const channel=XLSX.utils.book_new();XLSX.utils.book_append_sheet(channel,XLSX.utils.aoa_to_sheet([
    ['상품번호','상품명','옵션번호','옵션타입','옵션값1','옵션값2','옵션정상가','옵션판매가','사용상태'],
    ['2001','기본 상품',1,'필수옵션','단품',null,1000,900,'사용'],
    ['2002','색상 상품',2,'필수옵션','아쿠아',null,1000,900,'사용'],
    ['2002','색상 상품',3,'추가옵션','채반',null,500,400,'사용'],
  ]),'목록')
  const source=XLSX.write(channel,{type:'buffer',bookType:'xlsx'}) as Buffer
  const existing=[{id:'one',code:'1001',name:'상품',category:'냉동용기',type:'SINGLE',status:'ACTIVE',components:[{sku:'AL00',quantity:1}]}]
  const result=planOhouse(source,masterBytes,preview,existing)
  expect(result.map(row=>row.masterProductId)).toEqual(['one',null,null])
  expect(result[1].reason).toBe('옵션 구성 또는 색상 확인 필요')
  expect(result[2].reason).toBe('추가옵션 구성 확인 필요')
  expect(planOhouse(source,masterBytes,preview,[{...existing[0],components:[{sku:'AL00',quantity:2}]}])[0].masterProductId).toBeNull()
})
