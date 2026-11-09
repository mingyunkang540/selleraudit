/* global console */
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const data=JSON.parse(await readFile(resolve('../outputs/local-registration/owned-store-preview.json'),'utf8'))
const clean=value=>String(value??'').replace(/[\r\n]+/g,' / ').replace(/\|/g,'\\|')
const rows=data.listings.filter(item=>!item.masterProductId)
const lines=['# 자사몰 상품 검토 목록','','원본: sample/자사몰 상품목록.csv (2026-11-02 저장본). 실시간 판매상태·가격은 별도 확인이 필요합니다.','','옵션 상품은 옵션별 고유번호·추가금이 없어 자동 연결하지 않았습니다. 단품은 검증된 마스터 자사몰 코드가 없으면 자동 연결하지 않았습니다.','','| 자사몰 상품코드 | 상품명 | 구분 | 원본 상태 | 확인 사유 | 원본 옵션 내용 |','| --- | --- | --- | --- | --- | --- |',...rows.map(item=>`| ${clean(item.id)} | ${clean(item.name)} | ${item.hasOptions?'옵션':'단품'} | ${item.status === 'ACTIVE' ? '판매 중' : '진열 또는 판매 중지'} | ${clean(item.reason)} | ${clean(item.optionText)} |`),'']
const output=resolve('../outputs/local-registration/자사몰-검토목록.md')
await writeFile(output,lines.join('\n'),'utf8')
console.log(`검토 목록 작성: ${rows.length}건`)
