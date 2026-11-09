/* global fetch, console */
import { writeFile } from 'node:fs/promises'
const base='http://127.0.0.1:4179'
const data=await (await fetch(base+'/api/data')).json()
const prices=(await (await fetch(base+'/api/product-prices')).json()).products
const ch=data.channels.find(c=>c.channelCode==='OHOUSE')
const listings=new Map(data.listings.filter(l=>l.channelId===ch.id).map(l=>[l.id,l]))
const products=new Map(data.products.map(p=>[p.id,p]))
const priced=new Map(prices.map(p=>[p.productId,p]))
const active=data.offers.filter(o=>listings.has(o.listingId)&&o.status==='ACTIVE')
const unmatched=active.filter(o=>!o.masterProductId)
const mapped=active.filter(o=>o.masterProductId)
const flagged=[]
const variantReview=[]
for(const o of mapped){
 const product=products.get(o.masterProductId),row=priced.get(o.masterProductId),v=row?.options?.length?null:row?.values
 const listing=listings.get(o.listingId)
 const components=data.components.filter(c=>c.productId===o.masterProductId).map(c=>data.skus.find(s=>s.id===c.skuId)).filter(Boolean)
 if(components.some(s=>s.color==='라벤더')&&(/아쿠아|핑크|그레이/.test(o.optionName??'')||(o.optionName==='단품'&&/아쿠아/.test(listing.productName))))variantReview.push({listing:listing.productName,option:o.optionName,optionCode:o.channelOptionId,product:product?.productName,code:product?.sabangnetCode})
 let reason
 if(o.salePrice!=null&&v?.normal!=null&&o.salePrice>v.normal)reason='정상가 초과'
 else if(o.salePrice!=null&&v?.live!=null&&o.salePrice<v.live)reason='원데이/라이브가 미만'
 else if(o.salePrice==null||v?.normal==null||v?.live==null||v.live>v.normal)reason='비교 가격 확인 필요'
 if(reason)flagged.push({product:product?.productName,code:product?.sabangnetCode,listing:listings.get(o.listingId).productName,option:o.optionName,optionCode:o.channelOptionId,price:o.salePrice,normal:v?.normal??null,live:v?.live??null,reason})
}
const count=arr=>Object.fromEntries([...new Set(arr)].map(x=>[x,arr.filter(y=>x===y).length]).sort((a,b)=>b[1]-a[1]))
const report={createdAt:new Date().toISOString(),active:active.length,mapped:mapped.length,unmatched:unmatched.length,inactive:data.offers.filter(o=>listings.has(o.listingId)&&o.status!=='ACTIVE').length,unmatchedOptions:count(unmatched.map(o=>o.optionName)),flaggedReasons:count(flagged.map(o=>o.reason)),unmatchedDetails:unmatched.map(o=>({listing:listings.get(o.listingId).productName,listingCode:listings.get(o.listingId).channelProductId,option:o.optionName,optionCode:o.channelOptionId,price:o.salePrice})),flagged,variantReview}
await writeFile('../outputs/local-registration/ohouse-current-review.json',JSON.stringify(report,null,2),'utf8')
const fmt=v=>v==null?'미확인':`${Number(v).toLocaleString('ko-KR')}원`
const lines=['# 오늘의집 매칭 확인 목록','',`활성 옵션 ${active.length}건 중 연결 ${mapped.length}건, 미연결 ${unmatched.length}건. 미사용 옵션 ${report.inactive}건.`, '', '## 오늘의집 매니아세트 구성','', '- 사용자 확인: 오늘의집 매니아세트 30P는 매니아 세트 29종(100009)에 키친마카 D18 1개를 증정으로 추가한 구성입니다.', '- 기존 연결된 쿨라벤더 옵션은 29종에만 연결되어 있어 D18을 별도로 표현하지 못합니다. 나머지 4개 옵션도 같은 구성입니다. 옵션 단위 추가 구성 기능이 필요합니다.','', '## 색상을 생략한 연결 참고','', '아래 옵션은 판매 색상과 연결된 마스터 상품의 기본 SKU 색상이 다릅니다. 요청에 따라 색상을 매칭 기준에서 제외했습니다. 실제 색상별 SKU 재고를 차감할 때는 사용하면 안 됩니다.','',...variantReview.map((o,i)=>`${i+1}. ${o.listing} / ${o.option} → ${o.product} (${o.code}), 옵션번호 ${o.optionCode}`),'','## 미연결 옵션','',...report.unmatchedDetails.map((o,i)=>`${i+1}. ${o.listing} / ${o.option??'단일 옵션'} — 상품번호 ${o.listingCode}, 옵션번호 ${o.optionCode}, 판매가 ${fmt(o.price)}`),'','## 연결된 옵션의 가격 확인','',...(flagged.length?flagged.map((o,i)=>`${i+1}. ${o.reason}: ${o.product} (${o.code}) / ${o.listing} / ${o.option??'단일 옵션'} — 판매가 ${fmt(o.price)}, 정상가 ${fmt(o.normal)}, 원데이·라이브 ${fmt(o.live)}, 옵션번호 ${o.optionCode}`):['현재 확인할 가격 이상 항목이 없습니다.'])]
await writeFile('../outputs/local-registration/오늘의집-매칭-확인목록.md',lines.join('\n')+'\n','utf8')
console.log(JSON.stringify({active:report.active,mapped:report.mapped,unmatched:report.unmatched,inactive:report.inactive,variantReview:variantReview.length,unmatchedOptions:report.unmatchedOptions,flaggedReasons:report.flaggedReasons},null,2))
