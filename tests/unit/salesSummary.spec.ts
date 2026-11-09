import {expect,test} from '@playwright/test'
import {groupBuyForMonth,groupSales,rankSalesChannels,salesAxis,salesChannelShares,salesTotal,trailingStart} from '../../src/features/sales/salesSummary'
import type {SalesDay} from '../../src/features/sales/types'

test('sales totals follow selected channel and ignore missing values',()=>{
 const days:SalesDay[]=[{date:'2026-10-31',total:100,channels:{A:60,B:40},sourceRow:1},{date:'2026-11-01',total:200,channels:{A:80,B:120},sourceRow:2},{date:'2026-11-02',total:30,channels:{A:null,B:30},sourceRow:3}]
 expect(salesTotal(days,'ALL')).toBe(330)
 expect(salesTotal(days,'A')).toBe(140)
 expect(salesTotal(days,'missing')).toBeNull()
 expect(groupSales(days,'ALL','month')).toEqual([{label:'2026-10',value:100},{label:'2026-11',value:230}])
 expect(groupSales(days,'A','day')[2].value).toBeNull()
})

test('trailing periods include the end date and handle month and leap-year boundaries',()=>{
 expect(trailingStart('2026-11-02',1)).toBe('2026-10-03')
 expect(trailingStart('2026-11-02',3)).toBe('2026-08-03')
 expect(trailingStart('2026-11-02',6)).toBe('2026-05-03')
 expect(trailingStart('2026-11-02',12)).toBe('2025-11-03')
 expect(trailingStart('2024-03-31',1)).toBe('2024-03-01')
})

test('related channels rank by combined sales but remain individually selectable',()=>{
 const days:SalesDay[]=[{date:'2026-11-01',total:0,sourceRow:1,channels:{'자사몰':1000,'스마트스토어':400,'스마트스토어(도착보장)':300,'쿠팡':20,'쿠팡(로켓배송)':500,'오늘의집':450,'기록없음':null}},{date:'2026-11-02',total:0,sourceRow:2,channels:{'오늘의집':900,'쿠팡':5}}]
 const channels=['쿠팡(로켓배송)','오늘의집','쿠팡','스마트스토어(도착보장)','스마트스토어','자사몰','기록없음']
 expect(rankSalesChannels(days.slice(0,1),channels).map(row=>row.name)).toEqual(['자사몰','스마트스토어','스마트스토어(도착보장)','쿠팡','쿠팡(로켓배송)','오늘의집','기록없음'])
 expect(rankSalesChannels(days.slice(1),channels).map(row=>row.name).slice(0,3)).toEqual(['오늘의집','쿠팡','쿠팡(로켓배송)'])
 expect(rankSalesChannels(days.slice(0,1),channels).find(row=>row.name==='쿠팡')?.value).toBe(20)
})

test('channel share keeps selected channels separate and rolls other channels together',()=>{
 const values={'스마트스토어':100,'스마트스토어(도착보장)':20,'쿠팡':10,'쿠팡(로켓배송)':80,A:90,B:70,C:60,D:50,E:40,F:30,G:20}
 const days:SalesDay[]=[{date:'2026-11-01',total:570,sourceRow:1,channels:values}]
 const result=salesChannelShares(days,Object.keys(values))
 expect(result.rows).toHaveLength(8)
 expect(result.rows[1]).toEqual({name:'스마트스토어',value:100})
 expect(result.rows[2]).toEqual({name:'스마트스토어(도착보장)',value:20})
 expect(result.rows.find(row=>row.name==='쿠팡')?.value).toBe(10)
 expect(result.rows.find(row=>row.name==='쿠팡(로켓배송)')?.value).toBe(80)
 expect(result.rows.at(-1)).toEqual({name:'기타 (etc)',value:360})
 expect(result.total).toBe(570)
 expect(salesChannelShares([{...days[0],channels:{A:-10}}],['A']).negative).toBe(true)
 expect(salesChannelShares([],['A']).total).toBe(0)
})

test('axis ticks cover sales and negative values with a zero baseline',()=>{
 expect(salesAxis([320000000]).ticks).toEqual([400000000,300000000,200000000,100000000,0])
 const axis=salesAxis([-300,700])
 expect(axis.lower).toBeLessThanOrEqual(-300)
 expect(axis.upper).toBeGreaterThanOrEqual(700)
 expect(axis.ticks).toContain(0)
})

test('group-buy subtraction uses selected dates and refuses unknown or invalid data',()=>{
 const days:SalesDay[]=[{date:'2026-10-30',total:100,channels:{},sourceRow:1,groupBuy:30,groupBuyPartial:true},{date:'2026-10-31',total:200,channels:{},sourceRow:2,groupBuy:50,groupBuyPartial:true}]
 expect(groupBuyForMonth(days,'2026-10')).toEqual({groupBuy:80,nonGroupBuy:220,partial:true})
 expect(groupBuyForMonth(days.slice(1),'2026-10')?.nonGroupBuy).toBe(150)
 expect(groupBuyForMonth(days,'2026-10-30')).toEqual({groupBuy:30,nonGroupBuy:70,partial:true})
 expect(groupBuyForMonth([{...days[0],groupBuy:null}],'2026-10')).toBeNull()
 expect(groupBuyForMonth([{...days[0],groupBuy:101}],'2026-10')).toBeNull()
})
