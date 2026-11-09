import {expect,test} from '@playwright/test'
import {calculateDiscounts} from '../../server/business/smartstoreDiscount'

test('calculates option surcharge and applies scheduled discount during Korean time period',()=>{
 const row:unknown[]=Array(64).fill('')
 row[5]='7800';row[15]='1\n2';row[17]='0\n1400';row[57]='300';row[58]='원';row[61]='400';row[62]='원';row[63]='2026-11-03 09:00\n2026-11-03 10:59'
 const get=(date:string)=>calculateDiscounts(row,Date.parse(date))
 expect(get('2026-11-03T08:59:59+09:00')?.get('2')).toEqual({normal:9200,sale:8900})
 expect(get('2026-11-03T09:00:00+09:00')?.get('2')).toEqual({normal:9200,sale:8800})
 expect(get('2026-11-03T10:59:59+09:00')?.get('1')).toEqual({normal:7800,sale:7400})
 expect(get('2026-11-03T11:00:00+09:00')?.get('1')).toEqual({normal:7800,sale:7500})
 row[62]='%';expect(get('2026-11-03T10:00:00+09:00')).toBeNull()
 row[63]='invalid';expect(get('2026-11-03T12:00:00+09:00')).toBeNull()
})
