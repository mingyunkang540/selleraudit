import * as XLSX from 'xlsx'
import type { MasterImportPreview } from '../../src/types/import/index.ts'
import type { ExistingProduct } from './safeInitialPlan.ts'
import { parseOhouseWorkbook,type OhouseOption } from './ohouseWorkbook.ts'

export interface OhousePlannedOption extends OhouseOption {masterProductId:string|null;candidateCode:string|null;reason:string}
export function planOhouse(source:Buffer,master:Buffer,preview:MasterImportPreview,existing:readonly (ExistingProduct&{id:string})[]):OhousePlannedOption[]{
  const options=parseOhouseWorkbook(source)
  const workbook=XLSX.read(master,{type:'buffer'});const sheet=workbook.Sheets['단가표']
  if(!sheet||sheet.AM5?.v!=='오늘의집'||sheet.AN5?.v!=='오늘의집\n아쿠아')throw new Error('Master channel columns changed')
  const links=new Map<string,Set<string>>()
  for(let row=6;row<=220;row++)for(const col of ['AM','AN']){
    const id=sheet[`${col}${row}`]?.v;const code=sheet[`B${row}`]?.v
    if(id===undefined||id===null||code===undefined||code===null)continue
    const key=String(id).trim(),value=String(code).trim();if(!/^\d+$/.test(key)||!value)continue
    const set=links.get(key)??new Set<string>();set.add(value);links.set(key,set)
  }
  const groups=new Map<string,OhouseOption[]>()
  for(const option of options){const group=groups.get(option.productCode)??[];group.push(option);groups.set(option.productCode,group)}
  const products=new Map(existing.map(item=>[item.code,item]))
  return options.map(option=>{
    const codes=[...(links.get(option.productCode)??[])];const candidateCode=codes.length===1?codes[0]:null
    if(option.status!=='ACTIVE')return {...option,candidateCode,masterProductId:null,reason:'사용하지 않는 옵션'}
    if(option.optionType==='추가옵션')return {...option,candidateCode,masterProductId:null,reason:'추가옵션 구성 확인 필요'}
    if(!candidateCode)return {...option,candidateCode,masterProductId:null,reason:codes.length?'마스터 품번 중복':'마스터 상품번호 없음'}
    const product=products.get(candidateCode)
    if(!product||product.status!=='ACTIVE')return {...option,candidateCode,masterProductId:null,reason:'기준 상품 확인 필요'}
    const records=preview.products.filter(item=>item.sabangnetCode===candidateCode&&item.productName===product.name&&item.productType===product.type&&item.category===product.category)
    const candidates=records.filter(item=>{
      const bom=preview.bomComponents.filter(c=>c.productSourceRow===item.sourceRow).map(c=>`${c.skuCode}:${c.quantity}`).sort()
      return bom.length>0&&JSON.stringify(bom)===JSON.stringify(product.components.map(c=>`${c.sku}:${c.quantity}`).sort())
    })
    if(candidates.length!==1)return {...option,candidateCode,masterProductId:null,reason:'기준 상품 구성 확인 필요'}
    if((groups.get(option.productCode)?.length??0)!==1||!['단품','기본 옵션'].includes(option.optionName))return {...option,candidateCode,masterProductId:null,reason:'옵션 구성 또는 색상 확인 필요'}
    return {...option,candidateCode,masterProductId:product.id,reason:'단일 옵션과 기존 상품 구성 일치'}
  })
}
