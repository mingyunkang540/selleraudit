/* global fetch,console */
import {writeFile} from 'node:fs/promises'
const d=await(await fetch('http://127.0.0.1:4179/api/data')).json(),ch=d.channels.find(c=>c.channelCode==='NAVER'),listings=new Map(d.listings.filter(l=>l.channelId===ch?.id).map(l=>[l.id,l]))
const table={'점보:1':['100051','AL00'],'1호:1':['100052','AL01'],'2호:1':['100224','AL02'],'3호:1':['100054','AL03'],'5호:1':['100055','AL05'],'7호:1':['100057','AL07'],'8호:1':['100058','AL08'],'9호:1':['100059','AL09'],'타워1호:1':['100226','AL11'],'타워3호:1':['100225','AL13'],'점보:3':['100127','AL00'],'1호:3':['100128','AL01'],'2호:3':['100516','AL02'],'3호:3':['100129','AL03'],'5호:3':['100130','AL05'],'7호:3':['100520','AL07'],'8호:3':['100132','AL08'],'9호:3':['100131','AL09'],'타워1호:3':['100523','AL11'],'타워3호:3':['100524','AL13']}
const named=[[/^NEW세트 /,'100227'],[/^밀큐브 6개 /,'100474'],[/^1호3개 5호3개세트 /,'100163'],[/^3호3 8호3 9호3 /,'100165'],[/^점보 3개세트 /,'100127'],[/^5호3개\+7호3개,/,'100161'],[/^용기만만세트 /,'100509'],[/^1-1\.\s*대용량세트 용기\+구성품,/,'100160'],[/^1-1\.\s*똑소리살림법세트 용기\+구성품,/,'100351']]
const plan=[]
for(const o of d.offers){
 const l=listings.get(o.listingId);if(!l||o.masterProductId||o.status!=='ACTIVE')continue
 let code,expectedSku,expectedQty
 if(['4894641136','9645767991'].includes(l.channelProductId)){
  const model=o.optionName.match(/옵션\d+\)\s*(타워1호|타워3호|점보|[1235789]호)/)?.[1]??o.optionName.match(/,(타워1호|타워3호|점보|[1235789]호)\(/)?.[1]
  const quantity=l.channelProductId==='9645767991'?3:1,entry=table[`${model}:${quantity}`]
  if(entry){[code,expectedSku]=entry;expectedQty=quantity}
 }else if(l.channelProductId==='12842775253'&&o.optionName==='아쿠아'){code='100342';expectedSku='AL510';expectedQty=1}
 else{const match=named.find(([pattern])=>pattern.test(o.optionName));code=match?.[1]}
 if(!code)continue
 const p=d.products.find(p=>p.sabangnetCode===code&&p.status==='ACTIVE');if(!p)throw Error(`Product missing ${code}`)
 if(expectedSku){const parts=d.components.filter(c=>c.productId===p.id);if(parts.length!==1||d.skus.find(s=>s.id===parts[0].skuId)?.skuCode!==expectedSku||parts[0].quantity!==expectedQty)throw Error(`Composition changed ${code}`)}
 plan.push({offerId:o.id,productId:p.id,code,listing:l.productName,option:o.optionName})
}
await writeFile('../outputs/local-registration/smartstore-option-mappings-plan.json',JSON.stringify({createdAt:new Date().toISOString(),plan},null,2),'utf8')
console.log(JSON.stringify({count:plan.length,byProduct:Object.fromEntries([...new Set(plan.map(o=>o.code))].map(code=>[code,plan.filter(o=>o.code===code).length]))}))
