import {readFile,writeFile} from 'node:fs/promises'
import {log} from 'node:console'

const data=JSON.parse(await readFile('../outputs/local-registration/own-store-matching-input.json','utf8'))
const old=JSON.parse(await readFile('../outputs/local-registration/owned-store-preview.json','utf8'))
const verified=JSON.parse(await readFile('../outputs/local-registration/own-store-verified-links.json','utf8'))
const oldMapped=new Map(old.listings.filter(x=>x.masterProductId).map(x=>[x.id,x.masterProductId]))
const verifiedByCode=new Map(verified.map(x=>[x.id,x]))
const sku={점보:'AL00','1호':'AL01','2호':'AL02','3호':'AL03','5호':'AL05','7호':'AL07','8호':'AL08','9호':'AL09','타워1호':'AL11','타워3호':'AL13'}
const color='(?:쿨라벤더|라벤더|투명그레이|그레이|크림화이트|화이트|아쿠아|핑크|블루)'
const colorOnly=new RegExp(`^${color}$`,'i')
const explicit=new RegExp(`^(?:${color}\\s*[/,]\\s*)?(타워\\s*[13]호|[1235789]호|점보)\\s*(?:\\(\\s*\\d+\\s*ml\\s*\\))?\\s*(\\d+)\\s*(?:개|p)(?:\\s*세트)?(?:\\s*[/, ]\\s*${color})?$`,'i')
const singleParent=new RegExp(`(타워\\s*[13]호|[1235789]호|점보)\\s*(?:\\(\\s*\\d+\\s*ml\\s*\\))?\\s*(\\d+)\\s*(?:개|p)\\s*세트`,'ig')
const simpleOption=new RegExp(`^(?:${color}\\s*[/,]\\s*)?(타워\\s*[13]호|[1235789]호|점보)\\s*\\(\\s*[\\d,]+\\s*ml\\s*\\)$`,'i')
const plainProduct=new RegExp(`^땡스소윤\\s*(?:아쿠아\\s*)?(?:땡스소윤\\s*)?냉동용기\\s*(타워\\s*[13]호|[1235789]호|점보)\\s*(?:\\(\\s*[\\d,]+\\s*ml\\s*\\)|[\\d,]+\\s*ml)(?:\\s*(\\d+)\\s*개\\s*세트)?(?:\\s*${color})?$`,'i')
const plan=[]
for(const offer of data.offers){
 if(offer.status!=='ACTIVE')continue
 let product,reason
 const opt=offer.option_name.trim()
 const match=opt.match(explicit)
 const one=opt.match(simpleOption)
 const plain=offer.product_name.trim().match(plainProduct)
 const divider=opt.match(/^칸칸이\s*(4|8|24)구$/)
 const original=verifiedByCode.get(offer.channel_product_id)
 if(match){
  const model=match[1].replace(/\s/g,''),quantity=Number(match[2]),wanted=sku[model]
  const candidates=data.products.filter(p=>p.components.length===1&&p.components[0].sku===wanted&&p.components[0].quantity===quantity)
  if(candidates.length===1){product=candidates[0];reason='옵션의 호수와 수량이 SKU 구성과 일치'}
 } else if(divider){
  const wanted={4:'A04',8:'A08',24:'A24'}[divider[1]]
  const candidates=data.products.filter(p=>p.components.length===1&&p.components[0].sku===wanted&&p.components[0].quantity===1)
  if(candidates.length===1){product=candidates[0];reason='옵션의 칸칸이 크기와 SKU 구성 일치'}
 } else if(one){
  const model=one[1].replace(/\s/g,''),wanted=sku[model]
  const candidates=data.products.filter(p=>p.components.length===1&&p.components[0].sku===wanted&&p.components[0].quantity===1)
  if(candidates.length===1){product=candidates[0];reason='단품 옵션의 호수와 SKU 구성 일치'}
 } else if(plain&&(opt==='단품'||colorOnly.test(opt))){
  const model=plain[1].replace(/\s/g,''),quantity=plain[2]?Number(plain[2]):1,wanted=sku[model]
  const candidates=data.products.filter(p=>p.components.length===1&&p.components[0].sku===wanted&&p.components[0].quantity===quantity)
  if(candidates.length===1){product=candidates[0];reason='단일 품목 상품의 호수와 수량이 SKU 구성과 일치'}
 } else if(original&&original.name===offer.product_name&&(opt==='단품'||colorOnly.test(opt))&&!/대용량세트|똑소리|증정|사은|추가|택\s*1|랜덤|\+/.test(offer.product_name)){
  product=data.products.find(p=>p.id===original.masterProductId);reason='원본 마스터의 자사몰 코드와 현재 SKU 구성 검증 완료'
 } else if(opt==='단품'&&oldMapped.has(offer.channel_product_id)){
  product=data.products.find(p=>p.id===oldMapped.get(offer.channel_product_id));reason='기존 마스터 원본 코드·구성 검증 완료 단품'
 } else if(colorOnly.test(opt) && !/증정|사은|추가|택\s*1|랜덤|\+|포함/.test(offer.product_name)){
  const found=[...offer.product_name.matchAll(singleParent)]
  if(found.length===1){const model=found[0][1].replace(/\s/g,''),quantity=Number(found[0][2]),wanted=sku[model];const candidates=data.products.filter(p=>p.components.length===1&&p.components[0].sku===wanted&&p.components[0].quantity===quantity);if(candidates.length===1){product=candidates[0];reason='색상 옵션과 상품명의 호수·수량이 SKU 구성과 일치'}}
 }
 if(product)plan.push({offerId:offer.id,productId:product.id,listingCode:offer.channel_product_id,optionId:offer.channel_option_id,listing:offer.product_name,option:offer.option_name,product:product.product_name,code:product.sabangnet_code,components:product.components.map(c=>({sku:c.sku,quantity:c.quantity})).sort((a,b)=>a.sku.localeCompare(b.sku)),reason})
}
await writeFile('../outputs/local-registration/own-store-mapping-plan.json',JSON.stringify({plan},null,2),'utf8')
const grouped=Object.values(Object.groupBy(plan,x=>`${x.listing} → ${x.product}`)).map(items=>({count:items.length,listing:items[0].listing,option:items[0].option,product:items[0].product,reason:items[0].reason}))
log(JSON.stringify({count:plan.length,groups:grouped},null,2))
