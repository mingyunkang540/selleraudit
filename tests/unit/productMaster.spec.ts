import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'
import type {Pool} from 'pg'
import {expect,test} from '@playwright/test'
import {bootstrapAdmin,currentIdentity,login} from '../../server/auth/service'
import {saveProductMaster} from '../../server/business/productMaster'
import {readProductPrices} from '../../server/business/productPrices'

test('product master creates and updates composition and prices transactionally',async()=>{
 const db=new PGlite()
 try{
  await db.exec('CREATE SCHEMA seller_audit_local')
  for(const name of ['0001_foundation','0002_local_business_tables','0003_local_identity','0007_local_catalog','0010_product_configurations','0011_manual_product_master','0012_optional_product_code'])await db.exec(await readFile(new URL(`../../server/migrations/${name}.sql`,import.meta.url),'utf8'))
  const pool={query:(sql:string,params?:unknown[])=>db.query(sql,params),connect:async()=>({query:(sql:string,params?:unknown[])=>db.query(sql,params),release:()=>{}})} as unknown as Pool
  await bootstrapAdmin(pool,{email:'admin@example.com',displayName:'Admin',password:'password 12345678'})
  const session=await login(pool,'admin@example.com','password 12345678'),actor=(await currentIdentity(pool,session!.session))!
  const sku=(await db.query<{id:string}>("INSERT INTO seller_audit_local.skus(workspace_id,sku_code,model_name) VALUES($1,'S1','Sample') RETURNING id",[actor.workspaceId])).rows[0].id
  const prices={cost:500,normal:2000,regular:1800,basic:1700,medium:null,large:null,live:1500,group:null}
  const input={sabangnetCode:'ABC',productName:'Sample',category:null,productType:'SINGLE' as const,status:'ACTIVE' as const,prices,components:[{skuId:sku,quantity:1}]}
  const noPrices={cost:null,normal:null,regular:null,basic:null,medium:null,large:null,live:null,group:null}
  const pending=await saveProductMaster(pool,actor,{...input,sabangnetCode:'',productName:'Pending',category:null,prices:noPrices})
  await saveProductMaster(pool,actor,{...input,sabangnetCode:'',productName:'Another pending',category:null,prices:noPrices})
  expect((await db.query<{sabangnet_code:string|null}>('SELECT sabangnet_code FROM seller_audit_local.products WHERE id=$1',[pending.id])).rows[0].sabangnet_code).toBeNull()
  const pendingUpdated=(await db.query<{updated_at:Date}>('SELECT updated_at FROM seller_audit_local.products WHERE id=$1',[pending.id])).rows[0].updated_at.toISOString()
  await saveProductMaster(pool,actor,{...input,id:pending.id,expectedUpdatedAt:pendingUpdated,sabangnetCode:'LATER',productName:'Pending',category:'Added',prices})
  expect((await db.query<{sabangnet_code:string}>('SELECT sabangnet_code FROM seller_audit_local.products WHERE id=$1',[pending.id])).rows[0].sabangnet_code).toBe('LATER')
  const saved=await saveProductMaster(pool,actor,input)
  expect((await db.query<{normal:string}>('SELECT normal FROM seller_audit_local.product_manual_prices WHERE product_id=$1',[saved.id])).rows[0].normal).toBe('2000.00')
  const fallback=await readProductPrices(pool,actor,'.');expect(fallback.sourceUnavailable).toBe(true);expect(fallback.products.find(p=>p.productId===saved.id)?.values?.normal).toBe(2000)
  await expect(saveProductMaster(pool,actor,input)).rejects.toThrow()
  const channel=(await db.query<{id:string}>("INSERT INTO seller_audit_local.channels(workspace_id,channel_code,channel_name) VALUES($1,'SHOP','Shop') RETURNING id",[actor.workspaceId])).rows[0].id
  const listing=(await db.query<{id:string}>("INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name) VALUES($1,$2,'L','Listing') RETURNING id",[actor.workspaceId,channel])).rows[0].id
  await db.query("INSERT INTO seller_audit_local.channel_offers(workspace_id,listing_id,master_product_id) VALUES($1,$2,$3)",[actor.workspaceId,listing,saved.id])
  const old=(await db.query<{updated_at:Date}>('SELECT updated_at FROM seller_audit_local.products WHERE id=$1',[saved.id])).rows[0].updated_at.toISOString()
  await saveProductMaster(pool,actor,{...input,id:saved.id,expectedUpdatedAt:old,productName:'Updated',components:[{skuId:sku,quantity:3}]})
  expect((await db.query<{quantity:number}>('SELECT quantity FROM seller_audit_local.product_components WHERE product_id=$1',[saved.id])).rows[0].quantity).toBe(3)
  expect((await db.query("SELECT 1 FROM seller_audit_local.audit_issues WHERE product_id=$1 AND issue_type='CHANGED_LISTING' AND status='OPEN'",[saved.id])).rowCount).toBe(1)
  await expect(saveProductMaster(pool,actor,{...input,id:saved.id,expectedUpdatedAt:'2000-01-01T00:00:00.000Z',components:[{skuId:sku,quantity:5}]})).rejects.toThrow('changed')
  await expect(saveProductMaster(pool,{...actor,role:'VIEWER'},input)).rejects.toThrow()
  expect((await db.query<{quantity:number}>('SELECT quantity FROM seller_audit_local.product_components WHERE product_id=$1',[saved.id])).rows[0].quantity).toBe(3)
 }finally{await db.close()}
})
