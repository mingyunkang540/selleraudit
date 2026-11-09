import {formatMoney} from '../../lib/selectors'
import {groupSales,groupBuyForMonth} from './salesSummary'
import type {SalesDay} from './types'

export function SalesMonthlyList({days,channel,by,excludeGroup}:{days:SalesDay[];channel:string;by:'day'|'month';excludeGroup:boolean}){
 const rows=groupSales(days,channel,by).reverse()
 return <section className="panel sales-monthly"><div className="sales-panel-heading"><div><h2>{by==='day'?'일별 매출':'월별 매출'}</h2><p>선택 기간 · {channel==='ALL'?(excludeGroup?'기록된 공동구매 제외':'공동구매 포함'):'선택 채널 (공구 구분 자료 없음)'}</p></div></div>{rows.length?<div className="sales-monthly-list">{rows.map(row=>{const group=channel==='ALL'?groupBuyForMonth(days,row.label):null;return <div className="sales-monthly-row" key={row.label}><span>{row.label}</span><div className="sales-monthly-amount"><strong>{excludeGroup?(group?formatMoney(group.nonGroupBuy):'확인 필요'):formatMoney(row.value)}</strong>{channel==='ALL'&&!excludeGroup&&<small>{group?`(기록된 공구 제외 ${formatMoney(group.nonGroupBuy)})`:'(공구 제외 확인 필요)'}</small>}</div></div>})}</div>:<p className="sales-empty">선택한 기간에 매출 기록이 없습니다.</p>}</section>
}
