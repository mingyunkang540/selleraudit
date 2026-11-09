import type { MasterImportPreview, ProductCandidate, BomCandidate, SkuCandidate } from '../../src/types/import/index.ts'
import { planLocalCatalog, type LocalCatalogDecision } from '../../src/services/import/localCatalogPlan.ts'
import { LOCAL_SKU_COMPONENTS } from '../../src/services/import/localPolicy.ts'
import type { ExistingProduct, ExistingSku } from './safeInitialPlan.ts'

type Item = { product:ProductCandidate; components:readonly BomCandidate[] }
export interface ExpandedCatalogPlan {
  products:readonly Item[]
  unlisted:readonly Item[]
  collections:ReturnType<typeof planLocalCatalog>['collections']
  variants:ReturnType<typeof planLocalCatalog>['channelVariants']
  skus:readonly SkuCandidate[]
  excluded:readonly {row:number; name:string|null; reasons:readonly string[]}[]
}

// A plan is built entirely from the verified workbook and existing catalog.
// It is create-only: mismatching records are excluded, never silently updated.
export function expandedCatalogPlan(preview:MasterImportPreview,decision:LocalCatalogDecision,existingProducts:readonly ExistingProduct[],existingSkus:readonly ExistingSku[]):ExpandedCatalogPlan {
  if(!preview.workbook.schemaValid)throw new Error('Invalid workbook')
  const special=planLocalCatalog(preview,decision)
  const productsByCode=new Map(existingProducts.map(item=>[item.code,item]))
  const skusByCode=new Map(existingSkus.map(item=>[item.code,item]))
  const groups=new Map<string,ProductCandidate[]>()
  for(const item of preview.products)if(item.sabangnetCode){const group=groups.get(item.sabangnetCode)??[];group.push(item);groups.set(item.sabangnetCode,group)}
  const definitions=new Map<string,SkuCandidate[]>()
  for(const item of preview.skus.filter(s=>s.registryStatus==='BOM_REGISTRY')){const group=definitions.get(item.skuCode)??[];group.push(item);definitions.set(item.skuCode,group)}
  const needed=new Map<string,SkuCandidate>()
  const skuIssue=(code:string):string|null=>{
    const all=definitions.get(code)??[];const sku=all[0]
    if(!sku || all.some(item=>item.status!=='VALID'||!item.modelName||item.modelName!==sku.modelName||item.color!==sku.color))return `SKU ${code}의 등록 정보를 확인해야 합니다.`
    const existing=skusByCode.get(code)
    if(existing && (existing.name!==sku.modelName||existing.color!==sku.color||existing.status!=='ACTIVE'))return `기존 SKU ${code}와 정보가 다릅니다.`
    return null
  }
  const itemIssues=(item:Item,allowDuplicate=false)=>{
    const reasons:string[]=[];const product=item.product
    if(!product.productName || !['SINGLE','SET'].includes(product.productType??''))reasons.push('상품 정보가 불완전합니다.')
    if(product.issueCodes.some(code=>!(allowDuplicate&&code==='DUPLICATE_BUSINESS_KEY')))reasons.push('상품 검증 이슈를 확인해야 합니다.')
    if(!item.components.length || new Set(item.components.map(c=>c.skuCode)).size!==item.components.length)reasons.push('구성 정보를 확인해야 합니다.')
    for(const component of item.components){
      if(component.status!=='VALID'||!Number.isSafeInteger(component.quantity)||component.quantity<1)reasons.push(`구성 ${component.skuCode}의 수량을 확인해야 합니다.`)
      const codes=[component.skuCode,...(LOCAL_SKU_COMPONENTS[component.skuCode as keyof typeof LOCAL_SKU_COMPONENTS]??[]).map(c=>c.skuCode)]
      for(const code of codes){const issue=skuIssue(code);if(issue)reasons.push(issue)}
    }
    const old=product.sabangnetCode?productsByCode.get(product.sabangnetCode):undefined
    if(old){
      const incoming=item.components.map(c=>`${c.skuCode}:${c.quantity}`).sort()
      const current=old.components.map(c=>`${c.sku}:${c.quantity}`).sort()
      if(old.name!==product.productName||old.category!==product.category||old.type!==product.productType||old.status!=='ACTIVE'||JSON.stringify(incoming)!==JSON.stringify(current))reasons.push('기존 상품 또는 구성과 정보가 다릅니다.')
    }
    return [...new Set(reasons)]
  }
  const includeSkus=(items:readonly BomCandidate[])=>{for(const component of items){for(const code of [component.skuCode,...(LOCAL_SKU_COMPONENTS[component.skuCode as keyof typeof LOCAL_SKU_COMPONENTS]??[]).map(c=>c.skuCode)])needed.set(code,definitions.get(code)![0])}}
  const selected:Item[]=[];const unlisted:Item[]=[];const collections:ExpandedCatalogPlan['collections'][number][]=[];const variants:ExpandedCatalogPlan['variants'][number][]=[]
  const excluded:{row:number;name:string|null;reasons:string[]}[]=[]
  const hold=(product:ProductCandidate,reasons:string[])=>excluded.push({row:product.sourceRow,name:product.productName,reasons})
  const specialRows=new Set([...decision.unlistedRows,...decision.collections.flatMap(c=>c.rows),...(decision.channelVariants??[]).flatMap(v=>[v.commonRow,v.channelRow])])
  const unresolved=special.remainingIssues.filter(i=>i.blockingScope==='BATCH')
  if(unresolved.some(i=>i.sourceSheet!=='단가표'||i.sourceRow===null||!preview.products.some(p=>p.sourceRow===i.sourceRow)))throw new Error('Workbook-wide issue requires review')
  for(const product of preview.products){
    if(specialRows.has(product.sourceRow))continue
    const item={product,components:preview.bomComponents.filter(c=>c.productSourceRow===product.sourceRow)}
    const reasons=itemIssues(item)
    if(!product.sabangnetCode || (groups.get(product.sabangnetCode)?.length??0)!==1)reasons.push('상품 식별 정보를 확인해야 합니다.')
    if(unresolved.some(i=>i.sourceRow===product.sourceRow||i.relatedRows.includes(product.sourceRow)))reasons.push('차단 이슈를 확인해야 합니다.')
    if(reasons.length)hold(product,[...new Set(reasons)]);else{selected.push(item);includeSkus(item.components)}
  }
  for(const item of special.unlisted){
    const reasons=itemIssues({...item,product:{...item.product,issueCodes:[]}})
    if(reasons.length)hold(item.product,reasons);else{unlisted.push(item);includeSkus(item.components)}
  }
  for(const group of special.collections){
    const reasons=group.options.flatMap(option=>itemIssues({product:{...option.product,sabangnetCode:null,issueCodes:[]},components:[option.component]}))
    if(productsByCode.has(group.code))reasons.push('기존 모음전 품번을 확인해야 합니다.')
    if(reasons.length)for(const option of group.options)hold(option.product,[...new Set(reasons)])
    else{collections.push(group);for(const option of group.options)includeSkus([option.component])}
  }
  for(const variant of special.channelVariants){
    const item={product:variant.common,components:[variant.commonComponent]}
    const reasons=itemIssues(item,true)
    if(variant.channel.issueCodes.some(code=>code!=='DUPLICATE_BUSINESS_KEY'))reasons.push('채널 상품의 검증 이슈를 확인해야 합니다.')
    const issue=skuIssue(variant.channelComponent.skuCode);if(issue)reasons.push(issue)
    if(reasons.length){hold(variant.common,[...new Set(reasons)]);hold(variant.channel,[...new Set(reasons)])}
    else{selected.push(item);variants.push(variant);includeSkus([variant.commonComponent,variant.channelComponent])}
  }
  return {products:selected,unlisted,collections,variants,skus:[...needed.values()],excluded:excluded.sort((a,b)=>a.row-b.row)}
}
