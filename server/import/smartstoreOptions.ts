import * as XLSX from 'xlsx'
import type {MasterImportPreview} from '../../src/types/import/index.ts'
import type {ExistingProduct} from './safeInitialPlan.ts'
type Existing=ExistingProduct&{id:string}
type OldRow={id:string;hasOptions:boolean;candidateCode:string|null}
export type SmartOption={listingCode:string;optionCode:string;name:string;status:'ACTIVE'|'INACTIVE';normalPrice:number|null;salePrice:number|null;masterProductId:string|null;candidateCode:string|null;surcharge:number}
const list=(v:unknown)=>String(v??'').split(/\r?\n/).map(s=>s.trim())
function number(value:unknown):number{const s=String(value??'').trim();if(!/^-?\d+$/.test(s))throw new Error('Invalid numeric value');const n=Number(s);if(!Number.isSafeInteger(n))throw new Error('Invalid numeric value');return n}
export function planSmartOptions(bytes:Buffer,old:OldRow[],csv:Buffer,preview:MasterImportPreview,products:readonly Existing[]):{options:SmartOption[];extrasListings:string[]} {
 const book=XLSX.read(bytes,{type:'buffer',nodim:true}),sheet=book.Sheets['일괄수정']
 if(!sheet||sheet.A2?.v!=='상품번호'||sheet.P2?.v!=='옵션번호'||sheet.Q2?.v!=='옵션값'||sheet.R2?.v!=='옵션가'||sheet.T2?.v!=='옵션 사용여부')throw new Error('Option workbook layout changed')
 const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:'',raw:true}).slice(5)
 let text=new TextDecoder('utf8').decode(csv);if(text.includes('\ufffd'))text=new TextDecoder('euc-kr',{fatal:true}).decode(csv)
 const csvBook=XLSX.read(text,{type:'string',raw:true}),csvRows=XLSX.utils.sheet_to_json<Record<string,unknown>>(csvBook.Sheets[csvBook.SheetNames[0]],{raw:true,defval:''})
 const source=new Map(csvRows.map(r=>[String(r['상품번호(스마트스토어)']),r]))
 const known=new Map(old.map(row=>[row.id,row])),seen=new Set<string>(),options:SmartOption[]=[],extrasListings:string[]=[]
 for(const row of rows){
  const id=String(row[0]).trim(),prior=known.get(id)
  if(!prior)throw new Error('Unexpected listing')
  if(row[21]||row[22])extrasListings.push(id)
  if(!prior.hasOptions){if(row[13]!=='설정안함')throw new Error('Listing option state changed');continue}
  if(row[13]!=='조합형')throw new Error('Unsupported option type')
  const ids=list(row[15]),names=list(row[16]),amounts=list(row[17]),stock=list(row[18]),uses=list(row[19])
  if(!ids.length||[names,amounts,stock,uses].some(a=>a.length!==ids.length))throw new Error('Option rows disagree')
  const product=prior.candidateCode?products.find(p=>p.code===prior.candidateCode&&p.status==='ACTIVE'):undefined
  const match=product&&preview.products.filter(p=>p.sabangnetCode===product.code&&p.productName===product.name&&p.productType===product.type&&p.category===product.category).filter(p=>{const bom=preview.bomComponents.filter(c=>c.productSourceRow===p.sourceRow).map(c=>`${c.skuCode}:${c.quantity}`).sort();return bom.length>0&&JSON.stringify(bom)===JSON.stringify(product.components.map(c=>`${c.sku}:${c.quantity}`).sort())})
  const oldRow=source.get(id);if(!oldRow)throw new Error('Source listing missing')
  const base=number(row[5]),oldBase=number(oldRow['판매가']),oldSale=number(oldRow['할인가']||oldRow['판매가'])
  for(let i=0;i<ids.length;i++){
   if(!/^\d+$/.test(ids[i])||!names[i]||!['Y','N'].includes(uses[i])||seen.has(`${id}:${ids[i]}`))throw new Error('Invalid or duplicate option')
   seen.add(`${id}:${ids[i]}`);const surcharge=number(amounts[i]);const normalPrice=base+surcharge;if(normalPrice<0)throw new Error('Invalid option price')
   const colorOnly=['색상','선택','컬러믹스'].includes(String(row[14]).trim())&&/^(핑크|쿨라벤더|투명그레이|아쿠아|★단독★크림화이트|크림화이트|라벤더|블루|쿨라벤더\+아쿠아|투명그레이\+아쿠아|핑크\+아쿠아)$/.test(names[i])
   options.push({listingCode:id,optionCode:ids[i],name:names[i],status:uses[i]==='Y'?'ACTIVE':'INACTIVE',normalPrice,salePrice:surcharge===0&&base===oldBase?oldSale:null,masterProductId:uses[i]==='Y'&&colorOnly&&match?.length===1&&product?product.id:null,candidateCode:prior.candidateCode,surcharge})
  }
 }
 if(rows.length!==old.length||new Set(rows.map(r=>String(r[0]))).size!==old.length)throw new Error('Listing count changed')
 return {options,extrasListings}
}
