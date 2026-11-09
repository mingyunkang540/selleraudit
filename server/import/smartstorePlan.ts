import * as XLSX from 'xlsx'
import type {MasterImportPreview} from '../../src/types/import/index.ts'
import type {ExistingProduct} from './safeInitialPlan.ts'

type Current=ExistingProduct&{id:string}
export type SmartListing={id:string;name:string;normalPrice:number|null;salePrice:number|null;hasOptions:boolean;hasExtras:boolean;masterProductId:string|null;candidateCode:string|null}
const numeric=(value:unknown):number|null=>{
  const s=String(value??'').trim()
  if(!s)return null
  if(!/^\d+$/.test(s))throw new Error('Invalid price')
  const n=Number(s);if(!Number.isSafeInteger(n)||n<0)throw new Error('Invalid price')
  return n
}
export function planSmartstore(csv:Buffer,master:Buffer,preview:MasterImportPreview,existing:readonly Current[]):SmartListing[]{
  let text=new TextDecoder('utf-8',{fatal:false}).decode(csv)
  if(text.includes('\ufffd'))text=new TextDecoder('euc-kr',{fatal:true}).decode(csv)
  const source=XLSX.read(text,{type:'string',raw:true})
  const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(source.Sheets[source.SheetNames[0]],{defval:'',raw:true})
  const sheet=XLSX.read(master,{type:'buffer'}).Sheets['단가표']
  if(!sheet||sheet.AL5?.v!=='네이버')throw new Error('Master layout changed')
  const links=new Map<string,Set<string>>()
  for(let n=6;n<=220;n++){const id=sheet[`AL${n}`]?.v,code=sheet[`B${n}`]?.v;if(id===undefined||id===null||code===undefined||code===null)continue;const k=String(id).trim();if(!/^\d+$/.test(k))continue;const set=links.get(k)??new Set<string>();set.add(String(code).trim());links.set(k,set)}
  const seen=new Set<string>()
  return rows.map(row=>{
    const id=String(row['상품번호(스마트스토어)']??'').trim(),name=String(row['상품명']??'').trim(),option=String(row['옵션']??'').trim(),extra=String(row['추가상품']??'').trim()
    if(!/^\d+$/.test(id)||seen.has(id)||!name||row['판매상태']!=='판매중'||!['Y','N'].includes(option)||!['Y','N'].includes(extra))throw new Error('Invalid or duplicate listing')
    seen.add(id)
    const codes=[...(links.get(id)??[])],candidateCode=codes.length===1?codes[0]:null
    const product=candidateCode?existing.find(p=>p.code===candidateCode&&p.status==='ACTIVE'):undefined
    let masterProductId:string|null=null
    if(option==='N'&&product){
      const matching=preview.products.filter(p=>p.sabangnetCode===product.code&&p.productName===product.name&&p.productType===product.type&&p.category===product.category).filter(p=>{
        const bom=preview.bomComponents.filter(c=>c.productSourceRow===p.sourceRow).map(c=>`${c.skuCode}:${c.quantity}`).sort()
        return bom.length>0&&JSON.stringify(bom)===JSON.stringify(product.components.map(c=>`${c.sku}:${c.quantity}`).sort())
      })
      if(matching.length===1)masterProductId=product.id
    }
    return {id,name,normalPrice:numeric(row['판매가']),salePrice:numeric(row['할인가'])??numeric(row['판매가']),hasOptions:option==='Y',hasExtras:extra==='Y',masterProductId,candidateCode}
  })
}
