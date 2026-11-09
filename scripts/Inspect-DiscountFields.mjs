/* global console */
import * as XLSX from 'xlsx'
import {readFile} from 'node:fs/promises'
const book=XLSX.read(await readFile('sample/스마트스토어상품목록.xlsx'),{type:'buffer',cellDates:true,nodim:true})
console.log(JSON.stringify({sheets:book.SheetNames}))
for(const name of book.SheetNames){
 const rows=XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,defval:'',raw:true})
 const target=rows.findIndex(row=>row.some(v=>String(v)==='9645767991'))
 const headers=rows.slice(0,5).map((row,i)=>({row:i+1,values:row.map((v,j)=>({col:j+1,value:v})).filter(x=>/할인|기간|판매가|상품번호|옵션가/.test(String(x.value)))}))
 console.log(JSON.stringify({sheet:name,target:target+1,headers,targetValues:target<0?[]:rows[target].map((v,j)=>({col:j+1,value:v})).filter(x=>x.col<=16||headers.some(h=>h.values.some(y=>y.col===x.col)))}))
 const stats={immediate:{},scheduled:{},scheduledPeriods:[]}
 for(const row of rows.slice(5)){if(row[57]!==''||row[58]!==''){const k=`${row[58]}:${row[57]}`;stats.immediate[k]=(stats.immediate[k]??0)+1}if(row[61]!==''||row[62]!==''||row[63]!==''){const k=`${row[62]}:${row[61]}`;stats.scheduled[k]=(stats.scheduled[k]??0)+1;stats.scheduledPeriods.push({id:row[0],period:row[63],value:row[61],unit:row[62]})}}
 console.log(JSON.stringify(stats))
}
