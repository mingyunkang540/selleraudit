/* global fetch, console */
import { writeFile } from 'node:fs/promises'
const response=await fetch('http://127.0.0.1:4179/api/data')
if(!response.ok)throw Error('Local data unavailable')
const data=await response.json()
const candidateResponse=await fetch('http://127.0.0.1:4179/api/ohouse-candidates')
if(!candidateResponse.ok)throw Error('Candidate evidence unavailable')
const {candidates:sourceCandidates}=await candidateResponse.json()
const known=new Map([
 ['[추가] 채반(중)_점보/5호전용','100027'],
 ['[추가] 채반(대)_점보/1호전용','100026'],
 ['[추가] 트레이','100025'],
 ['[추가] 칸칸이 4구_7호전용','100028'], ['[추가] 칸칸이 4구','100028'], ['냉동실전용 밀폐용기 칸칸이 4구','100028'],
 ['[추가] 칸칸이 8구_7호전용','100029'], ['[추가] 칸칸이 8구','100029'], ['냉동실전용 밀폐용기 칸칸이 8구','100029'],
 ['[추가] 칸칸이 24구_7호전용','100030'], ['[추가] 칸칸이 24구','100030'], ['냉동실전용 밀폐용기 칸칸이 24구','100030'],
 ['[추가] 용지 화이트_5015','100877'], ['[추가] 용지 화이트_4020','100878'],
 ['[추가] 용지 화이트_3015','100879'], ['[추가] 용지 화이트_5030','100876'],
 ['[추가] 미니어처 투웨이 로프 스트랩 키링','100990'],
 ['[추가] 트라이탄 빨대세트(빨대2P+청소솔1P)','100989'],
])
const expected=new Map([['100027','A02'],['100026','A01'],['100025','A03'],['100028','A04'],['100029','A08'],['100030','A24'],['100877','DW5015'],['100878','DW4020'],['100879','DW3015'],['100876','DW5030'],['100990','IBAKL'],['100989','IBASS21']])
// Hand-checked listing names and master identifiers; ambiguous set names are excluded.
const lavenderCodes=new Set('100127 100211 100051 100058 100128 100183 100130 100466 100225 100464 100779 100032 100054 100055 100461 100052 100342 100131 100219 100007 100161 100122 100215 100224 100520 100967 100226 100369 100057 100129 100008 100132 100462 100338 100463 100465 100523 100524 100368 100059 100288 100006 100516 100785 100011 100778'.split(' '))
const channel=data.channels.find(c=>c.channelCode==='OHOUSE')
if(!channel)throw Error('Channel missing')
const listings=new Map(data.listings.filter(l=>l.channelId===channel.id).map(l=>[l.id,l]))
const plan=[]
for(const offer of data.offers){
  const listing=listings.get(offer.listingId)
  const source=listing&&['쿨라벤더','쿨 라벤더'].includes(offer.optionName)?sourceCandidates.find(c=>c.productCode===listing.channelProductId&&c.optionCode===offer.channelOptionId):null
  const code=known.get(offer.optionName)??(source&&lavenderCodes.has(source.candidateCode)?source.candidateCode:undefined)
  if(!listing||listing.status!=='ACTIVE'||offer.status!=='ACTIVE'||!code)continue
  const candidates=data.products.filter(p=>p.sabangnetCode===code&&p.status==='ACTIVE')
  if(candidates.length!==1)throw Error(`Product unavailable ${code}`)
  const product=candidates[0]
  const components=data.components.filter(c=>c.productId===product.id)
  if(expected.has(code)){
    const sku=components.length===1?data.skus.find(s=>s.id===components[0].skuId):null
    if(!sku||sku.skuCode!==expected.get(code)||components[0].quantity!==1)throw Error(`Composition mismatch ${code}`)
  }else{
    const skus=components.map(c=>data.skus.find(s=>s.id===c.skuId))
    if(!skus.length||skus.some(s=>!s || (s.color && s.color!=='라벤더'))||!skus.some(s=>s?.color==='라벤더'))continue
  }
  if(offer.masterProductId===product.id)continue
  plan.push({offerId:offer.id,oldProductId:offer.masterProductId,productId:product.id,code,productName:product.productName,option:offer.optionName,optionCode:offer.channelOptionId,listingCode:listing.channelProductId,salePrice:offer.salePrice})
}
await writeFile('../outputs/local-registration/ohouse-exact-options-plan.json',JSON.stringify({createdAt:new Date().toISOString(),plan},null,2),'utf8')
console.log(JSON.stringify({total:plan.length,newMappings:plan.filter(p=>p.oldProductId===null).length,corrections:plan.filter(p=>p.oldProductId!==null).length,targets:Object.fromEntries([...new Set(plan.map(p=>p.productName))].map(name=>[name,plan.filter(p=>p.productName===name).length]))},null,2))
