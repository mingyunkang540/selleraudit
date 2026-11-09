import {expect,test} from '@playwright/test'
import {withHistoricalProducts,withHistoricalSales} from '../../server/business/historicalSales'
import type {SalesSnapshot} from '../../src/features/sales/types'

test('과거 자료를 기존 자료에 중복 없이 연결하고 원본 구분을 보존한다',()=>{
 const day=(date:string,total:number)=>({date,total,channels:{자사몰:total},sourceRow:1})
 const product=(date:string,category:string)=>({date,channel:'자사몰',category,product:'상품',color:'핑크',quantity:2,sourceRows:1})
 const history={schemaVersion:1,source:'과거 원본',files:[{month:'2024-01',file:'과거.xlsx'}],days:[day('2024-01-01',100)],productRows:[product('2024-01-01','구분 미입력')]}
 const current:SalesSnapshot={schemaVersion:1,sourceName:'2026.xlsx',sourceSha256:'abc',asOf:'2026-01-01',days:[day('2024-01-01',999),day('2026-01-01',300)],months:[{month:'2026-01',sourceSheet:'2026',summaryCached:null,dailyTotal:300,days:1}],warnings:[]}
 const merged=withHistoricalSales(current,history)
 expect(merged.days.map(row=>row.total)).toEqual([100,300])
 expect(merged.months.map(row=>row.month)).toEqual(['2024-01','2026-01'])
 const output=withHistoricalProducts({sourceName:'2026.xlsx',rows:[product('2024-01-01','단품'),product('2026-01-01','단품')]},history)
 expect(output.rows.map(row=>row.category)).toEqual(['구분 미입력','단품'])
 expect(current.days).toHaveLength(2)
})
