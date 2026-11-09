import * as XLSX from 'xlsx'
import {TextDecoder} from 'node:util'

export function parseOwnedStoreItems(bytes) {
  const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes)
  const book = XLSX.read(text, {type:'string',raw:true})
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {defval:'',raw:true})
  const groups = new Map(), seen = new Set()
  const integer = value => {
    const text = String(value).trim()
    if (!/^-?\d+$/.test(text)) throw new Error('금액이 정수가 아닙니다.')
    const result = Number(text)
    if (!Number.isSafeInteger(result)) throw new Error('금액이 허용 범위를 벗어났습니다.')
    return result
  }
  for (const row of rows) {
    const code=String(row['상품코드']).trim(), name=String(row['상품명']).trim(), optionId=String(row['품목코드']).trim()
    const display=String(row['품목 진열상태']).trim(), sale=String(row['품목 판매상태']).trim()
    if (!/^P[A-Z0-9]+$/.test(code) || !optionId.startsWith(code) || !/^[A-Z0-9]+$/.test(optionId) || !name || seen.has(optionId) || !['T','F'].includes(display) || !['T','F'].includes(sale)) throw new Error('상품코드, 품목코드 또는 상태를 확인해 주세요.')
    seen.add(optionId)
    const base=integer(row['판매가']), extra=integer(row['옵션 추가금액']), price=base+extra
    if (base<0 || price<0 || !Number.isSafeInteger(price)) throw new Error('옵션 판매가가 올바르지 않습니다.')
    const group=groups.get(code) ?? {code,name,items:[]}
    if (group.name!==name) throw new Error('같은 상품코드의 상품명이 일치하지 않습니다.')
    group.items.push({optionId,name:String(row['품목명']).trim() || '단품',sellerCode:String(row['자체 품목코드']).trim() || null,price,status:display==='T'&&sale==='T'?'ACTIVE':'INACTIVE'})
    groups.set(code,group)
  }
  if (!groups.size || !rows.length) throw new Error('등록할 품목이 없습니다.')
  return [...groups.values()]
}
