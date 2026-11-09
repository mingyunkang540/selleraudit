import type { BomCandidate, MasterImportIssue, MasterImportPreview, ProductCandidate } from '../../types/import'

export interface LocalCatalogDecision {
  unlistedRows: readonly number[]
  collections: readonly { code:string; rows:readonly number[] }[]
  channelVariants?: readonly { commonRow:number; channelRow:number }[]
}
export interface LocalCatalogPlan {
  unlisted: readonly { product:ProductCandidate; components:readonly BomCandidate[] }[]
  collections: readonly { code:string; options:readonly { product:ProductCandidate; component:BomCandidate }[] }[]
  channelVariants: readonly {code:string;common:ProductCandidate;channel:ProductCandidate;commonComponent:BomCandidate;channelComponent:BomCandidate}[]
  remainingIssues: readonly MasterImportIssue[]
}

// This projection never changes a saved validation or enables Apply. It only
// models owner-confirmed source rows while the corresponding import contract
// is being built. Unlisted and collection options must retain their own BOMs.
export function planLocalCatalog(preview:MasterImportPreview,decision:LocalCatalogDecision):LocalCatalogPlan {
  const productByRow=new Map(preview.products.map(product=>[product.sourceRow,product]))
  if(productByRow.size!==preview.products.length)throw new Error('Duplicate source row')
  const validatedComponents=(row:number)=>{
    const items=preview.bomComponents.filter(component=>component.productSourceRow===row)
    if(!items.length || new Set(items.map(item=>item.skuCode)).size!==items.length || items.some(item=>item.status!=='VALID' || !Number.isSafeInteger(item.quantity) || item.quantity<1))throw new Error('Invalid product composition')
    for(const item of items){
      const registry=preview.skus.filter(sku=>sku.skuCode===item.skuCode && sku.registryStatus==='BOM_REGISTRY')
      if(registry.length!==1 || registry[0].status!=='VALID' || !registry[0].modelName)throw new Error('Ambiguous product SKU')
    }
    return items
  }
  const seen=new Set<number>()
  const unlisted=decision.unlistedRows.map(row=>{
    const product=productByRow.get(row)
    if(!product || seen.has(row) || product.sabangnetCode!==null || product.productType!=='SET' || !product.productName || product.issueCodes.some(code=>code!=='MISSING_REQUIRED_FIELD'))throw new Error('Invalid unlisted set')
    seen.add(row)
    return {product,components:validatedComponents(row)}
  })
  const collectionCodes=new Set<string>()
  const collections=decision.collections.map(group=>{
    if(!group.code.trim() || collectionCodes.has(group.code) || group.rows.length<2)throw new Error('Invalid collection')
    collectionCodes.add(group.code)
    const allRows=preview.products.filter(product=>product.sabangnetCode===group.code).map(product=>product.sourceRow)
    if(allRows.length!==group.rows.length || allRows.some(row=>!group.rows.includes(row)))throw new Error('Incomplete collection')
    const skuCodes=new Set<string>()
    const options=group.rows.map(row=>{
      const product=productByRow.get(row)
      if(!product || seen.has(row) || product.sabangnetCode!==group.code || product.productType!=='SET' || !product.productName || product.issueCodes.some(code=>code!=='DUPLICATE_BUSINESS_KEY'))throw new Error('Invalid option')
      const components=validatedComponents(row)
      if(components.length!==1 || components[0].quantity!==2 || skuCodes.has(components[0].skuCode))throw new Error('Ambiguous option composition')
      skuCodes.add(components[0].skuCode);seen.add(row)
      return {product,component:components[0]}
    })
    return {code:group.code,options}
  })
  const channelVariants=(decision.channelVariants??[]).map(group=>{
    const common=productByRow.get(group.commonRow);const channel=productByRow.get(group.channelRow)
    if(!common || !channel || seen.has(group.commonRow) || seen.has(group.channelRow) || !common.sabangnetCode || common.sabangnetCode!==channel.sabangnetCode || common.sourceChannel!=='공통' || channel.sourceChannel!=='오늘의집_아쿠아' || common.productName!==channel.productName || common.category!==channel.category || common.productType!==channel.productType || common.sourceQuantity!==channel.sourceQuantity)throw new Error('Invalid channel variant')
    const rows=preview.products.filter(product=>product.sabangnetCode===common.sabangnetCode).map(product=>product.sourceRow)
    if(rows.length!==2 || !rows.includes(group.commonRow) || !rows.includes(group.channelRow))throw new Error('Incomplete channel variant')
    const commonBom=preview.bomComponents.filter(item=>item.productSourceRow===group.commonRow)
    const channelBom=preview.bomComponents.filter(item=>item.productSourceRow===group.channelRow)
    if(commonBom.length!==1 || channelBom.length!==1 || commonBom[0].status!=='VALID' || channelBom[0].status!=='VALID' || commonBom[0].quantity!==channelBom[0].quantity || !/^AL[A-Z0-9]+$/.test(commonBom[0].skuCode) || channelBom[0].skuCode!==`AQ${commonBom[0].skuCode.slice(2)}`)throw new Error('Invalid channel composition')
    const commonSku=preview.skus.filter(sku=>sku.skuCode===commonBom[0].skuCode && sku.status==='VALID')
    const channelSku=preview.skus.filter(sku=>sku.skuCode===channelBom[0].skuCode && sku.status==='VALID')
    if(commonSku.length!==1 || channelSku.length!==1 || !commonSku[0].modelName || commonSku[0].modelName!==channelSku[0].modelName || commonSku[0].color!=='라벤더' || channelSku[0].color!=='아쿠아')throw new Error('Unverified channel SKU')
    seen.add(group.commonRow);seen.add(group.channelRow)
    return {code:common.sabangnetCode,common,channel,commonComponent:commonBom[0],channelComponent:channelBom[0]}
  })
  const unlistedRows=new Set(decision.unlistedRows)
  const remainingIssues=preview.issues.filter(issue=>{
    if(issue.sourceSheet!=='단가표')return true
    if(issue.code==='MISSING_REQUIRED_FIELD' && issue.fieldPath==='sabangnetCode' && issue.sourceRow!==null && unlistedRows.has(issue.sourceRow))return false
    if(issue.code==='DUPLICATE_BUSINESS_KEY' && typeof issue.observedValue==='string'){
      const group=decision.collections.find(item=>item.code===issue.observedValue)
      if(group && issue.relatedRows.length===group.rows.length && issue.relatedRows.every(row=>group.rows.includes(row)))return false
      const channel=channelVariants.find(item=>item.code===issue.observedValue)
      if(channel && issue.relatedRows.length===2 && issue.relatedRows.includes(channel.common.sourceRow) && issue.relatedRows.includes(channel.channel.sourceRow))return false
    }
    return true
  })
  return {unlisted,collections,channelVariants,remainingIssues}
}
