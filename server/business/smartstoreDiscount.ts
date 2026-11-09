import {createHash} from 'node:crypto'
import {readFile,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import * as XLSX from 'xlsx'

export const originalSmartstoreSourceHash='f5e40b68618ed27b8a1a056c75995ab0e26a7b0a3b950cbb7eb4e7126c30bb95'
export const discountListings=['4894641136','9645767991','13297246331'] as const
const integer=(value:unknown):number|null=>{const text=String(value??'').trim();if(!/^\d+$/.test(text))return null;const n=Number(text);return Number.isSafeInteger(n)?n:null}
const dateKst=(value:string):number|null=>{if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value))return null;const time=Date.parse(value.replace(' ','T')+':00+09:00');return Number.isFinite(time)?time:null}
export function calculateDiscounts(row:unknown[],now:number):Map<string,{normal:number;sale:number}>|null{
 const base=integer(row[5]);if(base===null)return null
 const immediateValue=String(row[57]??'').trim(),immediateUnit=String(row[58]??'').trim()
 let discount=0
 if(immediateValue||immediateUnit){const value=integer(immediateValue);if(value===null||immediateUnit!=='원')return null;discount=value}
 const reserveValue=String(row[61]??'').trim(),reserveUnit=String(row[62]??'').trim(),period=String(row[63]??'').trim()
 if(reserveValue||reserveUnit||period){
  const parts=period.split(/\r?\n/).map(s=>s.trim()),start=dateKst(parts[0]??''),end=dateKst(parts[1]??'')
  if(parts.length!==2||start===null||end===null||end<start)return null
  if(now>=start&&now<end+60000){const value=integer(reserveValue);if(value===null||reserveUnit!=='원')return null;discount=value}
 }
 const ids=String(row[15]??'').split(/\r?\n/).map(s=>s.trim()),amounts=String(row[17]??'').split(/\r?\n/).map(s=>s.trim())
 if(!ids.length||ids.length!==amounts.length||new Set(ids).size!==ids.length)return null
 const result=new Map<string,{normal:number;sale:number}>()
 for(let i=0;i<ids.length;i++){if(!/^\d+$/.test(ids[i])||! /^-?\d+$/.test(amounts[i]))return null;const normal=base+Number(amounts[i]),sale=normal-discount;if(!Number.isSafeInteger(normal)||normal<0||sale<0)return null;result.set(ids[i],{normal,sale})}
 return result
}
export function calculateListingDiscounts(row:unknown[],now:number){
 if(row[13]==='설정안함'){const copy=[...row];copy[15]='1';copy[17]='0';const value=calculateDiscounts(copy,now)?.get('1');return value?new Map([['BASE',value]]):null}
 return row[13]==='조합형'?calculateDiscounts(row,now):null
}
export async function readDiscountSnapshot(root:string,workspace:string,now=Date.now(),sourceHash=originalSmartstoreSourceHash,allListings=false){
 if(!/^[0-9a-f]{64}$/.test(sourceHash))throw new Error('Invalid source hash')
 const base=await realpath(root),path=join(base,workspace,'channel-sources',`${sourceHash}.xlsx`),actual=await realpath(path)
 if(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path)throw new Error('Invalid source')
 const bytes=await readFile(actual);if(createHash('sha256').update(bytes).digest('hex')!==sourceHash)throw new Error('Source changed')
 const workbook=XLSX.read(bytes,{type:'buffer',nodim:true}),sheet=workbook.Sheets['일괄수정']
 if(!sheet||sheet.A2?.v!=='상품번호'||sheet.P2?.v!=='옵션번호'||sheet.R2?.v!=='옵션가')throw new Error('Source format changed')
 const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true}).slice(5)
 const result=new Map<string,Map<string,{normal:number;sale:number}>>()
 const selectedIds=allListings?rows.map(row=>String(row[0]).trim()).filter(Boolean):discountListings
 for(const id of selectedIds){const selected=rows.filter(row=>String(row[0]).trim()===id);if(selected.length!==1)continue;const values=allListings?calculateListingDiscounts(selected[0],now):calculateDiscounts(selected[0],now);if(values)result.set(id,values)}
 return result
}
