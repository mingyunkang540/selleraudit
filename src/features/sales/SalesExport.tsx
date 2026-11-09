import {useState} from 'react'
import {downloadSalesExcel} from './buildSalesWorkbook'
import type {SalesSnapshot} from './types'

export function SalesExport({snapshot,start,end,channel,excludeGroup,setExcludeGroup}:{snapshot:SalesSnapshot;start:string;end:string;channel:string;excludeGroup:boolean;setExcludeGroup:(value:boolean)=>void}){
 const [granularity,setGranularity]=useState<'day'|'month'>('day'),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const download=async()=>{setError('');setBusy(true);try{await downloadSalesExcel(snapshot,{start,end,channel,granularity})}catch(cause){setError(cause instanceof Error?cause.message:'엑셀 파일을 만들지 못했습니다.')}finally{setBusy(false)}}
 return <section className="panel sales-export"><div><strong>매출 엑셀 다운로드</strong><p>위에서 선택한 기간과 채널을 내려받습니다. 전체 채널은 채널별 금액도 포함합니다. 엑셀은 공동구매 포함 금액입니다.</p></div><label>집계 단위<select aria-label="엑셀 집계 단위" value={granularity} onChange={event=>setGranularity(event.target.value as 'day'|'month')}><option value="day">일별</option><option value="month">월별</option></select></label><div className="sales-group-filter"><span>대시보드 그래프 기준</span><div className="sales-chart-toggle" role="group" aria-label="공동구매 집계"><button type="button" aria-pressed={!excludeGroup} onClick={()=>setExcludeGroup(false)}>공동구매 포함</button><button type="button" disabled={channel!=='ALL'} aria-pressed={excludeGroup} onClick={()=>setExcludeGroup(true)}>공동구매 제외</button></div></div><button type="button" className="sales-export-button" disabled={busy||!start||!end} onClick={()=>void download()}>{busy?'파일 만드는 중…':'엑셀 다운로드'}</button>{error&&<p role="alert" className="sales-export-error">{error}</p>}</section>
}
