import * as XLSX from 'xlsx'
import {calculateListingDiscounts} from '../business/smartstoreDiscount.ts'

export type RefreshedOffer={optionCode:string;name:string;status:'ACTIVE'|'INACTIVE';normal:number;sale:number}
export type RefreshedListing={code:string;name:string;offers:RefreshedOffer[]}
const split=(value:unknown)=>String(value??'').split(/\r?\n/).map(item=>item.trim())
export function parseSmartstoreRefresh(bytes:Buffer,now:number):RefreshedListing[]{
 const workbook=XLSX.read(bytes,{type:'buffer',nodim:true}),sheet=workbook.Sheets['일괄수정']
 if(!sheet||sheet.A2?.v!=='상품번호'||sheet.D2?.v!=='상품명'||sheet.F2?.v!=='판매가'||sheet.P2?.v!=='옵션번호'||sheet.Q2?.v!=='옵션값'||sheet.R2?.v!=='옵션가'||sheet.T2?.v!=='옵션 사용여부'||!String(sheet.BF2?.v??'').includes('즉시할인')||!String(sheet.BL2?.v??'').includes('예약 할인 기간'))throw new Error('스마트스토어 파일 형식이 다릅니다.')
 const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true}).slice(5).filter(row=>String(row[0]??'').trim())
 const seen=new Set<string>()
 return rows.map(row=>{
  const code=String(row[0]).trim(),name=String(row[3]??'').trim()
  if(!/^\d+$/.test(code)||!name||seen.has(code))throw new Error('상품번호 또는 상품명이 올바르지 않습니다.')
  seen.add(code)
  const prices=calculateListingDiscounts(row,now);if(!prices)throw new Error(`가격 또는 할인 정보를 확인할 수 없습니다: ${code}`)
  if(row[13]==='설정안함'){const price=prices.get('BASE');if(!price)throw new Error('단품 가격이 없습니다.');return {code,name,offers:[{optionCode:'BASE',name:'단품',status:'ACTIVE' as const,...price}]}}
  if(row[13]!=='조합형')throw new Error('지원하지 않는 옵션 형식입니다.')
  const ids=split(row[15]),names=split(row[16]),uses=split(row[19]);if(ids.length!==names.length||ids.length!==uses.length||new Set(ids).size!==ids.length)throw new Error('옵션 수가 일치하지 않습니다.')
  const offers=ids.map((optionCode,index)=>{const price=prices.get(optionCode);if(!/^\d+$/.test(optionCode)||!names[index]||!['Y','N'].includes(uses[index])||!price)throw new Error('옵션 정보가 올바르지 않습니다.');return {optionCode,name:names[index],status:uses[index]==='Y'?'ACTIVE' as const:'INACTIVE' as const,...price}})
  return {code,name,offers}
 })
}
