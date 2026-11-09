/* global fetch, console */
import {writeFile} from 'node:fs/promises'
const data=await(await fetch('http://127.0.0.1:4179/api/data')).json()
const channel=data.channels.find(c=>c.channelCode==='NAVER')
const listings=new Map(data.listings.filter(l=>l.channelId===channel?.id).map(l=>[l.id,l]))
// Model, quantity, master product and expected SKU. Color is deliberately ignored.
const productTable={'점보:1':['100051','AL00'],'1호:1':['100052','AL01'],'2호:1':['100224','AL02'],'3호:1':['100054','AL03'],'5호:1':['100055','AL05'],'7호:1':['100057','AL07'],'8호:1':['100058','AL08'],'9호:1':['100059','AL09'],'타워1호:1':['100226','AL11'],'타워3호:1':['100225','AL13'],'밀큐브:1':['100338','AL10'],'밀큐브세트:1':['100342','AL510'],'점보:4':['100188','AL00'],'1호:6':['100066','AL01'],'2호:4':['100300','AL02'],'3호:8':['100067','AL03'],'5호:8':['100835','AL05'],'7호:10':['100069','AL07'],'8호:8':['100070','AL08'],'9호:12':['100071','AL09'],'타워1호:4':['100301','AL11'],'타워3호:6':['100303','AL13']}
const plan=[]
for(const offer of data.offers){
 const listing=listings.get(offer.listingId)
 if(!listing||offer.masterProductId||offer.status!=='ACTIVE'||offer.channelOptionId!=='BASE')continue
 const name=listing.productName
 const model=/밀큐브세트/.test(name)?'밀큐브세트':/밀큐브/.test(name)?'밀큐브':/타워\s*1호/.test(name)?'타워1호':/타워\s*3호/.test(name)?'타워3호':/점보/.test(name)?'점보':name.match(/(?:^|[^\d])([1235789]호)(?!\d)/)?.[1]
 const n=name.match(/(\d+)개세트/)?.[1]??(name.match(/,\s*1개\s*$/)?'1':undefined)
 const quantity=model==='밀큐브세트'?'1':n
 const match=productTable[`${model}:${quantity}`]
 if(!match)continue
 const [code,sku]=match,product=data.products.find(p=>p.sabangnetCode===code&&p.status==='ACTIVE')
 if(!product)throw Error(`Missing product ${code}`)
 const parts=data.components.filter(c=>c.productId===product.id)
 const skus=parts.map(p=>({code:data.skus.find(s=>s.id===p.skuId)?.skuCode,quantity:p.quantity}))
 const count=model==='밀큐브세트'?1:Number(quantity)
 if(skus.length!==1||skus[0].code!==sku||skus[0].quantity!==count)throw Error(`Composition changed for ${code}`)
 plan.push({offerId:offer.id,productId:product.id,code,name:listing.productName,channelProductId:listing.channelProductId})
}
await writeFile('../outputs/local-registration/smartstore-singles-plan.json',JSON.stringify({createdAt:new Date().toISOString(),plan},null,2),'utf8')
console.log(JSON.stringify({count:plan.length,items:plan.map(p=>`${p.name} → ${p.code}`)},null,2))
