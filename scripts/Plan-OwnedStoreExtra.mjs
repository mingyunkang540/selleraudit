import {readFile,writeFile} from 'node:fs/promises'
import {log} from 'node:console'
const data=JSON.parse(await readFile('../outputs/local-registration/own-store-matching-input.json','utf8'))
const rules=[
 ['P00000EU',/^(아쿠아|쿨라벤더|투명그레이|핑크)$/,'100160','663d12aa-d5e4-451e-b888-ec1219dbd05b'],
 ['P00000HK',/^(아쿠아|쿨라벤더|투명그레이|핑크)$/,'100160','663d12aa-d5e4-451e-b888-ec1219dbd05b'],
 ['P00000FZ',/^(아쿠아|쿨라벤더|투명그레이|핑크)$/,'100351','8d647949-a68f-49fc-b553-f17cbebebb58'],
 ['P00000QT',/^빨대세트 \(트라이탄 빨대 2P\+세척솔 1P\)$/,'100989'],
 ['P00000KN',/^(라벤더|블루)$/,'100787'],['P00000KM',/^(라벤더|블루)$/,'100787'],
 ['P00000HA',/^컬러믹스_(쿨라벤더|투명그레이|핑크)\+아쿠아$/,'100365'],
 ['P00000ES',/^점보3개 1호3개세트 /,'100162'],['P00000ER',/^5호3개 7호3개세트 /,'100161'],['P00000ET',/^1호3개 5호3개세트 /,'100163'],
 ['P00000EE',/^NEW세트 (아쿠아|쿨라벤더|투명그레이|핑크)$/,'100227'],['P00000GX',/^단품$/,'100368'],
 ['P00000EL',/^마스터세트 (아쿠아|쿨라벤더|투명그레이|핑크)$/,'100172'],['P00000HE',/^(아쿠아|쿨라벤더|투명그레이|핑크)$/,'100387'],
 ['P00000FQ',/^(아쿠아|쿨라벤더|투명그레이|핑크)$/,'100342'],['P00000KO',/^밀큐브 6개세트 /,'100474'],
 ['P00000HD',/^(아쿠아|쿨라벤더|투명그레이|핑크)$/,'100388'],['P00000EQ',/^3호3 8호3 9호3 /,'100165'],
 ['P00000JM',/^용기만만세트 (아쿠아|쿨라벤더|투명그레이|핑크)$/,'100509'],['P00000HC',/^살림비법세트 (투명그레이|핑크)$/,'100231'],
 ['P00000DV',/^핑크$/,'100306'],['P00000JT',/^단품$/,'100752'],['P00000JU',/^단품$/,'100753'],['P00000RI',/^단품$/,'100781'],
 ['P00000LZ',/^아쿠아$/,'100338'],['P00000FV',/^단품$/,'100338'],['P00000FW',/^단품$/,'100338'],['P00000FU',/^단품$/,'100338'],
 ['P00000FS',/^단품$/,'100342'],['P00000QU',/^단품$/,'100342'],['P00000FR',/^단품$/,'100342'],['P00000LR',/^아쿠아$/,'100342'],
 ['P00000OH',/^라벨러 단품$/,'100867'],['P00000OH',/^라벨러\+용기세트 (아쿠아|쿨라벤더|투명그레이|핑크)$/,'100869'],
 ['P00000OO',/^3015\/4020\/5030\/5015 \(4종\)$/,'100868'],
 ['P00000JP',/^1\. 빅팩\(점보1개\+1호1개\)\//,'100388'],['P00000JP',/^2\. 길쭉팩\(2호1개\+3호1개\)\//,'100383'],
 ['P00000JP',/^3\. 만능팩\(5호1개\+7호1개\)\//,'100387'],['P00000JP',/^4\. 국밥팩\(8호1개\+9호1개\)\//,'100386'],
 ['P00000JP',/^5\. 타워팩\(타워1호1개\+타워3호1개\)\//,'100389'],['P00000JP',/^6\. 밀큐브 6개\//,'100474'],
 ['P00000IX',/^아쿠아 5호 3개$/,'100130'],['P00000IX',/^아쿠아 7호 3개$/,'100520'],['P00000IX',/^아쿠아 8호 3개$/,'100132'],['P00000IX',/^아쿠아 9호 3개$/,'100131'],
]
const labels={'3015':'라벨용지 3015 4개세트','4020':'라벨용지 4020 4개세트','5015':'라벨용지 5015 4개세트','5030':'라벨용지 5030 4개세트'}
const plan=[]
for(const offer of data.offers){
 if(offer.status!=='ACTIVE')continue
 const rule=rules.find(([id,pattern])=>offer.channel_product_id===id&&pattern.test(offer.option_name))
 const label=offer.channel_product_id==='P00000OO'?offer.option_name.match(/^(3015|4020|5015|5030) \(4개\)$/):null
 const cube=offer.channel_product_id==='P00000IW'&&offer.option_name==='밀큐브 핑크 5개세트'
 const matches=label?data.products.filter(p=>p.product_name===labels[label[1]]):cube?data.products.filter(p=>p.product_name==='밀큐브 5개'):rule?data.products.filter(p=>p.sabangnet_code===rule[2]):[]
 if(matches.length!==1)continue
 const product=matches[0]
 plan.push({offerId:offer.id,productId:product.id,listingCode:offer.channel_product_id,optionId:offer.channel_option_id,listing:offer.product_name,option:offer.option_name,product:product.product_name,code:product.sabangnet_code,components:product.components.map(c=>({sku:c.sku,quantity:c.quantity})).sort((a,b)=>a.sku.localeCompare(b.sku)),configurationId:rule?.[3]??null})
}
const tests=data.offers.filter(o=>o.product_name==='테스트'&&o.channel_product_id==='P00000GA').map(o=>({offerId:o.id,listingCode:o.channel_product_id,optionId:o.channel_option_id,listing:o.product_name,option:o.option_name}))
await writeFile('../outputs/local-registration/own-store-extra-plan.json',JSON.stringify({plan,tests},null,2),'utf8')
log(JSON.stringify({count:plan.length,tests:tests.length,byCode:Object.fromEntries([...new Set(plan.map(x=>x.listingCode))].map(code=>[code,plan.filter(x=>x.listingCode===code).length]))},null,2))
