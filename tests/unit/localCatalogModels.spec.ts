import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect,test } from '@playwright/test'

test('local catalog preserves unlisted bundle components and distinct collection options',async()=>{
  const db=new PGlite()
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for(const name of ['0001_foundation','0002_local_business_tables','0003_local_identity'])await db.exec(await readFile(new URL(`../../server/migrations/${name}.sql`,import.meta.url),'utf8'))
    await db.exec(await readFile(new URL('../../server/migrations/0007_local_catalog.sql',import.meta.url),'utf8'))
    const a=(await db.query<{id:string}>("INSERT INTO seller_audit_local.workspaces(name) VALUES('A') RETURNING id")).rows[0].id
    const b=(await db.query<{id:string}>("INSERT INTO seller_audit_local.workspaces(name) VALUES('B') RETURNING id")).rows[0].id
    const user=(await db.query<{id:string}>("INSERT INTO seller_audit_local.app_users(email,display_name) VALUES('fixture@example.invalid','Fixture') RETURNING id")).rows[0].id
    const source=(await db.query<{id:string}>("INSERT INTO seller_audit_local.import_source_files(workspace_id,original_filename,storage_object_path,client_observed_byte_size,client_observed_sha256,created_by) VALUES($1,'fixture.xlsx','fixture',1,$2,$3) RETURNING id",[a,'a'.repeat(64),user])).rows[0].id
    const skus=(await db.query<{id:string}>("INSERT INTO seller_audit_local.skus(workspace_id,sku_code,model_name) VALUES($1,'AL00','A'),($1,'AL01','B'),($2,'OTHER','Other') RETURNING id",[a,b])).rows
    const bundle=(await db.query<{id:string}>("INSERT INTO seller_audit_local.unlisted_bundles(workspace_id,source_file_id,source_row,name) VALUES($1,$2,115,'Unlisted bundle') RETURNING id",[a,source])).rows[0].id
    await db.query('INSERT INTO seller_audit_local.unlisted_bundle_components(workspace_id,bundle_id,sku_id,quantity) VALUES($1,$2,$3,2),($1,$2,$4,1)',[a,bundle,skus[0].id,skus[1].id])
    await expect(db.query('INSERT INTO seller_audit_local.unlisted_bundle_components(workspace_id,bundle_id,sku_id,quantity) VALUES($1,$2,$3,1)',[a,bundle,skus[2].id])).rejects.toThrow()
    const product=(await db.query<{id:string}>("INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,product_type) VALUES($1,'100526','Collection','SET') RETURNING id",[a])).rows[0].id
    const collection=(await db.query<{id:string}>("INSERT INTO seller_audit_local.market_collections(workspace_id,product_id) VALUES($1,$2) RETURNING id",[a,product])).rows[0].id
    await db.query("INSERT INTO seller_audit_local.market_collection_options(workspace_id,collection_id,sku_id,source_file_id,source_row,option_name,quantity) VALUES($1,$2,$3,$5,158,'A x 2',2),($1,$2,$4,$5,159,'B x 2',2)",[a,collection,skus[0].id,skus[1].id,source])
    await expect(db.query("INSERT INTO seller_audit_local.market_collection_options(workspace_id,collection_id,sku_id,source_file_id,source_row,option_name,quantity) VALUES($1,$2,$3,$4,160,'Duplicate',2)",[a,collection,skus[0].id,source])).rejects.toThrow()
    await expect(db.query("INSERT INTO seller_audit_local.market_collection_options(workspace_id,collection_id,sku_id,source_file_id,source_row,option_name,quantity) VALUES($1,$2,$3,$4,160,'Wrong workspace',2)",[a,collection,skus[2].id,source])).rejects.toThrow()
    await expect(db.query("INSERT INTO seller_audit_local.market_collection_options(workspace_id,collection_id,sku_id,source_file_id,source_row,option_name,quantity) VALUES($1,$2,$3,$4,160,'Invalid quantity',0)",[a,collection,skus[1].id,source])).rejects.toThrow()
    expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM seller_audit_local.market_collection_options WHERE collection_id=$1',[collection])).rows[0].count).toBe(2)
    await db.query('INSERT INTO seller_audit_local.sku_assembly_components(workspace_id,assembly_sku_id,component_sku_id,quantity) VALUES($1,$2,$3,6)',[a,skus[0].id,skus[1].id])
    await expect(db.query('INSERT INTO seller_audit_local.sku_assembly_components(workspace_id,assembly_sku_id,component_sku_id,quantity) VALUES($1,$2,$2,1)',[a,skus[0].id])).rejects.toThrow()
    await expect(db.query('INSERT INTO seller_audit_local.sku_assembly_components(workspace_id,assembly_sku_id,component_sku_id,quantity) VALUES($1,$2,$3,1)',[a,skus[1].id,skus[0].id])).rejects.toThrow('Nested SKU assemblies')
    await expect(db.query('INSERT INTO seller_audit_local.sku_assembly_components(workspace_id,assembly_sku_id,component_sku_id,quantity) VALUES($1,$2,$3,1)',[a,skus[0].id,skus[2].id])).rejects.toThrow()
    const variant=(await db.query<{id:string}>("INSERT INTO seller_audit_local.product_channel_variants(workspace_id,product_id,source_file_id,source_row,source_channel) VALUES($1,$2,$3,200,'오늘의집_아쿠아') RETURNING id",[a,product,source])).rows[0].id
    await db.query('INSERT INTO seller_audit_local.product_channel_variant_components(workspace_id,variant_id,sku_id,quantity) VALUES($1,$2,$3,3)',[a,variant,skus[1].id])
    await expect(db.query('INSERT INTO seller_audit_local.product_channel_variant_components(workspace_id,variant_id,sku_id,quantity) VALUES($1,$2,$3,1)',[a,variant,skus[2].id])).rejects.toThrow()
    expect((await db.query<{quantity:number}>('SELECT quantity FROM seller_audit_local.product_channel_variant_components WHERE variant_id=$1',[variant])).rows[0].quantity).toBe(3)
    expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM seller_audit_local.products')).rows[0].count).toBe(1)
  } finally {await db.close()}
})

test('catalog migration grants the existing local application role access',async()=>{
  const db=new PGlite()
  try {
    await db.exec('CREATE ROLE selleraudit_app; CREATE SCHEMA seller_audit_local')
    for(const name of ['0001_foundation','0002_local_business_tables','0003_local_identity'])await db.exec(await readFile(new URL(`../../server/migrations/${name}.sql`,import.meta.url),'utf8'))
    await db.exec(await readFile(new URL('../../server/migrations/0007_local_catalog.sql',import.meta.url),'utf8'))
    const privileges=await db.query<{read:boolean;write:boolean;remove:boolean}>(`SELECT
      has_table_privilege('selleraudit_app','seller_audit_local.product_channel_variants','SELECT') AS read,
      has_table_privilege('selleraudit_app','seller_audit_local.product_channel_variants','INSERT') AS write,
      has_table_privilege('selleraudit_app','seller_audit_local.product_channel_variants','DELETE') AS remove`)
    expect(privileges.rows[0]).toEqual({read:true,write:true,remove:false})
  } finally {await db.close()}
})

test('channel import migration grants only required write access',async()=>{
  const db=new PGlite()
  try{
    await db.exec('CREATE ROLE selleraudit_app; CREATE SCHEMA seller_audit_local')
    for(const name of ['0001_foundation','0002_local_business_tables'])await db.exec(await readFile(new URL(`../../server/migrations/${name}.sql`,import.meta.url),'utf8'))
    await db.exec(await readFile(new URL('../../server/migrations/0008_local_channel_import.sql',import.meta.url),'utf8'))
    const result=await db.query<{channels:boolean;listings:boolean;remove:boolean}>(`SELECT has_table_privilege('selleraudit_app','seller_audit_local.channels','INSERT') AS channels,has_table_privilege('selleraudit_app','seller_audit_local.channel_listings','INSERT') AS listings,has_table_privilege('selleraudit_app','seller_audit_local.channels','DELETE') AS remove`)
    expect(result.rows[0]).toEqual({channels:true,listings:true,remove:false})
  }finally{await db.close()}
})
