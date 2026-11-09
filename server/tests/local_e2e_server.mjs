import { readFile,mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute,join,relative } from 'node:path'
import { URL } from 'node:url'
import process from 'node:process'
import { PGlite } from '@electric-sql/pglite'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { registerAuthRoutes } from '../auth/routes.ts'
import { bootstrapAdmin } from '../auth/service.ts'

const root=await mkdtemp(join(tmpdir(),'seller-e2e-test-'))
const rel=relative(tmpdir(),root)
if(!rel||rel.startsWith('..')||isAbsolute(rel)||!rel.startsWith('seller-e2e-test-'))throw new Error('Unexpected temporary directory')
const db=new PGlite()
await db.exec('CREATE SCHEMA seller_audit_local')
for(const name of ['0001_foundation','0002_local_business_tables','0003_local_identity','0004_local_mapping_audit','0005_local_pilot_apply','0006_local_import_contract']) await db.exec(await readFile(new URL(`../migrations/${name}.sql`,import.meta.url),'utf8'))
const pool={query:(sql,params)=>db.query(sql,params),connect:async()=>({query:(sql,params)=>db.query(sql,params),release:()=>{}})}
await bootstrapAdmin(pool,{email:'admin@example.invalid',displayName:'Test Admin',password:'synthetic test password'})
process.env.SELLERAUDIT_LOCAL_IMPORT_ENABLED='YES';process.env.SELLERAUDIT_LOCAL_APPLY_ENABLED='YES';process.env.SELLERAUDIT_LOCAL_DATA_DIR=root
const app=Fastify({logger:false})
app.addHook('onRequest',async request=>{
  request.raw.headers.host='127.0.0.1:5174'
  if(request.raw.headers.origin==='http://127.0.0.1:5184')request.raw.headers.origin='http://127.0.0.1:5174'
})
await app.register(cookie)
await app.register(rateLimit,{global:false})
await app.register(async instance=>{await registerAuthRoutes(instance,pool)})
app.get('/api/health',async()=>({status:'ok'}))
await app.listen({host:'127.0.0.1',port:4189})
const close=async()=>{await app.close();await db.close();await rm(root,{recursive:true,force:true})}
process.once('SIGINT',()=>{void close()});process.once('SIGTERM',()=>{void close()})
