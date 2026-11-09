import {createHash,randomUUID} from 'node:crypto'
import {readFile,realpath,rename,stat,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {extractWorkbookPrices,type WorkbookPriceRow} from './workbookPrices.ts'
import {analyzeMasterWorkbook} from '../../src/services/import/index.ts'
import {LOCAL_APPROVED_BUNDLE_SKUS,LOCAL_APPROVED_SKU_CATEGORIES,LOCAL_SKU_COMPONENTS,LOCAL_NON_COUNTED_SKUS} from '../../src/services/import/localPolicy.ts'

const keys=['cost','normal','regular','basic','medium','large','live','group'] as const
type Bom={productSourceRow:number;skuCode:string;quantity:number}
type Update={rows:WorkbookPriceRow[];byOldRow:Map<number,WorkbookPriceRow>;fullyMatched:boolean}
type SourceResult={updates:Map<string,Update>;warning:boolean;skipped:number}
const pending=new Map<string,Promise<SourceResult>>()
const memo=new Map<string,{hash:string;baselineHash:string;updates:Map<string,Update>;skipped:number}>()
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')

export function matchPriceRows(oldRows:WorkbookPriceRow[],oldBom:readonly Bom[],newRows:WorkbookPriceRow[],newBom:readonly Bom[]){
 const signature=(row:WorkbookPriceRow,bom:readonly Bom[])=>{
  const components=bom.filter(item=>item.productSourceRow===row.row).map(item=>`${item.skuCode}:${item.quantity}`).sort()
  return components.length?JSON.stringify([row.name,row.channel,components]):null
 }
 const result=new Map<string,Update>();let skipped=0
 for(const code of new Set(oldRows.map(row=>row.code))){
  const before=oldRows.filter(row=>row.code===code),after=newRows.filter(row=>row.code===code)
  const signatures=before.map(row=>signature(row,oldBom)),next=after.map(row=>signature(row,newBom))
  const pairs=before.flatMap((row,i)=>{const sig=signatures[i];return sig&&signatures.filter(x=>x===sig).length===1&&next.filter(x=>x===sig).length===1?[[row.row,after[next.indexOf(sig)]] as const]:[]})
  const common=before.find(row=>row.channel==='공통')
  if(!pairs.length||(common&&!pairs.some(([row])=>row===common.row))){skipped++;continue}
  const fullyMatched=before.length===after.length&&pairs.length===before.length
  result.set(code,{rows:after,byOldRow:new Map(pairs),fullyMatched})
 }
 return {updates:result,skipped}
}
export function mergeSafePrices(old:WorkbookPriceRow['values'],rows:WorkbookPriceRow[]){
 const values={...old}
 for(const key of keys){const amounts=rows.map(row=>row.values[key]);if(amounts.length&&amounts.every(value=>value!==null&&value===amounts[0]))values[key]=amounts[0]}
 return values
}
export function hasUnverifiablePriceRegression(previous:WorkbookPriceRow[],current:WorkbookPriceRow[]){
 const identity=(row:WorkbookPriceRow)=>JSON.stringify([row.code,row.name,row.channel])
 return current.some(row=>{const matches=previous.filter(item=>identity(item)===identity(row));return matches.length===1&&keys.some(key=>matches[0].values[key]!==null&&row.values[key]===null)})
}
export async function readMasterPriceUpdates(root:string,workspaceId:string,baselineBytes:Buffer,baselineRows:WorkbookPriceRow[],baselineBom:readonly Bom[]):Promise<SourceResult>{
 const existing=pending.get(workspaceId);if(existing)return existing
 const task=load(root,workspaceId,baselineBytes,baselineRows,baselineBom).finally(()=>pending.delete(workspaceId));pending.set(workspaceId,task);return task
}
async function load(root:string,workspaceId:string,baselineBytes:Buffer,baselineRows:WorkbookPriceRow[],baselineBom:readonly Bom[]):Promise<SourceResult>{
 const base=await realpath(root),workspace=await realpath(join(base,workspaceId))
 if(process.platform==='win32'?workspace.toLowerCase()!==join(base,workspaceId).toLowerCase():workspace!==join(base,workspaceId))throw new Error('Invalid workspace')
 const saved=join(workspace,'master-price-last-good.xlsx');let bytes:Buffer;let warning=false
 try{const source=process.env.SELLERAUDIT_MASTER_SOURCE_PATH;if(!source)throw new Error('Workbook path is not configured');const before=await stat(source);if(before.size>30_000_000)throw new Error('Workbook too large');bytes=await readFile(source);const after=await stat(source);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes.length!==before.size)throw new Error('Workbook changed during read')}
 catch{warning=true;try{bytes=await readFile(saved)}catch{return {updates:new Map(),warning:true,skipped:0}}}
 const currentHash=hash(bytes),baselineHash=hash(baselineBytes),cached=memo.get(workspaceId)
 if(cached&&cached.hash===currentHash&&cached.baselineHash===baselineHash)return {...cached,warning}
 try{
  const rows=extractWorkbookPrices(bytes),input=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
  const preview=await analyzeMasterWorkbook(input,'master.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS})
  if(!preview.workbook.schemaValid||!rows.length)throw new Error('Invalid workbook')
  if(!warning){let previous:Buffer|null=null;try{previous=await readFile(saved)}catch{/* No previously saved workbook. */}if(previous&&hash(previous)!==currentHash&&hasUnverifiablePriceRegression(extractWorkbookPrices(previous),rows))throw new Error('A previously verified price became unavailable')}
  const planned=matchPriceRows(baselineRows,baselineBom,rows,preview.bomComponents)
  if(!warning){const temp=join(workspace,`.master-price-${randomUUID()}.tmp`);try{await writeFile(temp,bytes,{flag:'wx'});await rename(temp,saved)}finally{await unlink(temp).catch(()=>{})}}
  memo.set(workspaceId,{hash:currentHash,baselineHash,...planned});return {...planned,warning}
 }catch{
  if(!warning){try{const fallback=await readFile(saved);if(hash(fallback)!==currentHash){const rows=extractWorkbookPrices(fallback),input=fallback.buffer.slice(fallback.byteOffset,fallback.byteOffset+fallback.byteLength) as ArrayBuffer;const preview=await analyzeMasterWorkbook(input,'master.xlsx',{approvedBundleSkuCodes:LOCAL_APPROVED_BUNDLE_SKUS,approvedSkuCategories:LOCAL_APPROVED_SKU_CATEGORIES,skuComponents:LOCAL_SKU_COMPONENTS,nonCountedSkuCodes:LOCAL_NON_COUNTED_SKUS});if(preview.workbook.schemaValid){const planned=matchPriceRows(baselineRows,baselineBom,rows,preview.bomComponents);memo.set(workspaceId,{hash:hash(fallback),baselineHash,...planned});return {...planned,warning:true}}}}catch{/* Existing baseline remains available. */}}
  return {updates:new Map(),warning:true,skipped:0}
 }
}
