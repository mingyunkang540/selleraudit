import type { MasterImportPreview, ProductCandidate, SkuCandidate, BomCandidate } from '../../src/types/import/index.ts'

export interface ExistingProduct { code:string; name:string; category:string|null; type:string; status:string; components:readonly {sku:string;quantity:number}[] }
export interface ExistingSku { code:string; name:string; color:string|null; status:string }
export interface SafeInitialPlan {
  products:readonly {product:ProductCandidate; components:readonly BomCandidate[]}[]
  skus:readonly SkuCandidate[]
  excluded:readonly {row:number; name:string|null; reasons:readonly string[]}[]
}

// Conservative create-only proposal. No live write is authorized by this plan.
// Channel variants, collections and physical bundle definitions are not yet
// modeled in the production schema, so all affected products are held.
export function safeInitialPlan(preview:MasterImportPreview, existingProducts:readonly ExistingProduct[], existingSkus:readonly ExistingSku[]):SafeInitialPlan {
  if(!preview.workbook.schemaValid || preview.issues.some(issue=>issue.blockingScope==='BATCH' && (issue.sourceSheet!=='단가표' || issue.sourceRow===null)))throw new Error('Workbook-wide issue requires review')
  const knownRows=new Set(preview.products.map(product=>product.sourceRow))
  if(preview.issues.some(issue=>issue.blockingScope==='BATCH' && (issue.sourceRow===null || !knownRows.has(issue.sourceRow) || issue.relatedRows.some(row=>!knownRows.has(row)))))throw new Error('Unlinked issue requires review')
  const groups=new Map<string,ProductCandidate[]>()
  for(const product of preview.products)if(product.sabangnetCode){const list=groups.get(product.sabangnetCode)??[];list.push(product);groups.set(product.sabangnetCode,list)}
  const skuGroups=new Map<string,SkuCandidate[]>()
  for(const sku of preview.skus.filter(item=>item.registryStatus==='BOM_REGISTRY')){const list=skuGroups.get(sku.skuCode)??[];list.push(sku);skuGroups.set(sku.skuCode,list)}
  const existingSkuMap=new Map(existingSkus.map(item=>[item.code,item]))
  const existingProductMap=new Map(existingProducts.map(item=>[item.code,item]))
  const selected:{product:ProductCandidate;components:BomCandidate[]}[]=[]
  const excluded:{row:number;name:string|null;reasons:string[]}[]=[]
  const needed=new Map<string,SkuCandidate>()
  for(const product of preview.products){
    const reasons:string[]=[];const code=product.sabangnetCode
    const bom=preview.bomComponents.filter(item=>item.productSourceRow===product.sourceRow)
    if(product.status!=='VALID')reasons.push('상품의 검증 이슈를 확인해야 합니다.')
    if(!code || !product.productName || !['SINGLE','SET'].includes(product.productType??''))reasons.push('상품 식별 정보가 불완전합니다.')
    if(product.sourceChannel && product.sourceChannel!=='공통')reasons.push('채널별 상품을 별도로 저장해야 합니다.')
    if(code && (groups.get(code)?.length??0)>1)reasons.push('같은 품번의 채널 또는 옵션을 별도로 저장해야 합니다.')
    if(!bom.length)reasons.push('구성품이 없습니다.')
    const seen=new Set<string>()
    for(const component of bom){
      const sku=component.skuCode
      if(component.status!=='VALID'||!Number.isSafeInteger(component.quantity)||component.quantity<=0)reasons.push(`구성품 ${sku} 검증이 필요합니다.`)
      if(seen.has(sku))reasons.push(`구성품 ${sku}이 중복됩니다.`)
      seen.add(sku)
      if(sku==='AL502'||sku==='AL510')reasons.push(`묶음 SKU ${sku}의 실물 구성을 별도로 저장해야 합니다.`)
      const definitions=skuGroups.get(sku)??[]
      if(!definitions.length || definitions.some(item=>!item.modelName || item.status!=='VALID'))reasons.push(`SKU ${sku}의 등록 정보가 없습니다.`)
      else if(definitions.some(item=>item.modelName!==definitions[0].modelName || item.color!==definitions[0].color))reasons.push(`SKU ${sku}의 등록 정보가 충돌합니다.`)
      else {const existing=existingSkuMap.get(sku);if(existing && (existing.name!==definitions[0].modelName||existing.color!==definitions[0].color||existing.status!=='ACTIVE'))reasons.push(`기존 SKU ${sku}와 정보 또는 상태가 다릅니다.`)}
    }
    const existing=code?existingProductMap.get(code):undefined
    if(existing){
      const current=existing.components.map(item=>`${item.sku}:${item.quantity}`).sort()
      const incoming=bom.map(item=>`${item.skuCode}:${item.quantity}`).sort()
      if(existing.name!==product.productName || existing.category!==product.category || existing.type!==product.productType || existing.status!=='ACTIVE' || JSON.stringify(current)!==JSON.stringify(incoming))reasons.push('기존 상품 또는 구성품과 정보가 다릅니다.')
    }
    if(reasons.length)excluded.push({row:product.sourceRow,name:product.productName,reasons:[...new Set(reasons)]})
    else {selected.push({product,components:bom});for(const component of bom)needed.set(component.skuCode,skuGroups.get(component.skuCode)![0])}
  }
  return {products:selected,skus:[...needed.values()],excluded}
}
