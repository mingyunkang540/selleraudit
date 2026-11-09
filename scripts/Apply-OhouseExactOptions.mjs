/* global fetch, console */
import { readFile,writeFile } from 'node:fs/promises'
const base='http://127.0.0.1:4179'
const {plan}=JSON.parse(await readFile('../outputs/local-registration/ohouse-exact-options-plan.json','utf8'))
const session=await (await fetch(base+'/api/auth/session')).json()
if(!session.openMode || session.user?.role!=='ADMIN' || !session.csrf)throw Error('Local admin session required')
const data=await (await fetch(base+'/api/data')).json()
for(const row of plan){
  const o=data.offers.find(o=>o.id===row.offerId)
  const p=data.products.find(p=>p.id===row.productId)
  if(!o||o.status!=='ACTIVE'||o.masterProductId!==row.oldProductId||o.optionName!==row.option||!p||p.status!=='ACTIVE'||p.sabangnetCode!==row.code)throw Error('Plan is stale; no changes made')
}
const report={startedAt:new Date().toISOString(),status:'IN_PROGRESS',completed:[],failed:null}
const path='../outputs/local-registration/ohouse-exact-options-result.json'
await writeFile(path,JSON.stringify(report,null,2),'utf8')
for(const row of plan){
  try{
    const result=await fetch(base+'/api/mapping',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://127.0.0.1:5174','X-CSRF-Token':session.csrf},body:JSON.stringify({offerId:row.offerId,productId:row.productId})})
    if(!result.ok)throw Error(`HTTP ${result.status}`)
    report.completed.push(row)
    await writeFile(path,JSON.stringify(report,null,2),'utf8')
  }catch(error){report.failed={offerId:row.offerId,message:String(error)};report.status='INTERRUPTED';await writeFile(path,JSON.stringify(report,null,2),'utf8');throw error}
}
report.status='COMPLETED';report.completedAt=new Date().toISOString()
await writeFile(path,JSON.stringify(report,null,2),'utf8')
console.log(JSON.stringify({status:report.status,mapped:report.completed.length}))
