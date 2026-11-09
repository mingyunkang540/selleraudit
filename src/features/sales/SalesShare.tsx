import {formatMoney} from '../../lib/selectors'
import {salesChannelShares} from './salesSummary'
import type {SalesDay} from './types'

const colors=['#7651bf','#1683a5','#e9952d','#23916d','#e36c79','#526fc9','#ae6199','#9aa5b5']

export function SalesShare({days,channels,excludeGroup,selectedDay,onClearDay}:{days:SalesDay[];channels:string[];excludeGroup:boolean;selectedDay:string|null;onClearDay:()=>void}){
 const unavailable=excludeGroup&&days.some(day=>!day.groupBuyChannels)
 const adjusted=excludeGroup&&!unavailable?days.map(day=>({...day,channels:Object.fromEntries(Object.entries(day.channels).map(([name,value])=>[name,value===null?null:value-(day.groupBuyChannels?.[name]??0)]))})):days
 const {rows,total,negative}=salesChannelShares(adjusted,channels)
 const stops=rows.map((row,index)=>{const from=rows.slice(0,index).reduce((sum,item)=>sum+(item.value??0),0)/total*100;return `${colors[index]} ${from}% ${from+(row.value??0)/total*100}%`}).join(', ')
 return <section className="panel sales-share"><div className="sales-panel-heading"><div><h2>채널별 매출 비중</h2><p>{selectedDay?`${selectedDay} · 전체 채널 기준`:'선택 기간 · 전체 채널 기준'}{excludeGroup?' · 기록된 공동구매 제외':''}</p></div>{selectedDay&&<button type="button" className="sales-clear-day" onClick={onClearDay}>날짜 선택 해제</button>}</div>
  {unavailable?<p className="sales-empty" role="status">선택 기간에 채널이나 금액을 확인할 수 없는 공동구매가 있습니다. 원본 로우데이터의 공동구매 여부와 쇼핑몰명, 월별 매출 자료를 확인해 주세요.</p>:negative?<p className="sales-empty">마이너스 매출이 있는 채널은 원형 그래프로 표시할 수 없습니다. 채널별 매출 금액을 확인해 주세요.</p>:!total?<p className="sales-empty">선택한 기간에 표시할 채널 매출이 없습니다.</p>:<>
   <div className="sales-share-content"><div className="sales-donut" role="img" aria-label={`전체 채널 매출 ${formatMoney(total)}. 채널별 비율은 옆 목록에 표시됩니다.`} style={{background:`conic-gradient(${stops})`}}><div className="sales-donut-center" aria-hidden="true"><span>전체 채널 매출</span><strong>{formatMoney(total)}</strong></div></div>
    <ul className="sales-share-legend">{rows.map((row,index)=><li key={row.name}><span className="sales-share-name"><span className="sales-share-color" style={{background:colors[index]}} />{row.name}</span><span>{row.value===null?'기록 없음':`${(row.value/total*100).toFixed(1)}%`} <small>{formatMoney(row.value)}</small></span></li>)}</ul></div>
   <p className="sales-share-note">지정한 7개 채널을 각각 표시하고 나머지 채널은 기타로 합산합니다.{excludeGroup&&' 엑셀에 기록된 공동구매만 제외합니다.'}</p>
  </>}
 </section>
}
