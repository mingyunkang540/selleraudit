import {test,expect} from '@playwright/test'
import {createHash,randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {syncSalesDashboard} from '../../server/business/salesDashboard'
import type {Identity} from '../../server/auth/service'

test('configured sales source is used and unavailable or invalid source preserves the last snapshot',async()=>{
 const root=await mkdtemp(join(tmpdir(),'selleraudit-sales-source-')),workspaceId=randomUUID(),workspace=join(root,workspaceId),source=join(root,'source.xlsx')
 const original=process.env.SELLERAUDIT_SALES_SOURCE_PATH
 const actor:Identity={workspaceId,userId:randomUUID(),role:'ADMIN',email:'test@example.com',displayName:'Test'}
 try{
  await mkdir(workspace)
  const bytes=Buffer.from('known source bytes'),hash=createHash('sha256').update(bytes).digest('hex')
  await writeFile(source,bytes)
  const previous={schemaVersion:1,parserVersion:4,sourceName:'old.xlsx',sourceSha256:hash,asOf:'2026-11-02',days:[],months:[],warnings:[]}
  const saved=join(workspace,'sales-dashboard.json')
  await writeFile(saved,JSON.stringify(previous))
  process.env.SELLERAUDIT_SALES_SOURCE_PATH=source
  const current=await syncSalesDashboard(root,actor)
  expect(current.syncStatus).toBe('current');expect(current.sourcePath).toBe(source)
  await writeFile(source,'invalid replacement')
  const invalid=await syncSalesDashboard(root,actor)
  expect(invalid.syncStatus).toBe('error');expect(invalid.sourceSha256).toBe(hash)
  expect(JSON.parse(await readFile(saved,'utf8')).sourceSha256).toBe(hash)
  process.env.SELLERAUDIT_SALES_SOURCE_PATH=join(root,'missing.xlsx')
  const missing=await syncSalesDashboard(root,actor)
  expect(missing.syncStatus).toBe('error');expect(missing.sourceSha256).toBe(hash)
 }finally{
  if(original===undefined)delete process.env.SELLERAUDIT_SALES_SOURCE_PATH;else process.env.SELLERAUDIT_SALES_SOURCE_PATH=original
  await rm(root,{recursive:true,force:true})
 }
})
