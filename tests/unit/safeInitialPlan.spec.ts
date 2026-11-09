import { expect,test } from '@playwright/test'
import { safeInitialPlan } from '../../server/import/safeInitialPlan'
import type { MasterImportPreview,ProductCandidate,SkuCandidate,BomCandidate } from '../../src/types/import'

test('only complete, unambiguous products with matching SKU definitions enter the proposed subset',()=>{
  const product=(row:number,code:string,status='VALID')=>({sourceRow:row,sabangnetCode:code,productName:`상품${row}`,productType:'SET',category:'세트',status}) as ProductCandidate
  const sku=(code:string,name:string)=>({skuCode:code,modelName:name,color:'색',status:'VALID',registryStatus:'BOM_REGISTRY'}) as SkuCandidate
  const bom=(row:number,code:string,quantity=1)=>({productSourceRow:row,skuCode:code,quantity,status:'VALID'}) as BomCandidate
  const preview={workbook:{schemaValid:true},issues:[],products:[product(1,'A'),product(2,'B'),product(3,'B'),product(4,'C'),product(5,'D'),product(6,'E')],skus:[sku('OK','정상'),sku('BAD','첫째'),sku('BAD','둘째'),sku('AL502','세트')],bomComponents:[bom(1,'OK'),bom(2,'OK'),bom(3,'OK'),bom(4,'BAD'),bom(5,'AL502'),bom(6,'OK'),bom(6,'OK')]} as unknown as MasterImportPreview
  const result=safeInitialPlan(preview,[],[])
  expect(result.products.map(item=>item.product.sourceRow)).toEqual([1])
  expect(result.skus.map(item=>item.skuCode)).toEqual(['OK'])
  expect(result.excluded.map(item=>item.row)).toEqual([2,3,4,5,6])
  expect(safeInitialPlan(preview,[],[{code:'OK',name:'기존 다른 이름',color:'색',status:'ACTIVE'}]).products).toHaveLength(0)
  expect(safeInitialPlan(preview,[{code:'A',name:'상품1',category:'세트',type:'SET',status:'ACTIVE',components:[{sku:'OK',quantity:2}]}],[]).products).toHaveLength(0)
  expect(()=>safeInitialPlan({...preview,issues:[{blockingScope:'BATCH',sourceSheet:'코드DB',sourceRow:5}]} as unknown as MasterImportPreview,[],[])).toThrow('Workbook-wide issue')
})
