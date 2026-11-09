import {realpath,readFile,stat,copyFile,writeFile,rename,mkdir,unlink} from 'node:fs/promises'
import {basename,isAbsolute,join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {Identity} from '../auth/service.ts'
import type {SalesSnapshot} from '../../src/features/sales/types.ts'

export async function readSalesDashboard(root:string,actor:Identity):Promise<SalesSnapshot>{
 if(!/^[0-9a-f-]{36}$/i.test(actor.workspaceId))throw new Error('Invalid workspace')
 const base=await realpath(root),expected=join(base,actor.workspaceId,'sales-dashboard.json'),actual=await realpath(expected)
 if(process.platform==='win32'?actual.toLowerCase()!==expected.toLowerCase():actual!==expected)throw new Error('Invalid sales data path')
 if((await stat(actual)).size>2_000_000)throw new Error('Sales data too large')
 const value=JSON.parse(await readFile(actual,'utf8')) as SalesSnapshot
 if(value.schemaVersion!==1||!/^\d{4}-\d{2}-\d{2}$/.test(value.asOf)||!Array.isArray(value.days)||!Array.isArray(value.months)||!Array.isArray(value.warnings))throw new Error('Invalid sales data')
 return value
}

const run=promisify(execFile)
const active=new Map<string,Promise<SalesSnapshot & {syncStatus:string;sourcePath:string}>>()
export function syncSalesDashboard(root:string,actor:Identity){
 const key=actor.workspaceId
 const pending=active.get(key)
 if(pending)return pending
 const task=refresh(root,actor).finally(()=>active.delete(key))
 active.set(key,task)
 return task
}
async function refresh(root:string,actor:Identity):Promise<SalesSnapshot & {syncStatus:string;sourcePath:string}>{
 const previous=await readSalesDashboard(root,actor)
 if(basename(previous.sourceName)!==previous.sourceName||!previous.sourceName.endsWith('.xlsx'))throw new Error('Invalid source')
 const source=process.env.SELLERAUDIT_SALES_SOURCE_PATH??'',workspace=join(await realpath(root),actor.workspaceId)
 let tempSource='',tempResult='',tempOutput=''
 try{
  if(!isAbsolute(source)||!source.toLowerCase().endsWith('.xlsx'))throw new Error('Invalid sales source path')
  const before=await stat(source)
  if(before.size>80_000_000)throw new Error('Workbook too large')
  const bytes=await readFile(source),hash=createHash('sha256').update(bytes).digest('hex')
  if(hash===previous.sourceSha256&&previous.parserVersion===4)return {...previous,syncStatus:'current',sourcePath:source}
  const id=randomUUID();tempSource=join(workspace,`.sales-${id}.xlsx`);tempResult=join(workspace,`.sales-${id}.json`);tempOutput=join(workspace,`.sales-${id}-final.json`)
  await writeFile(tempSource,bytes,{flag:'wx'})
  await run('python',['scripts/build_sales_snapshot.py','--source',tempSource,'--workspace',actor.workspaceId,'--as-of','auto','--output',tempResult],{cwd:process.cwd(),timeout:120000,maxBuffer:1_000_000,windowsHide:true})
  const after=await stat(source)
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Source changed during read')
  const next=JSON.parse(await readFile(tempResult,'utf8')) as SalesSnapshot
  if(next.schemaVersion!==1||next.sourceSha256!==hash||!Array.isArray(next.days)||!Array.isArray(next.months)||!Array.isArray(next.warnings)||next.asOf<previous.asOf||next.warnings.some(w=>w.type==='DAILY_MISMATCH'))throw new Error('Invalid or incomplete workbook')
  const nextDates=new Set(next.days.map(day=>day.date))
  if(previous.days.some(day=>!nextDates.has(day.date)))throw new Error('Existing dates missing')
  next.sourceName=basename(source)
  const sources=join(workspace,'sales-sources');await mkdir(sources,{recursive:true})
  await copyFile(tempSource,join(sources,`${hash}.xlsx`))
  await writeFile(tempOutput,JSON.stringify(next),{flag:'wx'})
  await rename(tempOutput,join(workspace,'sales-dashboard.json'))
  return {...next,syncStatus:'current',sourcePath:source}
 }catch{
  return {...previous,syncStatus:'error',sourcePath:source}
 }finally{await Promise.all([tempSource,tempResult,tempOutput].filter(Boolean).map(path=>unlink(path).catch(()=>{})))}
}
