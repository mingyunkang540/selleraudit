import {expect,test} from '@playwright/test'
import * as XLSX from 'xlsx'
import {parseSmartstoreRefresh} from '../../server/import/smartstoreRefresh'

test('스마트스토어 상품별 기본가, 옵션 추가금과 유효한 예약 할인을 계산한다',()=>{
 const header:string[]=[];Object.assign(header,{0:'상품번호',3:'상품명',5:'판매가',15:'옵션번호',16:'옵션값',17:'옵션가',19:'옵션 사용여부',57:'즉시할인 값',63:'예약 할인 기간'})
 const combo:unknown[]=[];Object.assign(combo,{0:'123',3:'세트',5:'10000',13:'조합형',15:'11\n12',16:'핑크\n아쿠아',17:'0\n2000',19:'Y\nN',57:'1000',58:'원',61:'2000',62:'원',63:'2026-11-01 00:00\n2026-11-08 23:59'})
 const single:unknown[]=[];Object.assign(single,{0:'456',3:'단품',5:'5000',13:'설정안함',57:'300',58:'원'})
 const wb=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([[],header,[],[],[],combo,single]);XLSX.utils.book_append_sheet(wb,sheet,'일괄수정')
 const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}) as Buffer
 const during=parseSmartstoreRefresh(bytes,Date.parse('2026-11-08T12:00:00+09:00'))
 expect(during[0].offers).toEqual([{optionCode:'11',name:'핑크',status:'ACTIVE',normal:10000,sale:8000},{optionCode:'12',name:'아쿠아',status:'INACTIVE',normal:12000,sale:10000}])
 expect(during[1].offers[0]).toMatchObject({optionCode:'BASE',normal:5000,sale:4700})
 expect(parseSmartstoreRefresh(bytes,Date.parse('2026-11-09T00:00:00+09:00'))[0].offers[1].sale).toBe(11000)
})
