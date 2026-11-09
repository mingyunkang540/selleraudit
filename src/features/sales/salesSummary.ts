import type {SalesDay} from './types'
const channelFamilies=[['스마트스토어','스마트스토어(도착보장)'],['쿠팡','쿠팡(로켓배송)']]
export function salesAxis(values:number[]){
 const min=Math.min(0,...values),max=Math.max(0,...values),span=Math.max(Math.abs(min),max)
 const raw=(span||1)/(min<0?2:4),power=10**Math.floor(Math.log10(raw)),ratio=raw/power
 const step=(ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power
 const lower=min<0?-2*step:0,upper=min<0?2*step:4*step
 return {lower,upper,ticks:Array.from({length:5},(_,i)=>upper-i*(upper-lower)/4)}
}
export function salesTotal(days:SalesDay[],channel:string):number|null{
 const values=days.map(day=>channel==='ALL'?day.total:day.channels[channel]).filter((value):value is number=>typeof value==='number'&&Number.isFinite(value))
 return values.length?values.reduce((sum,value)=>sum+value,0):null
}
export function groupSales(days:SalesDay[],channel:string,by:'day'|'month'){
 const groups=new Map<string,SalesDay[]>()
 for(const day of days){const key=by==='month'?day.date.slice(0,7):day.date;groups.set(key,[...(groups.get(key)??[]),day])}
 return [...groups].map(([label,items])=>({label,value:salesTotal(items,channel)})).sort((a,b)=>a.label.localeCompare(b.label))
}
export function groupBuyForMonth(days:SalesDay[],month:string){
 const rows=days.filter(day=>day.date.startsWith(month))
 if(!rows.length||rows.some(day=>typeof day.groupBuy!=='number'||!Number.isFinite(day.groupBuy)))return null
 const total=rows.reduce((sum,day)=>sum+day.total,0),groupBuy=rows.reduce((sum,day)=>sum+(day.groupBuy??0),0)
 if(total<0||groupBuy<0||groupBuy>total)return null
 return {groupBuy,nonGroupBuy:total-groupBuy,partial:rows.some(day=>day.groupBuyPartial)}
}

// Group related storefronts for ranking while retaining separate selectable rows.
export function rankSalesChannels(days:SalesDay[],channels:string[]){
 const groups=new Map<string,{name:string;value:number|null;position:number}[]>()
 for(const name of channels){
  const family=channelFamilies.find(items=>items.includes(name))
  const key=family?.[0]??name
  const rows=groups.get(key)??[]
  rows.push({name,value:salesTotal(days,name),position:family?family.indexOf(name):0})
  groups.set(key,rows)
 }
 return [...groups.entries()].map(([key,rows])=>({key,rows:rows.sort((a,b)=>a.position-b.position),values:rows.map(row=>row.value).filter((value):value is number=>value!==null)}))
  .sort((a,b)=>{
   if(!a.values.length||!b.values.length)return a.values.length?-1:b.values.length?1:a.key.localeCompare(b.key,'ko-KR')
   return b.values.reduce((sum,value)=>sum+value,0)-a.values.reduce((sum,value)=>sum+value,0)||a.key.localeCompare(b.key,'ko-KR')
  }).flatMap(group=>group.rows.map(({name,value})=>({name,value})))
}

export function salesChannelShares(days:SalesDay[],channels:string[]){
 const selected=['자사몰','스마트스토어','스마트스토어(도착보장)','쿠팡','쿠팡(로켓배송)','오늘의집','컬리']
 const totals=channels.map(name=>({name,value:salesTotal(days,name)}))
 if(totals.some(row=>row.value!==null&&row.value<0))return {rows:[],total:0,negative:true}
 const otherValues=totals.filter(row=>!selected.includes(row.name)&&row.value!==null).map(row=>row.value as number)
 const rows=[...selected.map(name=>({name,value:salesTotal(days,name)})),{name:'기타 (etc)',value:otherValues.length?otherValues.reduce((sum,value)=>sum+value,0):null}]
 return {rows,total:rows.reduce((sum,row)=>sum+(row.value??0),0),negative:false}
}

// Inclusive trailing calendar period ending at the snapshot date.
export function trailingStart(end:string, months:number):string {
 const [year,month,day]=end.split('-').map(Number)
 const target=new Date(Date.UTC(year,month-1-months,1))
 const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate()
 target.setUTCDate(Math.min(day,lastDay)+1)
 return target.toISOString().slice(0,10)
}
