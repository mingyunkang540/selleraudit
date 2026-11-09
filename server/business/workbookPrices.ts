import * as XLSX from 'xlsx'

export type PriceValues={cost:number|null;normal:number|null;regular:number|null;basic:number|null;medium:number|null;large:number|null;live:number|null;group:number|null}
export type WorkbookPriceRow={row:number;code:string;name:string;channel:string;values:PriceValues}
type PriceColumn='T'|'V'|'X'|'Z'|'AB'
const discountColumns:Record<PriceColumn,string>={T:'B',V:'C',X:'D',Z:'E',AB:'F'}
const numeric=(cell:XLSX.CellObject|undefined):number|null=>cell?.t==='n'&&typeof cell.v==='number'&&Number.isFinite(cell.v)&&cell.v>=0&&cell.v<=Number.MAX_SAFE_INTEGER?cell.v:null

export function extractWorkbookPrices(bytes:Buffer):WorkbookPriceRow[]{
  const book=XLSX.read(bytes,{type:'buffer',cellFormula:true})
  const sheet=book.Sheets['단가표'];const discounts=book.Sheets['가격DB']
  if(!sheet||!discounts||sheet.B5?.v!=='사방넷품번'||sheet.E5?.v!=='모델명'||sheet.R5?.v!=='총원가'||sheet.S5?.v!=='정상가'||sheet.T5?.v!=='상시가'||sheet.V5?.v!=='기본행사가')throw new Error('Price workbook layout changed')
  const range=XLSX.utils.decode_range(sheet['!ref']??'A1:A1')
  if(range.e.r>100000)throw new Error('Workbook is too large')
  const readPrice=(row:number,col:PriceColumn,normal:number|null):number|null=>{
    const cell=sheet[`${col}${row}`];const value=numeric(cell)
    if(value===null||!cell?.f)return value
    const discountCol=discountColumns[col]
    const expected=`ROUNDDOWN(S${row}*(1-XLOOKUP(S${row},가격DB!$A$2:$A$35,가격DB!$${discountCol}$2:$${discountCol}$35,,-1)),-2)`
    if(cell.f!==expected||normal===null)return null
    const rules=Array.from({length:34},(_,i)=>({threshold:numeric(discounts[`A${i+2}`]),discount:numeric(discounts[`${discountCol}${i+2}`])})).filter((rule):rule is {threshold:number;discount:number}=>rule.threshold!==null&&rule.discount!==null&&rule.threshold<=normal&&rule.discount<=1).sort((a,b)=>b.threshold-a.threshold)
    if(!rules.length)return null
    const computed=Math.floor((normal*(1-rules[0].discount)+1e-7)/100)*100
    return computed===value?value:null
  }
  const literal=(cell:XLSX.CellObject|undefined)=>cell?.f?null:numeric(cell)
  const rows:WorkbookPriceRow[]=[]
  for(let row=6;row<=range.e.r+1;row++){
    const code=sheet[`B${row}`]?.v;const name=sheet[`E${row}`]?.v
    if((typeof code!=='string'&&typeof code!=='number')||typeof name!=='string'||!name.trim())continue
    const channel=sheet[`AH${row}`]?.v;const normal=literal(sheet[`S${row}`])
    rows.push({row,code:String(code).trim(),name:name.trim(),channel:typeof channel==='string'?channel.trim():'',values:{cost:literal(sheet[`R${row}`]),normal,regular:readPrice(row,'T',normal),basic:readPrice(row,'V',normal),medium:readPrice(row,'X',normal),large:readPrice(row,'Z',normal),live:readPrice(row,'AB',normal),group:literal(sheet[`AD${row}`])}})
  }
  return rows
}
