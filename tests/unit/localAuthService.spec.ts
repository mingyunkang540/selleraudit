import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import type { Pool } from 'pg'
import { expect, test } from '@playwright/test'
import { activateEmployee, activatePendingWithInitialPassword, bootstrapAdmin, changeEmployeeRole, createEmployeeWithInitialPassword, currentIdentity, disableEmployee, inviteEmployee, listEmployees, login, resetEmployeePassword, validCsrf } from '../../server/auth/service'
import {hashPassword} from '../../server/auth/crypto'
import { readBusinessData } from '../../server/business/read'
import { archiveInactiveOffers, mapOffer, unmapOffer, updateIssue } from '../../server/business/write'
import {bindOfferConfiguration,readProductConfigurations,saveProductConfiguration} from '../../server/business/productConfigurations'

test('local identity lifecycle enforces initialization, one-time activation, role changes and revocation', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE SCHEMA seller_audit_local')
    for (const name of ['0001_foundation.sql','0002_local_business_tables.sql','0003_local_identity.sql','0004_local_mapping_audit.sql','0010_product_configurations.sql']) {
      await db.exec(await readFile(new URL(`../../server/migrations/${name}`, import.meta.url), 'utf8'))
    }
    const pool = {
      query: (sql: string, params?: unknown[]) => db.query(sql, params),
      connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release: () => {} }),
    } as unknown as Pool
    await bootstrapAdmin(pool,{email:'ADMIN@example.com',displayName:'Administrator',password:'example admin password'})
    await expect(bootstrapAdmin(pool,{email:'other@example.com',displayName:'Other',password:'another password'})).rejects.toThrow('already initialized')
    expect(await login(pool,'admin@example.com','incorrect')).toBeNull()
    const adminLogin = await login(pool,'admin@example.com','example admin password')
    expect(adminLogin).not.toBeNull()
    const admin = await currentIdentity(pool,adminLogin!.session)
    expect(admin?.role).toBe('ADMIN')
    const initialHash=await hashPassword('temporary-password')
    await createEmployeeWithInitialPassword(pool,admin!,{email:'new@example.com',displayName:'New Employee',role:'EDITOR'},initialHash)
    const initialLogin=await login(pool,'new@example.com','temporary-password')
    expect(initialLogin).not.toBeNull()
    const initialIdentity=await currentIdentity(pool,initialLogin!.session)
    expect(initialIdentity?.role).toBe('EDITOR')
    await expect(createEmployeeWithInitialPassword(pool,initialIdentity!,{email:'notallowed@example.com',displayName:'No',role:'VIEWER'},initialHash)).rejects.toThrow('Not authorized')
    const pendingCode=await inviteEmployee(pool,admin!,{email:'pending@example.com',displayName:'Pending',role:'EDITOR'})
    await activatePendingWithInitialPassword(pool,admin!,'pending@example.com','temporary-password')
    expect(await login(pool,'pending@example.com','temporary-password')).not.toBeNull()
    await expect(activateEmployee(pool,'pending@example.com',pendingCode,'temporary-password')).rejects.toThrow('Invalid activation')
    await expect(activatePendingWithInitialPassword(pool,admin!,'pending@example.com','temporary-password')).rejects.toThrow('Pending employee unavailable')
    const otherWorkspace=await db.query<{id:string}>("INSERT INTO seller_audit_local.workspaces(name) VALUES('Other') RETURNING id")
    await db.query("INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,product_type) VALUES($1,'private','Other','SINGLE')",[otherWorkspace.rows[0].id])
    expect((await readBusinessData(pool,admin!)).products).toEqual([])
    await expect(readBusinessData(pool,{...admin!,workspaceId:otherWorkspace.rows[0].id})).rejects.toThrow('Not authorized')
    expect(validCsrf(admin!,adminLogin!.csrf)).toBe(true)
    expect(validCsrf(admin!,'wrong')).toBe(false)
    await expect(changeEmployeeRole(pool,admin!,admin!.userId,'VIEWER')).rejects.toThrow('last active administrator')
    const code=await inviteEmployee(pool,admin!,{email:'editor@example.com',displayName:'Editor',role:'EDITOR'})
    const employees=await listEmployees(pool,admin!)
    const editor=employees.find(e=>e.email==='editor@example.com')!
    await activateEmployee(pool,'editor@example.com',code,'editor password 123')
    await expect(activateEmployee(pool,'editor@example.com',code,'another password 123')).rejects.toThrow('Invalid activation')
    const editorLogin=await login(pool,'editor@example.com','editor password 123')
    const editorIdentity=await currentIdentity(pool,editorLogin!.session)
    expect(editorIdentity?.role).toBe('EDITOR')
    const ws=admin!.workspaceId
    const product=await db.query<{id:string}>("INSERT INTO seller_audit_local.products(workspace_id,sabangnet_code,product_name,product_type) VALUES($1,'100','Sample','SINGLE') RETURNING id",[ws])
    const channel=await db.query<{id:string}>("INSERT INTO seller_audit_local.channels(workspace_id,channel_code,channel_name) VALUES($1,'SHOP','Shop') RETURNING id",[ws])
    const listing=await db.query<{id:string}>("INSERT INTO seller_audit_local.channel_listings(workspace_id,channel_id,channel_product_id,product_name) VALUES($1,$2,'listing','Original') RETURNING id",[ws,channel.rows[0].id])
    const offer=await db.query<{id:string}>("INSERT INTO seller_audit_local.channel_offers(workspace_id,listing_id) VALUES($1,$2) RETURNING id",[ws,listing.rows[0].id])
    const sku=await db.query<{id:string}>("INSERT INTO seller_audit_local.skus(workspace_id,sku_code,model_name) VALUES($1,'SKU1','Sample') RETURNING id",[ws])
    const prices={normal:10000,regular:null,basic:null,medium:null,large:null,live:null,group:null}
    const config=await saveProductConfiguration(pool,editorIdentity!,{productId:product.rows[0].id,name:'용기만',prices,components:[{skuId:sku.rows[0].id,quantity:2}]})
    await bindOfferConfiguration(pool,editorIdentity!,offer.rows[0].id,config.id!)
    expect((await readProductConfigurations(pool,admin!)).bindings).toHaveLength(1)
    expect((await readProductConfigurations(pool,admin!)).configurations[0].prices.live).toBeNull()
    await expect(saveProductConfiguration(pool,editorIdentity!,{productId:product.rows[0].id,name:'오류',prices,components:[{skuId:sku.rows[0].id,quantity:0}]})).rejects.toThrow()
    await unmapOffer(pool,editorIdentity!,offer.rows[0].id,product.rows[0].id)
    expect((await readProductConfigurations(pool,admin!)).bindings).toHaveLength(0)
    const inactive=await db.query<{id:string}>("INSERT INTO seller_audit_local.channel_offers(workspace_id,listing_id,channel_option_id,status) VALUES($1,$2,'unused','INACTIVE') RETURNING id",[ws,listing.rows[0].id])
    await expect(archiveInactiveOffers(pool,editorIdentity!,[inactive.rows[0].id,offer.rows[0].id])).rejects.toThrow()
    expect((await readBusinessData(pool,admin!)).offers).toHaveLength(2)
    expect(await archiveInactiveOffers(pool,editorIdentity!,[inactive.rows[0].id])).toBe(1)
    expect((await readBusinessData(pool,admin!)).offers).toHaveLength(1)
    await expect(archiveInactiveOffers(pool,editorIdentity!,[inactive.rows[0].id])).rejects.toThrow()
    await expect(mapOffer(pool,editorIdentity!,inactive.rows[0].id,product.rows[0].id)).rejects.toThrow()
    expect((await db.query('SELECT 1 FROM seller_audit_local.channel_offers WHERE id=$1',[inactive.rows[0].id])).rowCount).toBe(1)
    const issue=await db.query<{id:string}>("INSERT INTO seller_audit_local.audit_issues(workspace_id,listing_id,offer_id,issue_type,severity,title,description) VALUES($1,$2,$3,'UNMATCHED','ERROR','Issue','Test') RETURNING id",[ws,listing.rows[0].id,offer.rows[0].id])
    await mapOffer(pool,editorIdentity!,offer.rows[0].id,product.rows[0].id)
    const linked=await db.query<{master_product_id:string}>('SELECT master_product_id FROM seller_audit_local.channel_offers WHERE id=$1',[offer.rows[0].id])
    expect(linked.rows[0].master_product_id).toBe(product.rows[0].id)
    await expect(unmapOffer(pool,editorIdentity!,offer.rows[0].id,otherWorkspace.rows[0].id)).rejects.toThrow()
    await unmapOffer(pool,editorIdentity!,offer.rows[0].id,product.rows[0].id)
    expect((await db.query<{master_product_id:string|null}>('SELECT master_product_id FROM seller_audit_local.channel_offers WHERE id=$1',[offer.rows[0].id])).rows[0].master_product_id).toBeNull()
    expect((await db.query('SELECT 1 FROM seller_audit_local.aliases WHERE workspace_id=$1',[ws])).rowCount).toBe(0)
    expect((await db.query<{status:string}>('SELECT status FROM seller_audit_local.audit_issues WHERE id=$1',[issue.rows[0].id])).rows[0].status).toBe('OPEN')
    expect((await db.query("SELECT 1 FROM seller_audit_local.activity_logs WHERE workspace_id=$1 AND action_type='OFFER_UNMAPPED'",[ws])).rowCount).toBe(2)
    await mapOffer(pool,editorIdentity!,offer.rows[0].id,product.rows[0].id)
    await updateIssue(pool,editorIdentity!,issue.rows[0].id,'OPEN')
    await changeEmployeeRole(pool,admin!,editor.id as string,'VIEWER')
    expect((await currentIdentity(pool,editorLogin!.session))?.role).toBe('VIEWER')
    await expect(mapOffer(pool,editorIdentity!,offer.rows[0].id,product.rows[0].id)).rejects.toThrow()
    await db.query("INSERT INTO seller_audit_local.workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'VIEWER','ACTIVE')",[otherWorkspace.rows[0].id,editor.id])
    await expect(resetEmployeePassword(pool,admin!,editor.id as string)).rejects.toThrow('Multi-workspace')
    await db.query('DELETE FROM seller_audit_local.workspace_members WHERE workspace_id=$1 AND user_id=$2',[otherWorkspace.rows[0].id,editor.id])
    const reset=await resetEmployeePassword(pool,admin!,editor.id as string)
    expect(await currentIdentity(pool,editorLogin!.session)).toBeNull()
    expect(await login(pool,'editor@example.com','editor password 123')).toBeNull()
    await activateEmployee(pool,'editor@example.com',reset,'new editor password 123')
    const renewed=await login(pool,'editor@example.com','new editor password 123')
    await disableEmployee(pool,admin!,editor.id as string)
    expect(await currentIdentity(pool,renewed!.session)).toBeNull()
    expect(await login(pool,'editor@example.com','new editor password 123')).toBeNull()
  } finally { await db.close() }
})
