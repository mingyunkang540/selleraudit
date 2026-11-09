/* global fetch,console */
import {writeFile} from 'node:fs/promises'
import process from 'node:process'
const base='http://127.0.0.1:4179'
async function get(path){const r=await fetch(base+path);if(!r.ok)throw Error(`Read failed ${path}`);return r.json()}
const session=await get('/api/auth/session');if(!session.openMode||session.user?.role!=='ADMIN')throw Error('Local administrator unavailable')
const data=await get('/api/data'),prices=(await get('/api/product-prices')).products,configs=await get('/api/product-configurations')
const definitions=[
 {code:'100160',name:'대용량세트',full:{AL502:2,AL09:4,A08:1,AL08:6,A03:1,AL05:4,AL01:2,A01:1,AL00:1,A04:1,AL07:8,AL03:2,A24:1},only:{AL05:6,AL07:8,AL08:6,AL09:4,AL01:2,AL00:1,AL03:2}},
 {code:'100351',name:'똑소리살림법세트',full:{A04:1,A02:1,AL10:6,AL00:2,A08:1,AL07:4,AL13:1,A01:1,AL05:4,A03:1,A24:1,AL09:4,AL08:4,AL01:1},only:{AL10:6,AL00:2,AL07:4,AL13:1,AL05:4,AL09:4,AL08:4,AL01:1}},
]
const keys=['normal','regular','basic','medium','large','live','group'],plans=[]
for(const def of definitions){
 const p=data.products.find(p=>p.sabangnetCode===def.code&&p.status==='ACTIVE');if(!p)throw Error(`Product unavailable ${def.code}`)
 if(configs.configurations.some(c=>c.productId===p.id))throw Error(`Existing configuration; review ${def.code}`)
 const actual=data.components.filter(c=>c.productId===p.id).map(c=>`${data.skus.find(s=>s.id===c.skuId)?.skuCode}:${c.quantity}`).sort()
 const expected=Object.entries(def.full).map(([k,v])=>`${k}:${v}`).sort();if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`Master composition changed ${def.code}`)
 const componentValues=values=>Object.entries(values).map(([code,quantity])=>{const s=data.skus.find(s=>s.skuCode===code&&s.status==='ACTIVE');if(!s)throw Error(`SKU unavailable ${code}`);return {skuId:s.id,quantity}})
 const source=prices.find(r=>r.productId===p.id);if(!source?.values||source.options.length)throw Error(`Prices unavailable ${def.code}`)
 const fullPrices=Object.fromEntries(keys.map(k=>[k,source.values[k]??null])),emptyPrices=Object.fromEntries(keys.map(k=>[k,null]))
 const listingIds=new Set(data.listings.filter(l=>l.channelProductId&&(data.channels.find(c=>c.id===l.channelId)?.channelCode==='NAVER')).map(l=>l.id))
 const offers=data.offers.filter(o=>listingIds.has(o.listingId)&&o.status==='ACTIVE'&&typeof o.optionName==='string'&&o.optionName.includes(def.name)&&/용기(?:\+구성품|만),/.test(o.optionName))
 if(offers.length!==8||offers.filter(o=>o.optionName.includes('용기만,')).length!==4||offers.filter(o=>o.optionName.includes('용기+구성품,')).length!==4||offers.some(o=>o.masterProductId!==null&&o.masterProductId!==p.id))throw Error(`Unexpected offers ${def.code}`)
 plans.push({productId:p.id,code:def.code,full:{name:'용기+구성품',prices:fullPrices,components:componentValues(def.full)},only:{name:'용기만',prices:emptyPrices,components:componentValues(def.only)},offers:offers.map(o=>({id:o.id,type:o.optionName.includes('용기만,')?'only':'full',name:o.optionName}))})
}
if(process.argv.includes('--dry-run')){console.log(JSON.stringify({products:plans.length,configurations:plans.length*2,bindings:plans.reduce((n,p)=>n+p.offers.length,0)}));process.exit(0)}
const report={status:'IN_PROGRESS',createdAt:new Date().toISOString(),configs:[],bindings:[]},path='../outputs/local-registration/confirmed-configurations-result.json'
await writeFile(path,JSON.stringify(report,null,2),'utf8')
async function post(path,body){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://127.0.0.1:5174','X-CSRF-Token':session.csrf},body:JSON.stringify(body)});if(!r.ok)throw Error(`Write failed ${path} (${r.status})`);return r.json()}
for(const plan of plans){
 const ids={}
 for(const type of ['full','only']){const result=await post('/api/product-configurations',{productId:plan.productId,...plan[type]});ids[type]=result.id;report.configs.push({product:plan.code,type,id:result.id});await writeFile(path,JSON.stringify(report,null,2),'utf8')}
 for(const offer of plan.offers){await post('/api/mapping/configuration',{offerId:offer.id,configurationId:ids[offer.type]});report.bindings.push({offerId:offer.id,configurationId:ids[offer.type],name:offer.name});await writeFile(path,JSON.stringify(report,null,2),'utf8')}
}
report.status='COMPLETED';await writeFile(path,JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify({status:report.status,configurations:report.configs.length,bindings:report.bindings.length}))
