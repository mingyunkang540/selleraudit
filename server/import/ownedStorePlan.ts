import * as XLSX from 'xlsx'
import type {MasterImportPreview} from '../../src/types/import/index.ts'
import type {ExistingProduct} from './safeInitialPlan.ts'

type Current=ExistingProduct&{id:string}
export type OwnedListing={id:string;name:string;status:'ACTIVE'|'INACTIVE';price:number|null;hasOptions:boolean;optionText:string;masterProductId:string|null;candidateCode:string|null;reason:string}
function price(value:unknown){
 const text=String(value??'').trim()
 if(!text)return null
 if(!/^\d+(?:\.0{1,2})?$/.test(text))throw new Error('Invalid price')
 const valueNumber=Number(text)
 if(!Number.isSafeInteger(valueNumber)||valueNumber<0)throw new Error('Invalid price')
 return valueNumber
}
export function planOwnedStore(csv:Buffer,master:Buffer,preview:MasterImportPreview,products:readonly Current[]):OwnedListing[]{
 const text=new TextDecoder('utf-8',{fatal:true}).decode(csv)
 const source=XLSX.read(text,{type:'string',raw:true}),rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(source.Sheets[source.SheetNames[0]],{defval:'',raw:true})
 const sheet=XLSX.read(master,{type:'buffer'}).Sheets['단가표']
 if(!sheet||sheet.AJ5?.v!=='자사몰')throw new Error('Master layout changed')
 const links=new Map<string,Set<string>>()
 for(let n=6;n<=220;n++){
  const id=String(sheet[`AJ${n}`]?.v??'').trim(),code=String(sheet[`B${n}`]?.v??'').trim()
  if(!/^P[A-Z0-9]+$/.test(id)||!code)continue
  const set=links.get(id)??new Set<string>();set.add(code);links.set(id,set)
 }
 const seen=new Set<string>()
 return rows.map(row=>{
  const id=String(row['상품코드']??'').trim(),name=String(row['상품명']??'').trim(),option=String(row['옵션사용']??'').trim(),state=String(row['판매상태']??'').trim(),display=String(row['진열상태']??'').trim()
  if(!/^P[A-Z0-9]+$/.test(id)||!name||seen.has(id)||!['Y','N'].includes(option)||!['Y','N'].includes(state)||!['Y','N'].includes(display))throw new Error('Invalid or duplicate listing')
  seen.add(id)
  const active=state==='Y'&&display==='Y',codes=[...(links.get(id)??[])],candidateCode=codes.length===1?codes[0]:null
  const matches=products.filter(p=>p.code===candidateCode&&p.status==='ACTIVE')
  let masterProductId:string|null=null,reason=option==='Y'?'옵션별 구성과 가격 확인 필요':!active?'진열 또는 판매 중지':codes.length>1?'마스터에 복수 상품 연결':!candidateCode?'마스터의 자사몰 코드 연결 없음':'마스터 상품 또는 구성 확인 필요'
  if(option==='N'&&active&&matches.length===1){
   const product=matches[0]
   const verified=preview.products.filter(p=>p.sabangnetCode===product.code&&p.productName===product.name&&p.productType===product.type&&p.category===product.category).filter(p=>{
    const bom=preview.bomComponents.filter(c=>c.productSourceRow===p.sourceRow).map(c=>`${c.skuCode}:${c.quantity}`).sort()
    return bom.length>0&&JSON.stringify(bom)===JSON.stringify(product.components.map(c=>`${c.sku}:${c.quantity}`).sort())
   })
   if(verified.length===1){masterProductId=product.id;reason='검증된 자사몰 코드 및 구성 일치'}
  }
  return {id,name,status:active?'ACTIVE':'INACTIVE',price:price(row['판매가']),hasOptions:option==='Y',optionText:String(row['옵션입력']??'').trim(),masterProductId,candidateCode,reason}
 })
}
