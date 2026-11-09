/* global fetch, console */
import {readFile,writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:4179',{plan}=JSON.parse(await readFile('../outputs/local-registration/smartstore-option-mappings-plan.json','utf8'))
const session=await(await fetch(base+'/api/auth/session')).json();if(!session.openMode||session.user?.role!=='ADMIN')throw Error('Local administrator unavailable')
const data=await(await fetch(base+'/api/data')).json()
for(const row of plan){const offer=data.offers.find(o=>o.id===row.offerId),product=data.products.find(p=>p.id===row.productId);if(!offer||offer.masterProductId!==null||offer.status!=='ACTIVE'||product?.sabangnetCode!==row.code)throw Error('Plan changed')}
const report={status:'IN_PROGRESS',completed:[],startedAt:new Date().toISOString()},path='../outputs/local-registration/smartstore-option-mappings-result.json'
await writeFile(path,JSON.stringify(report,null,2),'utf8')
for(const row of plan){const result=await fetch(base+'/api/mapping',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://127.0.0.1:5174','X-CSRF-Token':session.csrf},body:JSON.stringify({offerId:row.offerId,productId:row.productId})});if(!result.ok){report.status='INTERRUPTED';await writeFile(path,JSON.stringify(report,null,2),'utf8');throw Error(`Mapping failed: ${result.status}`)}report.completed.push(row);await writeFile(path,JSON.stringify(report,null,2),'utf8')}
report.status='COMPLETED';await writeFile(path,JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify({status:report.status,mapped:report.completed.length}))
