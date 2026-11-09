import {readFile,realpath,stat} from 'node:fs/promises'
import {join} from 'node:path'
import type {Identity} from '../auth/service.ts'
import type {SalesDay,SalesSnapshot} from '../../src/features/sales/types.ts'

export type ProductRow={date:string;channel:string;category:string;product:string;color:string;quantity:number;sourceRows:number;amount?:number|null}
type HistoricalSales={schemaVersion:number;source:string;files:{month:string;file:string}[];days:SalesDay[];productRows:ProductRow[]}
const cached=new Map<string,{mtimeMs:number;size:number;value:HistoricalSales}>()
export async function readHistoricalSales(root:string,actor:Identity):Promise<HistoricalSales|null>{
 if(!/^[0-9a-f-]{36}$/i.test(actor.workspaceId))throw new Error('Invalid workspace')
 const base=await realpath(root),dir=join(base,actor.workspaceId),actual=await realpath(dir)
 if(process.platform==='win32'?actual.toLowerCase()!==dir.toLowerCase():actual!==dir)throw new Error('Invalid workspace')
 const path=join(actual,'historical-sales-2024-2025.json')
 let info
 try{info=await stat(path)}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
 if(info.size>80_000_000)throw new Error('Historical data too large')
 const saved=cached.get(path)
 if(saved&&saved.mtimeMs===info.mtimeMs&&saved.size===info.size)return saved.value
 const value=JSON.parse(await readFile(path,'utf8')) as HistoricalSales
 if(value.schemaVersion!==1||!Array.isArray(value.files)||value.files.length!==24||!Array.isArray(value.days)||!Array.isArray(value.productRows)||value.days.some(day=>!/^202[45]-\d{2}-\d{2}$/.test(day.date))||value.productRows.some(row=>!/^202[45]-\d{2}-\d{2}$/.test(row.date)))throw new Error('Invalid historical data')
 cached.set(path,{mtimeMs:info.mtimeMs,size:info.size,value});return value
}
export function withHistoricalSales<T extends SalesSnapshot>(current:T,history:HistoricalSales|null):T{
 if(!history)return current
 const currentDays=current.days.filter(day=>!/^202[45]-/.test(day.date))
 const historicMonths=history.files.map(file=>({month:file.month,sourceSheet:file.file,summaryCached:null,dailyTotal:history.days.filter(day=>day.date.startsWith(file.month)).reduce((sum,day)=>sum+day.total,0),days:history.days.filter(day=>day.date.startsWith(file.month)).length}))
 return {...current,sourceName:`2024·2025 월별 로우데이터 + ${current.sourceName}`,days:[...history.days,...currentDays].sort((a,b)=>a.date.localeCompare(b.date)),months:[...historicMonths,...current.months.filter(item=>!/^202[45]-/.test(item.month))].sort((a,b)=>a.month.localeCompare(b.month))}
}
export function withHistoricalProducts<T extends {sourceName:string;rows:ProductRow[]}>(current:T,history:HistoricalSales|null):T{
 if(!history)return current
 return {...current,sourceName:`2024·2025 월별 로우데이터 + ${current.sourceName}`,rows:[...history.productRows,...current.rows.filter(row=>!/^202[45]-/.test(row.date))].sort((a,b)=>a.date.localeCompare(b.date))}
}
