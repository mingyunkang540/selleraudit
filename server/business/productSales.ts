import {copyFile,readFile,realpath,rename,stat,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {Identity} from '../auth/service.ts'
import {syncSalesDashboard} from './salesDashboard.ts'
import type {ProductRow} from './historicalSales.ts'

const run=promisify(execFile)
type ProductSnapshot={schemaVersion:number;parserVersion:number;sourceSha256:string;sourceName:string;rows:ProductRow[];skipped:Record<string,number>}
const active=new Map<string,Promise<ProductSnapshot & {syncStatus:string}>>()
export function readProductSales(root:string,actor:Identity){
 const pending=active.get(actor.workspaceId)
 if(pending)return pending
 const task=refresh(root,actor).finally(()=>active.delete(actor.workspaceId))
 active.set(actor.workspaceId,task)
 return task
}
async function refresh(root:string,actor:Identity){
 if(!/^[0-9a-f-]{36}$/i.test(actor.workspaceId))throw new Error('Invalid workspace')
 const base=await realpath(root),workspace=await realpath(join(base,actor.workspaceId))
 if(workspace.toLowerCase()!==join(base,actor.workspaceId).toLowerCase())throw new Error('Invalid workspace path')
 const cache=join(workspace,'product-sales-analysis.json')
 let previous: ProductSnapshot|null
 try{previous=JSON.parse(await readFile(cache,'utf8'));if(previous?.schemaVersion!==1||!Array.isArray(previous.rows))previous=null}catch{previous=null}
 let tmpSource='',tmpResult='',tmpFinal=''
 try{
  const sales=await syncSalesDashboard(root,actor)
  if(sales.syncStatus!=='current')throw new Error('Sales source unavailable')
  if(previous?.sourceSha256===sales.sourceSha256&&previous.parserVersion===2)return {...previous,syncStatus:'current'}
  const source=sales.sourcePath,before=await stat(source)
  if(before.size>80_000_000)throw new Error('Workbook too large')
  const id=randomUUID();tmpSource=join(workspace,`.product-sales-${id}.xlsx`);tmpResult=join(workspace,`.product-sales-${id}.json`);tmpFinal=join(workspace,`.product-sales-${id}-final.json`)
  await copyFile(source,tmpSource)
  const hash=createHash('sha256').update(await readFile(tmpSource)).digest('hex')
  if(hash!==sales.sourceSha256)throw new Error('Source changed')
  await run('python',['scripts/build_product_sales.py','--source',tmpSource,'--output',tmpResult],{cwd:process.cwd(),timeout:120000,maxBuffer:1_000_000,windowsHide:true})
  const after=await stat(source)
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Source changed')
  const next=JSON.parse(await readFile(tmpResult,'utf8')) as ProductSnapshot
  if(next.schemaVersion!==1||next.parserVersion!==2||next.sourceSha256!==hash||!Array.isArray(next.rows)||!next.rows.length)throw new Error('Invalid sales analysis')
  next.sourceName=sales.sourceName
  await writeFile(tmpFinal,JSON.stringify(next),{flag:'wx'});await rename(tmpFinal,cache)
  return {...next,syncStatus:'current'}
 }catch(error){if(previous)return {...previous,syncStatus:'error'};throw error}
 finally{await Promise.all([tmpSource,tmpResult,tmpFinal].filter(Boolean).map(path=>unlink(path).catch(()=>{})))}
}
