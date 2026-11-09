/* global fetch, console */
import {writeFile} from 'node:fs/promises'
const base='http://127.0.0.1:4179'
async function read(path){const r=await fetch(base+path);if(!r.ok)throw Error('Local data unavailable');return r.json()}
const data=await read('/api/data'),{candidates}=await read('/api/ohouse-candidates')
const safeCodes=new Set('100127 100211 100051 100058 100128 100183 100130 100466 100225 100464 100779 100032 100054 100055 100461 100052 100342 100131 100219 100007 100161 100122 100215 100224 100520 100967 100226 100369 100057 100129 100008 100132 100462 100338 100463 100465 100523 100524 100368 100059 100288 100006 100516 100785 100011 100778'.split(' '))
const colors=new Set(['아쿠아','핑크','투명그레이','투명 그레이','쿨라벤더','쿨 라벤더'])
const listingTargets=new Map([['1037467','100034'],['1037265','100031'],['3685919','100786'],['3685927','100787'],['3154268','100366'],['2224329','100275'],['3154267','100365'],['3986473','100869'],['2307037','100223']])
const ch=data.channels.find(c=>c.channelCode==='OHOUSE')
if(!ch)throw Error('Channel unavailable')
const listings=new Map(data.listings.filter(l=>l.channelId===ch.id&&l.status==='ACTIVE').map(l=>[l.id,l]))
const result=[]
for(const o of data.offers){
 const listing=listings.get(o.listingId)
 if(!listing||o.status!=='ACTIVE'||o.masterProductId!==null)continue
 let code
 const evidence=candidates.find(c=>c.productCode===listing.channelProductId&&c.optionCode===o.channelOptionId)
 if(colors.has(o.optionName)&&safeCodes.has(evidence?.candidateCode))code=evidence.candidateCode
 if(listingTargets.has(listing.channelProductId)&&/^(아쿠아|핑크|투명그레이|투명 그레이|쿨라벤더|쿨 라벤더|라벤더|블루|화이트|블랙|컬러믹스_투명그레이\+아쿠아|컬러믹스_쿨라벤더\+아쿠아)$/.test(o.optionName))code=listingTargets.get(listing.channelProductId)
 if(listing.channelProductId==='4090114'&&o.optionName==='단품')code='100990'
 if(listing.channelProductId==='4083891'&&o.optionName==='단품')code='100988'
 if(listing.productName==='입문용! 소분 냉동용기 3P세트'&&/^7호 2P\+칸칸이 24구 1P \/ /.test(o.optionName))code='100313'
 if(!code)continue
 const matches=data.products.filter(p=>p.sabangnetCode===code&&p.status==='ACTIVE')
 if(matches.length!==1)throw Error(`Product unavailable ${code}`)
 const product=matches[0],parts=data.components.filter(c=>c.productId===product.id)
 if(!parts.length||parts.some(part=>!data.skus.find(s=>s.id===part.skuId)))throw Error(`Missing product composition ${code}`)
 if(code==='100313'){
  const actual=parts.map(part=>`${data.skus.find(s=>s.id===part.skuId).skuCode}:${part.quantity}`).sort().join(',')
  if(actual!=='A24:1,AL07:2')throw Error('3P composition changed')
 }
 result.push({offerId:o.id,oldProductId:null,productId:product.id,code,productName:product.productName,option:o.optionName,optionCode:o.channelOptionId,listingCode:listing.channelProductId,salePrice:o.salePrice})
}
await writeFile('../outputs/local-registration/ohouse-exact-options-plan.json',JSON.stringify({createdAt:new Date().toISOString(),policy:'Ignore color; require matching model and quantity',plan:result},null,2),'utf8')
console.log(JSON.stringify({total:result.length,byOption:Object.fromEntries([...new Set(result.map(x=>x.option))].map(n=>[n,result.filter(x=>x.option===n).length]))},null,2))
