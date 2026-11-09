import * as XLSX from 'xlsx'

export interface WorkbookEdit { sheet: '단가표' | '코드DB'; address: string; before: string; after: string }
export interface NewWorkbookSku { category: string; skuCode: string; modelName: string; color: string }
export interface ExcludedWorkbookRow { sheet: '단가표'; row: number }
const fields: Record<WorkbookEdit['sheet'], ReadonlySet<string>> = {
  단가표: new Set(['B','C','D','E','F','H']), 코드DB: new Set(['C','D','E']),
}

export function correctWorkbook(original: Buffer, edits: WorkbookEdit[], newSkus: NewWorkbookSku[] = [], excludedRows: ExcludedWorkbookRow[] = []): Buffer {
  if (!Array.isArray(edits) || !Array.isArray(newSkus) || !Array.isArray(excludedRows) || edits.length + newSkus.length + excludedRows.length < 1 || edits.length > 500 || newSkus.length > 100 || excludedRows.length > 1000) throw new Error('Invalid edits')
  const book = XLSX.read(original, { type:'buffer', cellFormula:true, cellNF:true, sheetStubs:true, cellDates:true })
  const excluded=new Set<number>()
  for(const row of excludedRows){
    if(!row || row.sheet!=='단가표' || !Number.isSafeInteger(row.row) || row.row<6 || excluded.has(row.row))throw new Error('Invalid excluded row')
    const sheet=book.Sheets['단가표']
    if(!sheet || !sheet['!ref'] || row.row>XLSX.utils.decode_range(sheet['!ref']).e.r+1)throw new Error('Invalid excluded row')
    for(const column of ['B','C','D','E','F','H']){
      const address=`${column}${row.row}`;const cell=XLSX.utils.decode_cell(address)
      if((sheet['!merges']??[]).some(m=>cell.r>=m.s.r&&cell.r<=m.e.r&&cell.c>=m.s.c&&cell.c<=m.e.c))throw new Error('Merged cells require workbook review')
      delete sheet[address]
    }
    excluded.add(row.row)
  }
  const seen = new Set<string>()
  for (const edit of edits) {
    if (!edit || !Object.hasOwn(fields,edit.sheet) || typeof edit.address!=='string' || typeof edit.before!=='string' || typeof edit.after!=='string' || edit.after.length>10000) throw new Error('Invalid edit')
    const match=/^([A-Z]+)([1-9][0-9]*)$/.exec(edit.address)
    if (!match || !fields[edit.sheet].has(match[1]) || Number(match[2]) < (edit.sheet==='단가표'?6:4) || Number(match[2])>100000) throw new Error('Invalid cell')
    if(edit.sheet==='단가표' && excluded.has(Number(match[2])))throw new Error('Cannot edit an excluded row')
    const key=`${edit.sheet}!${edit.address}`
    if(seen.has(key))throw new Error('Duplicate cell')
    seen.add(key)
    const sheet=book.Sheets[edit.sheet]
    if(!sheet || !sheet['!ref'])throw new Error('Missing sheet')
    const coordinate=XLSX.utils.decode_cell(edit.address)
    const range=XLSX.utils.decode_range(sheet['!ref'])
    if(coordinate.r>range.e.r || coordinate.c>range.e.c)throw new Error('Cell is outside the source range')
    if((sheet['!merges']??[]).some(m=>coordinate.r>=m.s.r&&coordinate.r<=m.e.r&&coordinate.c>=m.s.c&&coordinate.c<=m.e.c))throw new Error('Merged cells require workbook review')
    const old=sheet[edit.address]
    if(old?.f || old?.F || old?.t==='e' || (old?.v != null && !['string','number'].includes(typeof old.v)))throw new Error('Cell requires workbook review')
    const before=old?.v == null ? '' : String(old.v)
    if(before!==edit.before)throw new Error('Source changed')
    if(edit.before===edit.after)throw new Error('No change')
    if(edit.sheet==='단가표'&&match[1]==='H'&&edit.after.trim() && (!/^[1-9]\d*$/.test(edit.after.trim()) || !Number.isSafeInteger(Number(edit.after))))throw new Error('Invalid quantity')
    const next={...(old??{})}
    delete next.w
    if (!edit.after.trim()) { next.t='z'; delete next.v }
    else if(edit.sheet==='단가표'&&match[1]==='H') { next.t='n'; next.v=Number(edit.after.trim()) }
    else { next.t='s'; next.v=edit.after.trim() }
    sheet[edit.address]=next
  }
  if(newSkus.length){
    const sheet=book.Sheets['코드DB']
    if(!sheet || !sheet['!ref'])throw new Error('Missing sheet')
    const categories=new Set(['냉동용기','구성품','기타','스티커','박스(부자재)','아이스 땡스보틀','로켓배송'])
    const end=XLSX.utils.decode_range(sheet['!ref']).e.r+1
    if(end+1+newSkus.length*2>1048576)throw new Error('No space for SKU rows')
    const used=new Set<string>()
    for(let row=4;row<=end;row++)if(sheet[`E${row}`]?.v!=null)used.add(String(sheet[`E${row}`].v).trim())
    let nextRow=end+2
    for(const sku of newSkus){
      if(!sku || typeof sku.category!=='string' || !categories.has(sku.category) || typeof sku.skuCode!=='string' || !/^[A-Z][A-Z0-9]{0,49}$/.test(sku.skuCode) || typeof sku.modelName!=='string' || !sku.modelName.trim() || sku.modelName.length>200 || typeof sku.color!=='string' || sku.color.length>200 || used.has(sku.skuCode))throw new Error('Invalid new SKU')
      if(sku.modelName.includes('+') && ['냉동용기','구성품'].includes(sku.category) && !['AL502','AL510'].includes(sku.skuCode))throw new Error('Bundle SKU requires confirmation')
      used.add(sku.skuCode)
      XLSX.utils.sheet_add_aoa(sheet,[[sku.category],[null,sku.modelName.trim(),sku.color.trim()||null,sku.skuCode]],{origin:`B${nextRow}`})
      nextRow+=2
    }
  }
  return XLSX.write(book,{type:'buffer',bookType:'xlsx',cellStyles:true}) as Buffer
}
