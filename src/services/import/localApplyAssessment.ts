import type { MasterImportApplyPreview, SavedImportCandidate } from '../importPersistence'

export interface ProductAssessment {
  sourceRow: number
  name: string
  code: string
  reasons: string[]
}

// Diagnostic only. Apply must independently repeat these checks inside its
// database transaction; this client-side assessment is never authorization.
export function assessLocalProducts(candidates: readonly SavedImportCandidate[], preview: MasterImportApplyPreview): ProductAssessment[] {
  const effective=(candidate:SavedImportCandidate)=>({...candidate.normalizedValues,...candidate.reviewedValues})
  const products=candidates.filter(candidate=>candidate.kind==='PRODUCT')
  const components=candidates.filter(candidate=>candidate.kind==='BOM_COMPONENT')
  const statuses=new Map(preview.rows.map(row=>[row.candidateId,row.status]))
  const skuConflicts=new Set(preview.rows.filter(row=>row.kind==='SKU' && row.status==='CONFLICT').map(row=>row.businessKey))
  const validStatus=new Set(['NEW','UPDATE','UNCHANGED'])
  const skus=candidates.filter(candidate=>candidate.kind==='SKU')
  const groups=new Map<string,SavedImportCandidate[]>()
  for(const product of products){
    const code=String(effective(product).sabangnetCode??'').trim()
    if(code)groups.set(code,[...(groups.get(code)??[]),product])
  }
  const differentChannelCodes=new Set<string>()
  for(const [code,group] of groups){
    if(group.length<2)continue
    const signatures=group.map(product=>JSON.stringify(components.filter(item=>effective(item).productSourceRow===product.sourceRow)
      .map(item=>[String(effective(item).skuCode??''),Number(effective(item).quantity)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))))
    const channels=new Set(group.map(product=>String(effective(product).sourceChannel??'').trim()))
    if(new Set(signatures).size>1 || channels.size>1)differentChannelCodes.add(code)
  }
  const assessed=products.map(product=>{
    const values=effective(product);const code=String(values.sabangnetCode??'').trim();const reasons:string[]=[]
    const productStatus=statuses.get(product.id)
    if(!productStatus || !validStatus.has(productStatus))reasons.push('상품 자체를 적용할 수 없습니다.')
    if(!code)reasons.push('사방넷 품번이 없는 구성은 별도 저장 기능이 필요합니다.')
    if(differentChannelCodes.has(code))reasons.push('같은 품번의 채널 또는 옵션별 구성이 달라 별도 저장 기능이 필요합니다.')
    const bom=components.filter(item=>effective(item).productSourceRow===product.sourceRow)
    if(!bom.length)reasons.push('구성품이 없거나 확인되지 않았습니다.')
    for(const item of bom){
      const itemValues=effective(item);const sku=String(itemValues.skuCode??'').trim()
      if(skuConflicts.has(sku))reasons.push(`SKU ${sku}에 충돌이 있습니다.`)
      if(!validStatus.has(statuses.get(item.id)??''))reasons.push(`SKU ${sku || '(없음)'} 구성품을 적용할 수 없습니다.`)
      if(!skus.some(candidate=>String(effective(candidate).skuCode??'').trim()===sku && validStatus.has(statuses.get(candidate.id)??'')))reasons.push(`SKU ${sku || '(없음)'}의 등록 정보를 확인해야 합니다.`)
      if(sku==='AL502'||sku==='AL510')reasons.push(`묶음 SKU ${sku}의 실물 구성 저장 기능이 필요합니다.`)
    }
    return {sourceRow:product.sourceRow,name:String(values.productName??''),code,reasons:[...new Set(reasons)]}
  })
  const blockedCodes=new Set(assessed.filter(item=>item.code && item.reasons.length>0).map(item=>item.code))
  for(const item of assessed)if(item.code && blockedCodes.has(item.code) && !item.reasons.length)item.reasons.push('같은 품번의 다른 행을 함께 확인해야 합니다.')
  return assessed
}
