import * as XLSX from 'xlsx'

export interface OhouseOption {productCode:string;productName:string;optionCode:string;optionName:string;optionType:'필수옵션'|'추가옵션';status:'ACTIVE'|'INACTIVE';normalPrice:number|null;salePrice:number|null;sourceRow:number}
const headers=['상품번호','상품명','옵션번호','옵션타입','옵션값1','옵션값2','옵션정상가','옵션판매가','사용상태'] as const
function identifier(value:unknown):string{
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)return String(value)
  if(typeof value==='string'&&/^\d+$/.test(value.trim()))return value.trim()
  throw new Error('Invalid channel identifier')
}
function money(value:unknown):number|null{
  if(value===null||value===undefined||value==='')return null
  const parsed=typeof value==='number'?value:typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value):NaN
  if(!Number.isFinite(parsed)||parsed<0||parsed>999999999999.99)throw new Error('Invalid price')
  return parsed
}
export function parseOhouseWorkbook(bytes:Buffer):OhouseOption[]{
  const book=XLSX.read(bytes,{type:'buffer',nodim:true,cellFormula:true})
  if(book.SheetNames.length!==1)throw new Error('Unexpected workbook sheets')
  const sheet=book.Sheets[book.SheetNames[0]];const range=XLSX.utils.decode_range(sheet['!ref']??'A1:A1')
  if(range.e.r>20000||range.e.c>100)throw new Error('Workbook is too large')
  const rows=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,defval:null,blankrows:true,raw:true})
  const header=rows[0];if(!header||headers.some(name=>header.filter(value=>value===name).length!==1))throw new Error('Unexpected workbook columns')
  const index=Object.fromEntries(headers.map(name=>[name,header.indexOf(name)])) as Record<typeof headers[number],number>
  const options:OhouseOption[]=[];const seen=new Set<string>()
  for(let n=1;n<rows.length;n++){
    const row=rows[n];if(row.every(cell=>cell===null||cell===''))continue
    const productCode=identifier(row[index['상품번호']]);const optionCode=identifier(row[index['옵션번호']])
    const key=JSON.stringify([productCode,optionCode]);if(seen.has(key))throw new Error('Duplicate channel option');seen.add(key)
    const name=row[index['상품명']];const kind=row[index['옵션타입']];const state=row[index['사용상태']]
    if(typeof name!=='string'||!name.trim()||!['필수옵션','추가옵션'].includes(String(kind))||!['사용','미사용'].includes(String(state)))throw new Error('Invalid option information')
    const values=[row[index['옵션값1']],row[index['옵션값2']]].filter(value=>value!==null&&value!==undefined&&String(value).trim()).map(value=>String(value).trim())
    options.push({productCode,productName:name.trim(),optionCode,optionName:values.join(' / ')||'기본 옵션',optionType:kind as OhouseOption['optionType'],status:state==='사용'?'ACTIVE':'INACTIVE',normalPrice:money(row[index['옵션정상가']]),salePrice:money(row[index['옵션판매가']]),sourceRow:n+1})
  }
  const groups=new Map<string,string>()
  for(const option of options){const name=groups.get(option.productCode);if(name&&name!==option.productName)throw new Error('Inconsistent channel product name');groups.set(option.productCode,option.productName)}
  return options
}
