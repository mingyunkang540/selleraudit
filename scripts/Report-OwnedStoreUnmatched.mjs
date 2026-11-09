import {readFile,writeFile} from 'node:fs/promises'
import {log} from 'node:console'
const data=JSON.parse(await readFile('../outputs/local-registration/own-store-matching-input.json','utf8'))
const {plan}=JSON.parse(await readFile('../outputs/local-registration/own-store-mapping-plan.json','utf8'))
const chosen=new Set(plan.map(x=>x.offerId)),pending=data.offers.filter(o=>!chosen.has(o.id))
const clean=x=>String(x??'').replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|')
const lines=['# 자사몰 추가 확인 목록','','준비된 533개 연결을 적용한 후 남는 품목입니다. 현재 연결 전에는 전체 미매칭 상태입니다.','',`남은 품목 ${pending.length}건 (판매 중 ${pending.filter(o=>o.status==='ACTIVE').length}건, 미사용 ${pending.filter(o=>o.status!=='ACTIVE').length}건).`,'','| 상품코드 | 상품명 | 품목코드 | 옵션명 | 상태 |','| --- | --- | --- | --- | --- |',...pending.map(o=>`| ${clean(o.channel_product_id)} | ${clean(o.product_name)} | ${clean(o.channel_option_id)} | ${clean(o.option_name)} | ${o.status==='ACTIVE'?'판매 중':'미사용'} |`),'']
await writeFile('../outputs/local-registration/자사몰-추가-확인목록.md',lines.join('\n'),'utf8')
log(`보류 목록 ${pending.length}건 작성`)
