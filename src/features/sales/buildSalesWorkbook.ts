import {groupSales,salesTotal} from './salesSummary'
import type {SalesDay,SalesSnapshot} from './types'

export type SalesExportOptions={start:string;end:string;channel:string;granularity:'day'|'month'}

export function salesExportRows(snapshot:SalesSnapshot,options:SalesExportOptions){
 const days=snapshot.days.filter(day=>day.date>=options.start&&day.date<=options.end)
 const channels=options.channel==='ALL'?[...new Set(days.flatMap(day=>Object.keys(day.channels)))].sort((a,b)=>a.localeCompare(b,'ko-KR')):[options.channel]
 const groups=new Map<string,SalesDay[]>()
 for(const day of days){const key=options.granularity==='day'?day.date:day.date.slice(0,7);groups.set(key,[...(groups.get(key)??[]),day])}
 const names=options.channel==='ALL'?['전체 매출',...channels]:[options.channel]
 const values=(items:SalesDay[])=>options.channel==='ALL'?[salesTotal(items,'ALL'),...channels.map(name=>salesTotal(items,name))]:[salesTotal(items,options.channel)]
 const rows:(string|number|null)[][]=[
  ['매출 데이터'],['조회 기간',`${options.start} ~ ${options.end}`],['채널',options.channel==='ALL'?'전체 채널':options.channel],
  ['집계 단위',options.granularity==='day'?'일별':'월별'],['원본 파일',snapshot.sourceName],['매출 기록 기준일',snapshot.asOf],
  ['기간',...names],
  ...[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>[date,...values(items)]),
  ['합계',...values(days)],
 ]
 return {rows,hasData:groupSales(days,options.channel,options.granularity).some(item=>item.value!==null)}
}

export async function downloadSalesExcel(snapshot:SalesSnapshot,options:SalesExportOptions){
 const {rows,hasData}=salesExportRows(snapshot,options)
 if(!hasData)throw new Error('선택한 기간과 채널에 매출 기록이 없습니다.')
 const XLSX=await import('xlsx')
 const sheet=XLSX.utils.aoa_to_sheet(rows)
 sheet['!cols']=[{wch:24},...rows[6].slice(1).map(()=>({wch:22}))]
 sheet['!autofilter']={ref:XLSX.utils.encode_range({s:{r:6,c:0},e:{r:rows.length-2,c:rows[6].length-1}})}
 for(let r=7;r<rows.length;r++)for(let c=1;c<rows[6].length;c++){const cell=sheet[XLSX.utils.encode_cell({r,c})];if(cell?.t==='n')cell.z='#,##0.##'}
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'매출 내역')
 const channel=options.channel==='ALL'?'전체채널':options.channel.replace(/[\\/:*?"<>|]/g,'_')
 XLSX.writeFile(book,`매출_${channel}_${options.start}_${options.end}_${options.granularity==='day'?'일별':'월별'}.xlsx`,{compression:true})
}
