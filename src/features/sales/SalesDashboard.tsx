import {useEffect,useMemo,useRef,useState} from 'react'
import {EmptyState,PageHeader} from '../../components/ui'
import {formatMoney} from '../../lib/selectors'
import {rankSalesChannels,salesTotal,trailingStart} from './salesSummary'
import {SalesShare} from './SalesShare'
import {SalesExport} from './SalesExport'
import {SalesChart} from './SalesChart'
import {SalesMonthlyList} from './SalesMonthlyList'
import type {SalesSnapshot} from './types'
import './sales.css'

export function SalesDashboard({local}:{local:boolean}){
 const [snapshot,setSnapshot]=useState<SalesSnapshot|null>(null),[error,setError]=useState(false),[start,setStart]=useState(''),[end,setEnd]=useState(''),[preset,setPreset]=useState(''),[chartBy,setChartBy]=useState<'day'|'month'>('month'),[channel,setChannel]=useState('ALL'),[excludeGroup,setExcludeGroup]=useState(false)
 const [selectedDay,setSelectedDay]=useState<string|null>(null)
 const lastAsOf=useRef('')
 useEffect(()=>{if(!local)return;const controller=new AbortController();let busy=false
  const load=async()=>{if(busy)return;busy=true;try{const r=await fetch('/api/sales-dashboard',{credentials:'same-origin',cache:'no-store',signal:controller.signal});if(!r.ok)throw new Error('unavailable');const result=await r.json() as SalesSnapshot;const old=lastAsOf.current;lastAsOf.current=result.asOf;setSnapshot(result);setStart(current=>current||`${result.asOf.slice(0,7)}-01`);setEnd(current=>!current||current===old?result.asOf:current);setError(false)}catch{if(!controller.signal.aborted)setError(true)}finally{busy=false}}
  void load();const timer=window.setInterval(()=>void load(),15000);return ()=>{controller.abort();window.clearInterval(timer)}
 },[local])
 const channels=useMemo(()=>snapshot?[...new Set(snapshot.days.flatMap(day=>Object.keys(day.channels)))].sort((a,b)=>a.localeCompare(b,'ko-KR')):[],[snapshot])
 const days=useMemo(()=>snapshot?.days.filter(day=>!!start&&!!end&&day.date>=start&&day.date<=end)??[],[snapshot,start,end])
 const activeDay=chartBy==='day'&&selectedDay&&days.some(day=>day.date===selectedDay)?selectedDay:null
 const total=salesTotal(days,channel),latest=days.at(-1),latestAmount=latest?salesTotal([latest],channel):null
 const countedDays=days.filter(day=>channel==='ALL'||typeof day.channels[channel]==='number').length
 const rankedChannels=rankSalesChannels(days,channels)
 const channelTotals=rankedChannels.filter(row=>row.value!==null)
 const label=channel==='ALL'?'전체 채널':channel
 const groupDisagreements=snapshot?.warnings.filter(w=>w.type==='GROUP_BUY_SOURCE_MISMATCH'&&w.date&&w.date>=start&&w.date<=end)??[]
 if(!local)return <><PageHeader title="매출 대시보드" description="저장된 매출을 확인합니다." /><EmptyState title="로컬 매출 자료가 필요합니다" description="로컬 SellerAudit에서 확인해 주세요." /></>
 if(error&&!snapshot)return <><PageHeader title="매출 대시보드" /><div className="error-banner" role="alert">매출 자료를 불러오지 못했습니다. SellerAudit 실행 상태와 저장된 자료를 확인해 주세요. <button className="button button-small" onClick={()=>window.location.reload()}>다시 불러오기</button></div></>
 if(!snapshot)return <><PageHeader title="매출 대시보드" /><div className="panel sales-loading" role="status">매출 자료를 불러오는 중입니다.</div></>
 return <div className="sales-dashboard"><PageHeader title="매출 대시보드" description="기간과 채널별 매출을 확인합니다." />
  <div className="sales-source"><span className="sales-source-dot" /><span title={snapshot.sourcePath}>원본: {snapshot.sourceName}</span><strong>매출 기록 기준 {snapshot.asOf}까지</strong></div>
  {(error||snapshot.syncStatus==='error')&&<div className="error-banner" role="alert">원본 엑셀을 갱신하지 못해 마지막으로 확인된 매출을 표시합니다. 파일을 저장하고 형식과 수식을 확인해 주세요. 잠시 후 다시 시도합니다.</div>}
  <section className="panel sales-filter">
   <div className="sales-period"><span>조회 기간</span><div className="sales-period-controls">
    <label>시작일<input type="date" aria-label="시작일" value={start} max={end||snapshot.asOf} onChange={event=>{setStart(event.target.value);setPreset('');setSelectedDay(null)}} /></label><span>~</span>
    <label>종료일<input type="date" aria-label="종료일" value={end} min={start} max={snapshot.asOf} onChange={event=>{setEnd(event.target.value);setPreset('');setSelectedDay(null)}} /></label>
    <div className="sales-presets" aria-label="빠른 기간 선택">{[[1,'1개월'],[3,'3개월'],[6,'6개월'],[12,'1년']].map(([months,text])=><button type="button" key={months} aria-pressed={preset===String(months)} onClick={()=>{setEnd(snapshot.asOf);setStart(trailingStart(snapshot.asOf,Number(months)));setPreset(String(months));setSelectedDay(null)}}>{text}</button>)}</div>
   </div></div>
   <label>월별 조회<select aria-label="월별 조회" value={preset.startsWith('m:')?preset:''} onChange={event=>{const value=event.target.value;if(!value)return;const selected=value.slice(2);const last=new Date(Date.UTC(Number(selected.slice(0,4)),Number(selected.slice(5)),0)).toISOString().slice(0,10);setStart(`${selected}-01`);setEnd(last<snapshot.asOf?last:snapshot.asOf);setPreset(value);setSelectedDay(null)}}><option value="">월 선택</option>{snapshot.months.map(item=><option key={item.month} value={`m:${item.month}`}>{item.month}</option>)}</select></label>
   <label>채널<select aria-label="매출 채널" value={channel} onChange={event=>setChannel(event.target.value)}><option value="ALL">전체 채널</option>{rankedChannels.map(({name})=><option key={name} value={name}>{name}</option>)}</select></label><span>기록된 날짜 {days.length}일 · {label}</span>
  </section>
  <SalesExport snapshot={snapshot} start={start} end={end} channel={channel} excludeGroup={channel==='ALL'&&excludeGroup} setExcludeGroup={setExcludeGroup} />
  <div className="sales-kpis"><div className="panel sales-kpi"><span>선택 기간 매출</span><strong>{formatMoney(total)}</strong><small>{start} ~ {end} · {label}</small></div><div className="panel sales-kpi"><span>선택 기간 마지막 날</span><strong>{formatMoney(latestAmount)}</strong><small>{latest?.date??'기록 없음'} · {label}</small></div><div className="panel sales-kpi"><span>선택 기간 일평균</span><strong>{total===null||!countedDays?'—':formatMoney(Math.round(total/countedDays))}</strong><small>값이 기록된 {countedDays}일 기준</small></div></div>
  <div className="sales-panels"><SalesMonthlyList days={days} channel={channel} by={chartBy} excludeGroup={channel==='ALL'&&excludeGroup} />
   <section className="panel sales-channels"><div className="sales-panel-heading"><div><h2>채널별 매출</h2><p>선택 기간 · 전체 채널 비교</p></div></div>{channelTotals.length?<div className="sales-channel-list">{channelTotals.map(row=><div key={row.name} className={channel===row.name?'sales-channel-row selected':'sales-channel-row'}><button type="button" onClick={()=>setChannel(channel===row.name?'ALL':row.name)}>{row.name}</button><strong>{formatMoney(row.value)}</strong></div>)}</div>:<p className="sales-empty">표시할 채널 기록이 없습니다.</p>}</section><div className="sales-chart-stack"><SalesChart days={days} channel={channel} chartBy={chartBy} setChartBy={value=>{setChartBy(value);setSelectedDay(null)}} excludeGroup={channel==='ALL'&&excludeGroup} selectedDay={activeDay} onSelectDay={date=>setSelectedDay(current=>current===date?null:date)} /><SalesShare days={activeDay?days.filter(day=>day.date===activeDay):days} channels={channels} excludeGroup={channel==='ALL'&&excludeGroup} selectedDay={activeDay} onClearDay={()=>setSelectedDay(null)} /></div></div>
  <details className="sales-footnote"><summary>매출 집계 기준{groupDisagreements.length>0?` · 공동구매 금액 차이 ${groupDisagreements.length}일`:''}</summary><p>2024·2025년 매출은 가져온 월별 파일의 로우데이터 결제금액 합계이며, 공동구매 채널 구분은 확인할 수 없습니다. 월별 파일 변경 사항은 다시 가져와야 합니다. 2026년은 월별 매출 시트의 일별 합계를 사용합니다. 공동구매는 표시된 로우데이터의 쇼핑몰명과 결제금액을 우선 사용하고, 표시된 행이 없는 날짜는 기존 월별 자료를 사용합니다. 2026년 원본 엑셀을 저장하면 약 15초마다 변경을 확인합니다. 일별 합계 수식에 포함되지 않은 별도 집계 열은 더하지 않습니다.</p>{groupDisagreements.length>0&&<p>선택 기간에 공동구매 금액이 서로 다른 날짜가 있습니다. 로우데이터 금액을 사용합니다. {groupDisagreements.map(w=>`${w.date}: 로우 ${formatMoney(w.raw??null)}, 월별 ${formatMoney(w.monthly??null)}`).join(' · ')}</p>}</details>
 </div>
}
