/* global fetch,console */
import {writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:4179'
const get=async path=>{const r=await fetch(base+path);if(!r.ok)throw Error(`Read failed: ${path}`);return r.json()}
const session=await get('/api/auth/session')
if(!session.openMode||session.user?.role!=='ADMIN')throw Error('Local admin unavailable')
const data=await get('/api/data'), configurations=await get('/api/product-configurations')
const definitions=[{code:'100160',name:'대용량세트 (용기만)',bom:{AL05:6,AL07:8,AL08:6,AL09:4,AL01:2,AL00:1,AL03:2}},{code:'100351',name:'똑소리 살림법 세트 (용기만)',bom:{AL10:6,AL00:2,AL07:4,AL13:1,AL05:4,AL09:4,AL08:4,AL01:1}}]
const plan=definitions.map(def=>{
 const original=data.products.find(p=>p.sabangnetCode===def.code&&p.status==='ACTIVE')
 if(!original||data.products.some(p=>p.productName===def.name))throw Error(`Product state changed: ${def.code}`)
 const config=configurations.configurations.find(c=>c.productId===original.id&&c.name==='용기만')
 if(!config||Object.values(config.prices).some(v=>v!==null))throw Error(`Configuration needs review: ${def.code}`)
 const bound=configurations.bindings.filter(b=>b.configurationId===config.id)
 const offers=bound.map(b=>data.offers.find(o=>o.id===b.offerId))
 if(offers.length!==4||offers.some(o=>!o||o.masterProductId!==original.id||o.status!=='ACTIVE'||!o.optionName?.includes('용기만,')))throw Error(`Offers changed: ${def.code}`)
 if(config.components.some(c=>!data.skus.find(s=>s.id===c.skuId&&s.status==='ACTIVE')))throw Error(`SKU unavailable: ${def.code}`)
 const actual=config.components.map(c=>`${data.skus.find(s=>s.id===c.skuId).skuCode}:${c.quantity}`).sort()
 const expected=Object.entries(def.bom).map(([sku,quantity])=>`${sku}:${quantity}`).sort()
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`Composition changed: ${def.code}`)
 return {original,config,offers,name:def.name}
})
const report={state:'IN_PROGRESS',items:[]},reportPath='../outputs/local-registration/container-only-split.json'
const save=()=>writeFile(reportPath,JSON.stringify(report,null,2),'utf8')
const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:5174','X-CSRF-Token':session.csrf},body:JSON.stringify(body)});if(!r.ok)throw Error(`Request failed: ${path} (${r.status})`);return r.json()}
await save()
for(const p of plan){
 const entry={name:p.name,originalId:p.original.id,productId:null,offers:[]};report.items.push(entry);await save()
 const prices=Object.fromEntries(['cost','normal','regular','basic','medium','large','live','group'].map(k=>[k,null]))
 const created=await post('/api/product-master',{sabangnetCode:'',productName:p.name,category:p.original.category,productType:'SET',status:'ACTIVE',prices,components:p.config.components})
 entry.productId=created.id;await save()
 for(const offer of p.offers){await post('/api/mapping',{offerId:offer.id,productId:created.id});entry.offers.push(offer.id);await save()}
}
report.state='COMPLETED';await save();console.log(JSON.stringify(report))
